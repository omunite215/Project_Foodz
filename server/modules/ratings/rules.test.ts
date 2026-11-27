import { describe, expect, it } from 'vitest';
import {
  courierShown,
  decodeCursor,
  encodeCursor,
  feedbackState,
  orderListFlag,
  ratingCardState,
  ratingTimings,
  reminderBody,
  splitCourierTags,
} from './rules';
import { cleanComment, excludeRatingInput, rateOrderInput, tagsFor } from './schema';

const order = '0195b2a0-0000-7000-8000-000000000001';
const dish = '0195b2a0-0000-7000-8000-000000000002';
const pad = '0195b2a0-0000-7000-8000-000000000003';
const delivered = new Date('2026-11-21T00:46:00Z');
const facts = (extra: Partial<Parameters<typeof ratingCardState>[0]> = {}) => ({
  status: 'DELIVERED',
  deliveredAt: delivered,
  skippedAt: null,
  ratedAny: false,
  ...extra,
});

const issue = (input: Record<string, unknown>) =>
  rateOrderInput.safeParse({ orderId: order, ...input }).error?.issues[0]?.message;

const exclude = (extra: Record<string, unknown>) =>
  excludeRatingInput.safeParse({ kind: 'courier', ratingId: order, reason: 'other', ...extra });

describe('what a customer sends (S1, S2, V2)', () => {
  it('takes stars alone, tags from the band, and a cleaned comment', () => {
    const parsed = rateOrderInput.parse({
      orderId: order,
      dishes: [
        { menuItemId: dish, stars: 3, tags: ['cold'], comment: '  Lukewarm\r\nbut ok\u0007 ' },
        { menuItemId: pad, stars: 5 },
      ],
      courier: { stars: 5, tags: ['friendly', 'on-time'] },
    });
    expect(parsed.dishes[0]).toMatchObject({ comment: 'Lukewarm\nbut ok', tags: ['cold'] });
    expect(parsed.dishes[1]).toMatchObject({ tags: [] });
    expect(cleanComment(' \n ')).toBeNull();
  });

  it('refuses nothing picked, stars outside 1–5, tags from the other band, unknown tags and repeats', () => {
    expect(issue({})).toBe('Pick at least one star rating first.');
    expect(issue({ courier: { stars: 6 } })).toBeDefined();
    expect(issue({ courier: { stars: 0 } })).toBeDefined();
    expect(issue({ courier: { stars: 5, tags: ['late'] } })).toBe(
      'Pick tags from the list for these stars.',
    );
    expect(issue({ dishes: [{ menuItemId: dish, stars: 4, tags: ['cold'] }] })).toBe(
      'Pick tags from the list for these stars.',
    );
    expect(
      issue({ dishes: [{ menuItemId: dish, stars: 4, tags: ['tasty', 'tasty'] }] }),
    ).toBeDefined();
    expect(
      issue({ dishes: [{ menuItemId: dish, stars: 4, tags: ['<img src=x>'] }] }),
    ).toBeDefined();
    expect(
      issue({
        dishes: [
          { menuItemId: dish, stars: 4 },
          { menuItemId: dish, stars: 2 },
        ],
      }),
    ).toBe('That dish is not on this order.');
    expect(issue({ courier: { stars: 5, comment: 'x'.repeat(501) } })).toBeDefined();
    expect(tagsFor('courier', 3)).toContain('late');
  });

  it('needs a note for "Other" when excluding', () => {
    expect(exclude({}).error?.issues[0]?.message).toBe('Add a note about why.');
    expect(exclude({ note: 'The customer meant the Pad Thai.' }).success).toBe(true);
  });
});

