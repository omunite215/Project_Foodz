import { describe, expect, it } from 'vitest';
import type { CancellationNotice } from '@/server/modules/orders/progress-schema';
import { orderViewFixture, paidCardOrder, stepsAt } from '@/components/orders/orders.fixtures';
import {
  acceptedCancelSentence,
  addedText,
  leftOutSentence,
  arrivalText,
  cancellationAnnouncement,
  cancellationMoney,
  cancellationOpener,
  cancellationReason,
  currentStep,
  orderTabTitle,
  progressTimelineLabel,
  statusAnnouncement,
  stepHeading,
  stepLine,
  stepSpoken,
  stepTime,
} from './order-progress';

const TZ = 'America/New_York';
const NOW = new Date('2026-11-20T00:30:00.000Z');

const withProgress = (
  status: 'PLACED' | 'ACCEPTED' | 'PREPARING' | 'PICKED_UP' | 'DELIVERED',
  extra = {},
) =>
  orderViewFixture({
    status,
    progress: { ...orderViewFixture().progress, ...extra },
  });

const promised = (from: string, to: string) =>
  arrivalText({ kind: 'promised', from, to, lateMinutes: null, behind: false }, null, TZ);

describe('the stepper (design 6.4)', () => {
  it('names each step with its state in words', () => {
    const steps = stepsAt('preparing');
    expect(steps.map((step) => stepSpoken(step, NOW, TZ))).toEqual([
      'Placed, done, 7:02 pm',
      'Accepted, done, 7:03 pm',
      'Cooking, now, 7:04 pm',
      'Ready, not yet',
      'On its way, not yet',
      'Delivered, not yet',
    ]);
  });

  it('reads "Collected" for an order the customer picked up (U23)', () => {
    const step = stepsAt('pickedUp', { collected: true })[4]!;
    expect(stepSpoken(step, NOW, TZ)).toBe('Collected, now, 7:06 pm');
  });

  it('dates a step from another day (S1.4)', () => {
    expect(stepTime('2026-11-18T00:31:00.000Z', NOW, TZ)).toEqual({
      date: 'Tue, Nov 17',
      clock: '7:31 pm',
    });
    expect(stepTime('2026-11-20T00:27:00.000Z', NOW, TZ)).toEqual({ date: null, clock: '7:27 pm' });
  });
});

describe('the hero (design 6.3)', () => {
  it('words each step in the customer’s words', () => {
    expect(currentStep({ status: 'PREPARING' })).toBe('preparing');
    expect(currentStep({ status: 'CANCELLED' })).toBeNull();
    expect(stepHeading('preparing', false)).toBe('Cooking your order');
    expect(stepHeading('pickedUp', true)).toBe('Order collected');
    expect(stepLine(withProgress('ACCEPTED'), 'accepted', false)).toBe(
      'The kitchen has your order and will start cooking soon.',
    );
  });

  it('changes the Placed line at 5 and 15 minutes (S2.5)', () => {
    expect(stepLine(withProgress('PLACED'), 'placed', false)).toBe(
      'Waiting for the kitchen to accept it. You can cancel until they do.',
    );
    expect(stepLine(withProgress('PLACED', { placedWaiting: '5' }), 'placed', false)).toBe(
      'Still waiting for the kitchen to accept it. You can cancel until they do.',
    );
    expect(stepLine(withProgress('PLACED', { placedWaiting: '15' }), 'placed', false)).toBe(
      "This is taking longer than usual. Call us on (617) 555-0142, or cancel the order if you'd rather not wait.",
    );
  });

  it('says when it was delivered (S2.6)', () => {
    const view = withProgress('DELIVERED', {
      deliveredAt: '2026-11-20T01:14:00.000Z',
      asOf: '2026-11-20T02:00:00.000Z',
    });
    expect(stepLine(view, 'delivered', false)).toBe('Delivered at 8:14 pm. Enjoy your meal.');
  });

  it('dates a delivery from another day (S1.4)', () => {
    const view = withProgress('DELIVERED', {
      deliveredAt: '2026-11-20T07:37:00.000Z',
      asOf: '2026-11-23T08:00:00.000Z',
    });
    expect(stepLine(view, 'delivered', false)).toBe(
      'Delivered on Fri, Nov 20 at 2:37 am. Enjoy your meal.',
    );
  });

  it('announces a status change and titles the tab (S8.1, design 6.12)', () => {
    const view = withProgress('PREPARING', { steps: stepsAt('preparing') });
    expect(statusAnnouncement(view)).toBe(
      'Order 1042: Cooking. The kitchen is cooking your food now.',
    );
    expect(orderTabTitle(view)).toBe('Cooking · Order 1042');
    expect(orderTabTitle(withProgress('DELIVERED'))).toBe('Order 1042');
  });
});

