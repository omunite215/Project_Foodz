import { describe, expect, it } from 'vitest';
import { movePoint } from '@/lib/map-geometry';
import {
  type AcceptedPoint,
  autoOfflineReason,
  freshnessOf,
  judgeBatch,
  kitchenDistance,
  lastLocationWriteDue,
  type LocationPoint,
  pointClocks,
  pointRefusal,
} from './location';

const T0 = Date.parse('2026-11-20T23:00:00.000Z'); // Fri, Nov 20, 6:00 pm in Boston
const at = (seconds: number) => new Date(T0 + seconds * 1000).toISOString();
const now = (seconds: number) => new Date(T0 + seconds * 1000);

const KITCHEN = { lat: 42.3505, lng: -71.045 };
const R2 = { lat: 42.3537, lng: -71.0487 };
const R3 = { lat: 42.3553, lng: -71.0506 };
const HARVARD = { lat: 42.3736, lng: -71.119 };

const point = (
  where: { lat: number; lng: number },
  seconds: number,
  accuracy = 15,
): LocationPoint => ({
  ...where,
  accuracy,
  heading: null,
  speed: null,
  recordedAt: at(seconds),
});

const accepted = (where: { lat: number; lng: number }, seconds: number): AcceptedPoint => ({
  ...where,
  accuracy: 15,
  recordedAt: at(seconds),
});

describe('one point on its own (P16.4, P16.5)', () => {
  it('refuses a fix worse than 500 m and accepts a weak one', () => {
    expect(pointRefusal(point(R2, 0, 2000), now(0))).toBe('LOW_ACCURACY');
    expect(pointRefusal(point(R2, 0, 500), now(0))).toBeNull();
    expect(pointRefusal(point(R2, 0, 300), now(0))).toBeNull();
  });

  it('refuses points more than 10 s ahead or older than 10 minutes', () => {
    expect(pointRefusal(point(R2, 11), now(0))).toBe('FUTURE_POINT');
    expect(pointRefusal(point(R2, 10), now(0))).toBeNull();
    expect(pointRefusal(point(R2, -601), now(0))).toBe('STALE_POINT');
    expect(pointRefusal(point(R2, -600), now(0))).toBeNull();
  });
});

const north = (meters: number) => movePoint(R2, 'up', meters);

describe('a batch against the last accepted point (P16.2, P16.3)', () => {
  it('refuses about 212 km/h and accepts about 189 km/h', () => {
    const last = accepted(R2, 0);
    expect(judgeBatch([point(north(1000), 17)], last, now(17)).results).toEqual([
      { index: 0, result: 'refused', code: 'IMPLAUSIBLE_JUMP' },
    ]);
    expect(judgeBatch([point(north(1000), 19)], last, now(19)).results).toEqual([
      { index: 0, result: 'accepted' },
    ]);
  });

  it('keeps R2 after the Harvard Square jump and accepts R3 20 s after R2', () => {
    const last = accepted(R2, 40);
    const jump = judgeBatch([point(HARVARD, 44)], last, now(44));
    expect(jump.results[0]).toEqual({ index: 0, result: 'refused', code: 'IMPLAUSIBLE_JUMP' });
    expect(jump.last).toEqual(last);
    expect(jump.jumps).toBe(1);

    const next = judgeBatch([point(R3, 60)], jump.last, now(60));
    expect(next.results[0]).toEqual({ index: 0, result: 'accepted' });
    expect(next.last?.lat).toBe(R3.lat);
  });

  it('starts afresh after going online: no speed check without a last point', () => {
    expect(judgeBatch([point(HARVARD, 0)], null, now(0)).results[0]?.result).toBe('accepted');
  });

  it('ignores repeats and points older than the last accepted', () => {
    const last = accepted(R2, 40);
    const verdict = judgeBatch([point(R2, 40), point(R2, 30)], last, now(41));
    expect(verdict.results).toEqual([
      { index: 0, result: 'ignored', why: 'repeat' },
      { index: 1, result: 'ignored', why: 'repeat' },
    ]);
  });

  it('thins points less than 2 s apart, keeping the later, and answers in the order sent', () => {
    const verdict = judgeBatch(
      [point(R3, 61.5), point(R2, 40), point(R3, 60)],
      accepted(KITCHEN, 0),
      now(62),
    );
    expect(verdict.results).toEqual([
      { index: 0, result: 'accepted' },
      { index: 1, result: 'accepted' },
      { index: 2, result: 'ignored', why: 'thinned' },
    ]);
    expect(verdict.last?.recordedAt).toBe(at(61.5));
  });

  it('replays a queue in time order after a dead zone (P11.2)', () => {
    const R4 = { lat: 42.3568, lng: -71.0525 };
    const R5 = { lat: 42.3584, lng: -71.0543 };
    const verdict = judgeBatch(
      [point(R3, 60), point(R4, 80), point(R5, 100)],
      accepted(R2, 40),
      now(115),
    );
    expect(verdict.results.every((result) => result.result === 'accepted')).toBe(true);
    expect(verdict.last?.lat).toBe(R5.lat);
  });

  it('drops a refused point without sinking the batch', () => {
    const verdict = judgeBatch([point(R2, 40, 2000), point(R3, 60)], accepted(R2, 20), now(60));
    expect(verdict.results).toEqual([
      { index: 0, result: 'refused', code: 'LOW_ACCURACY' },
      { index: 1, result: 'accepted' },
    ]);
  });
});