describe("the card's state (story table, V1.2)", () => {
  const now = new Date('2026-11-21T01:05:00Z');
  it('opens on delivery for 7 days, then shows only what was rated', () => {
    expect(ratingCardState(facts(), now, 7)).toMatchObject({ state: 'open', editable: true });
    expect(ratingCardState(facts({ ratedAny: true }), now, 7)).toMatchObject({
      state: 'rated',
      editable: true,
    });
    expect(ratingCardState(facts({ skippedAt: now }), now, 7).state).toBe('skipped');
    const later = new Date('2026-11-28T00:47:00Z');
    expect(ratingCardState(facts(), later, 7)).toMatchObject({ state: 'closed', editable: false });
    expect(ratingCardState(facts({ ratedAny: true }), later, 7)).toMatchObject({
      state: 'rated',
      editable: false,
    });
    expect(ratingCardState(facts({ status: 'CANCELLED' }), now, 7).state).toBe('none');
    expect(ratingCardState(facts({ deliveredAt: null, status: 'PICKED_UP' }), now, 7).state).toBe(
      'none',
    );
    expect(ratingCardState(facts({ status: 'REFUNDED' }), now, 7).state).toBe('open');
    expect(ratingCardState(facts(), now, 7).closesAt?.toISOString()).toBe(
      '2026-11-28T00:46:00.000Z',
    );
  });

  it('flags rows on the Orders list and words staff feedback', () => {
    expect(orderListFlag(facts(), now, 7)).toBe('rate');
    expect(orderListFlag(facts({ ratedAny: true }), now, 7)).toBe('rated');
    expect(orderListFlag(facts({ skippedAt: now }), now, 7)).toBeNull();
    expect(feedbackState(facts({ status: 'CANCELLED', deliveredAt: null }), now, 7)).toBe(
      'cancelled',
    );
    expect(feedbackState(facts({ skippedAt: now }), now, 7)).toBe('skipped');
    expect(feedbackState(facts(), new Date('2026-12-01T00:00:00Z'), 7)).toBe('closed');
  });
});

describe('rules around the courier and the reminder (U14, S4, B13)', () => {
  it('shows a courier from 5 ratings and splits his tags', () => {
    expect([courierShown(4), courierShown(5)]).toEqual([false, true]);
    expect(
      splitCourierTags([
        { tag: 'friendly', count: 5 },
        { tag: 'late', count: 1 },
      ]),
    ).toEqual({ liked: [{ tag: 'friendly', count: 5 }], mentioned: [{ tag: 'late', count: 1 }] });
  });

  it('words the reminder for dishes and the courier', () => {
    expect(reminderBody(['Gimbap', 'Pad Thai'], 'Luis')).toBe(
      "Rate your Gimbap, Pad Thai and Luis's delivery. It takes ten seconds.",
    );
    expect(reminderBody(['Gimbap'], null)).toBe('Rate your Gimbap. It takes ten seconds.');
    expect(reminderBody(['A', 'B', 'C', 'D'], 'Luis')).toBe(
      "Rate your 4 dishes and Luis's delivery. It takes ten seconds.",
    );
  });

  it('only shortens waits with the test flag, never on a deployed production', () => {
    expect(ratingTimings({ RATING_REMINDER_MINUTES: '1' })).toMatchObject({ reminderMinutes: 60 });
    expect(
      ratingTimings({
        FOODZ_TEST_TIMING: '1',
        RATING_REMINDER_MINUTES: '1',
        PARTNER_RATING_LAG_DAYS: '0',
      }),
    ).toEqual({
      windowDays: 7,
      reminderMinutes: 1,
      partnerLagDays: 0,
    });
    expect(ratingTimings({ FOODZ_TEST_TIMING: '1', RATING_WINDOW_DAYS: '30' }).windowDays).toBe(7);
    expect(
      ratingTimings({
        FOODZ_TEST_TIMING: '1',
        VERCEL_ENV: 'production',
        RATING_REMINDER_MINUTES: '1',
      }).reminderMinutes,
    ).toBe(60);
  });

  it('round-trips the staff list cursor and refuses a forged one', () => {
    const at = new Date('2026-11-17T12:20:00Z');
    expect(decodeCursor(encodeCursor(at, order))).toEqual({ at, id: order });
    expect(decodeCursor("x|' OR 1=1")).toBeNull();
    expect(decodeCursor(null)).toBeNull();
  });
});