describe('arrival lines (design 6.5)', () => {
  const window = { from: '2026-11-20T01:09:00.000Z', to: '2026-11-20T01:19:00.000Z' };
  it('shows the promised window, and says when the kitchen is behind', () => {
    expect(
      arrivalText({ kind: 'promised', ...window, lateMinutes: null, behind: false }, null, TZ),
    ).toMatchObject({
      headline: 'Arriving about 8:09–8:19 pm',
      spoken: 'Arriving about 8:09 to 8:19 pm',
      note: null,
    });
    expect(
      arrivalText({ kind: 'promised', ...window, lateMinutes: null, behind: true }, null, TZ)?.note
        ?.text,
    ).toMatch(/^The kitchen is running a little behind/);
  });

  it('moves the window when the food was ready late, and warns once it has passed', () => {
    expect(
      arrivalText({ kind: 'moved', ...window, lateMinutes: 12, behind: false }, null, TZ),
    ).toMatchObject({
      headline: 'Now arriving about 8:09–8:19 pm',
      note: { text: 'Running about 12 minutes late. Sorry for the wait.' },
    });
    expect(
      arrivalText({ kind: 'pastDue', ...window, lateMinutes: null, behind: false }, null, TZ),
    ).toMatchObject({ tone: 'late', headline: 'Due by 8:19 pm', note: { phone: true } });
    expect(
      arrivalText(null, '2026-11-20T01:14:00.000Z', TZ, '2026-11-20T02:00:00.000Z')?.headline,
    ).toBe('Delivered at 8:14 pm');
    expect(
      arrivalText(null, '2026-11-20T07:37:00.000Z', TZ, '2026-11-23T08:00:00.000Z')?.headline,
    ).toBe('Delivered Fri, Nov 20 at 2:37 am');
  });

  it('keeps ":00" on the hour unless both ends are on it', () => {
    expect(promised('2026-11-20T08:00:00.000Z', '2026-11-20T08:10:00.000Z')?.headline).toBe(
      'Arriving about 3:00–3:10 am',
    );
    expect(promised('2026-11-20T08:50:00.000Z', '2026-11-20T09:00:00.000Z')?.spoken).toBe(
      'Arriving about 3:50 to 4:00 am',
    );
    expect(promised('2026-11-20T08:00:00.000Z', '2026-11-20T09:00:00.000Z')?.headline).toBe(
      'Arriving about 3–4 am',
    );
  });

  it('explains why an accepted order can’t be cancelled (S4.2)', () => {
    expect(acceptedCancelSentence('(617) 555-0142')).toBe(
      "The kitchen has accepted your order, so it can't be cancelled here. Need to change something? Call us on (617) 555-0142.",
    );
  });
});