describe('freshness and automatic offline (B8, B22, P10.6, P10.8)', () => {
  it('is available under 2 minutes, then stale', () => {
    expect(freshnessOf({ isOnline: true, lastPointAt: at(0) }, now(119))).toBe('available');
    expect(freshnessOf({ isOnline: true, lastPointAt: at(0) }, now(120))).toBe('stale');
    expect(freshnessOf({ isOnline: false, lastPointAt: at(0) }, now(1))).toBe('offline');
  });

  const openKitchen = { isOpen: true, lastClosedAt: null };

  it('takes a partner offline after 10 minutes without a point', () => {
    const partner = { onlineSince: at(-1000), lastPointAt: at(-599) };
    expect(autoOfflineReason(partner, openKitchen, now(0))).toBeNull();
    expect(autoOfflineReason(partner, openKitchen, now(1))).toBe('no-location');
  });

  it('counts from going online when no point ever came', () => {
    expect(
      autoOfflineReason({ onlineSince: at(-600), lastPointAt: null }, openKitchen, now(0)),
    ).toBe('no-location');
  });

  it('takes Grace offline: seeded online, last point 11 minutes old', () => {
    expect(
      autoOfflineReason({ onlineSince: at(-3600), lastPointAt: at(-660) }, openKitchen, now(0)),
    ).toBe('no-location');
  });

  it('takes idle partners offline an hour after closing, but not someone who just came online', () => {
    const closed = { isOpen: false, lastClosedAt: at(-3600) };
    const fresh = at(-5);
    expect(autoOfflineReason({ onlineSince: at(-7200), lastPointAt: fresh }, closed, now(0))).toBe(
      'kitchen-closed',
    );
    expect(
      autoOfflineReason({ onlineSince: at(-60), lastPointAt: fresh }, closed, now(0)),
    ).toBeNull();
    expect(
      autoOfflineReason(
        { onlineSince: at(-7200), lastPointAt: fresh },
        { isOpen: false, lastClosedAt: at(-3599) },
        now(0),
      ),
    ).toBeNull();
  });
});

describe('the same coordinates again (security gate S7)', () => {
  it('starts both clocks when he goes online or moves', () => {
    expect(pointClocks(null, KITCHEN, now(0))).toEqual({ acceptedAt: at(0), movedAt: at(0) });
    const held = { ...KITCHEN, acceptedAt: at(0), movedAt: at(0) };
    expect(pointClocks(held, R2, now(15))).toEqual({ acceptedAt: at(15), movedAt: at(15) });
  });

  it('keeps him fresh with unchanged coordinates for 2 minutes after he last moved, no longer', () => {
    let held = { ...R2, acceptedAt: at(15), movedAt: at(15) };
    for (let seconds = 30; seconds <= 300; seconds += 15) {
      held = { ...R2, ...pointClocks(held, R2, now(seconds)) };
    }
    expect(held).toMatchObject({ acceptedAt: at(135), movedAt: at(15) });
    expect(freshnessOf({ isOnline: true, lastPointAt: held.acceptedAt }, now(300))).toBe('stale');
    // He moves again: fresh at once.
    expect(pointClocks(held, R3, now(315))).toEqual({ acceptedAt: at(315), movedAt: at(315) });
  });

  it('reads a point kept before `movedAt` existed from its acceptance time', () => {
    const old = { ...R2, acceptedAt: at(0) };
    expect(pointClocks(old, R2, now(200))).toEqual({ acceptedAt: at(120), movedAt: at(0) });
  });
});

describe('the idle screen and storage pacing (P10.1, B7)', () => {
  it('reads "At the kitchen" within 100 m and one decimal beyond', () => {
    expect(kitchenDistance(KITCHEN, KITCHEN)).toEqual({ atKitchen: true, km: 0 });
    expect(kitchenDistance({ lat: 42.36, lng: -71.0562 }, KITCHEN)).toEqual({
      atKitchen: false,
      km: 1.4,
    });
    expect(kitchenDistance(R2, KITCHEN).km).toBe(0.5);
  });

  it('writes last_location at most every 15 seconds, so dispatch sees a fresh point (F7 B12)', () => {
    expect(lastLocationWriteDue(null, now(0))).toBe(true);
    expect(lastLocationWriteDue(at(0), now(14))).toBe(false);
    expect(lastLocationWriteDue(at(0), now(15))).toBe(true);
  });
});