describe('the cancellation card (design 6.8)', () => {
  const notice: CancellationNotice = {
    by: 'store',
    opener: 'sorry',
    reasonLine: 'ranOut',
    dishes: ['Pad Thai'],
    moneyLine: 'refunding',
    amountCents: 5397,
    cardLabel: 'Visa •••• 4242',
    refundedAt: null,
    tipIncluded: false,
    codeReleased: 'LASTONE',
    refundSlow: false,
    at: '2026-11-20T00:31:00.000Z',
  };

  it('opens, explains and talks money without naming staff (S5.5, S5.6)', () => {
    expect(cancellationOpener('1046', notice)).toBe('Sorry, we had to cancel order 1046.');
    expect(cancellationOpener('1050', { ...notice, opener: 'plain' })).toBe(
      'Order 1050 is cancelled.',
    );
    expect(cancellationReason('ranOut', ['Gimbap', 'Pad Thai', 'Bulgogi'])).toBe(
      "The kitchen ran out of Gimbap, Pad Thai and Bulgogi, so we couldn't make your order.",
    );
    expect(cancellationReason('couldNotAccept', [])).toContain('{phone}');
    expect(cancellationMoney(notice, TZ)).toBe(
      "We're refunding $53.97 to Visa •••• 4242. It can take 5 to 10 business days to appear.",
    );
    expect(cancellationMoney({ ...notice, tipIncluded: true, amountCents: 5903 }, TZ)).toBe(
      "We're refunding $59.03 to Visa •••• 4242, tip included. It can take 5 to 10 business days to appear.",
    );
    expect(cancellationMoney({ ...notice, moneyLine: 'sample' }, TZ)).toBe(
      "This sample order had no real card payment, so there's nothing to refund.",
    );
    expect(
      cancellationMoney(
        { ...notice, moneyLine: 'refunded', refundedAt: '2026-11-22T15:00:00.000Z' },
        TZ,
      ),
    ).toBe(
      'Refunded $53.97 to Visa •••• 4242 on November 22. It can take 5 to 10 business days to appear.',
    );
  });

  it('says it at once, assertively (S5.8)', () => {
    expect(cancellationAnnouncement('1046', notice)).toBe(
      "Order 1046 was cancelled. The kitchen ran out of Pad Thai, so we couldn't make your order. We're refunding $53.97 to Visa ending 4242.",
    );
    expect(cancellationAnnouncement('1046', { ...notice, moneyLine: 'sample' })).toMatch(
      /so we couldn't make your order\. This sample order had no real card payment, so there's nothing to refund\.$/,
    );
  });
});

describe('the timeline (design 6.9)', () => {
  it('words the kitchen steps and a store cancellation', () => {
    const at = '2026-11-20T00:31:00.000Z';
    expect(progressTimelineLabel({ kind: 'accepted', at, amountCents: null })).toBe(
      'Accepted by the kitchen',
    );
    expect(
      progressTimelineLabel({ kind: 'pickedUp', at, amountCents: null, collected: true }),
    ).toBe('Collected');
    expect(progressTimelineLabel({ kind: 'delivered', at, amountCents: 5397 })).toBe(
      'Delivered · paid $53.97 in cash',
    );
    expect(
      progressTimelineLabel({
        kind: 'cancelled',
        at,
        amountCents: null,
        cancellation: { by: 'store', reasonLine: 'tooBusy', dishes: [] },
      }),
    ).toBe('Cancelled · Our kitchen is too busy to make your order in good time.');
    expect(
      progressTimelineLabel({
        kind: 'cancelled',
        at,
        amountCents: null,
        cancellation: { by: 'you', reasonLine: null, dishes: [] },
      }),
    ).toBeNull();
    expect(paidCardOrder().payment.method).toBe('card');
  });
});

describe('order again (design 8)', () => {
  it('says what was added, and words each item left out', () => {
    expect(addedText(3)).toBe('Added 3 dishes to your cart');
    expect(addedText(1)).toBe('Added 1 dish to your cart');
    expect(leftOutSentence({ kind: 'soldOut', dish: 'Naengmyeon' })).toBe(
      'Naengmyeon is sold out, so we left it out.',
    );
    expect(leftOutSentence({ kind: 'extraDropped', dish: 'Gimbap', extra: 'Gochujang' })).toBe(
      'Gochujang is no longer offered on Gimbap, so we left it off.',
    );
    expect(leftOutSentence({ kind: 'kitchenRanOut', dish: 'Pad Thai' })).toBe(
      'The kitchen ran out of Pad Thai today, so we left it out.',
    );
    expect(leftOutSentence({ kind: 'offMenu', dish: 'Japchae' })).toBe(
      'Japchae is no longer on our menu, so we left it out.',
    );
  });
});
