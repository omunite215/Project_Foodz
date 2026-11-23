import { describe, expect, it } from 'vitest';
import {
  arrivalOf,
  buildProgress,
  cancellationOf,
  customerTimeline,
  type ProgressEvent,
  type ProgressFacts,
  readyByOf,
  stepsOf,
  summaryProgress,
} from './progress';

// T = 7:30 pm in Boston (00:30 UTC the next day), as the story's fixtures use it.
const T = new Date('2026-11-21T00:30:00.000Z');
const at = (minutes: number) => new Date(T.getTime() + minutes * 60_000);
const LINE_A = '0196a1b2-0000-7000-8000-0000000000a1';
const LINE_B = '0196a1b2-0000-7000-8000-0000000000a2';

let ids = 0;
const event = (
  type: string,
  minutes: number,
  data: Record<string, unknown> = {},
  fromStatus: ProgressEvent['fromStatus'] = null,
): ProgressEvent => ({
  id: `0196a1b2-0000-7000-8000-${String((ids += 1)).padStart(12, '0')}`,
  type,
  fromStatus,
  data,
  createdAt: at(minutes),
});

function facts(extra: Partial<ProgressFacts> = {}): ProgressFacts {
  return {
    status: 'PLACED',
    version: 2,
    paymentMethod: 'CASH',
    paymentStatus: 'UNPAID',
    totalCents: 5397,
    refundedCents: 0,
    tipCents: 0,
    cardBrand: null,
    cardLast4: null,
    hasPaymentIntent: false,
    autoRefundReason: null,
    placedAt: at(-1),
    acceptedAt: null,
    preparingAt: null,
    readyAt: null,
    pickedUpAt: null,
    deliveredAt: null,
    cancelledAt: null,
    cancelReason: null,
    cancelCode: null,
    cancelLineIds: [],
    prepMinutes: 24,
    arrivalFromMinutes: 40,
    arrivalToMinutes: 50,
    items: [
      { id: LINE_A, title: 'Gimbap' },
      { id: LINE_B, title: 'Pad Thai' },
    ],
    events: [],
    ...extra,
  };
}

describe('ready-by (A2.5)', () => {
  it('is placed plus the longest prep, and unknown for older orders', () => {
    expect(readyByOf(facts())?.toISOString()).toBe(at(23).toISOString());
    expect(readyByOf(facts({ prepMinutes: null }))).toBeNull();
  });
});

describe('the stepper (S1.1, S1.2)', () => {
  it('ticks the steps done with their times and marks the current one (S1103)', () => {
    const steps = stepsOf(
      facts({ status: 'ACCEPTED', placedAt: at(-4), acceptedAt: at(-3), prepMinutes: 20 }),
    );
    expect(steps?.map((step) => [step.key, step.state, step.at])).toEqual([
      ['placed', 'done', at(-4).toISOString()],
      ['accepted', 'current', at(-3).toISOString()],
      ['preparing', 'upcoming', null],
      ['ready', 'upcoming', null],
      ['pickedUp', 'upcoming', null],
      ['delivered', 'upcoming', null],
    ]);
  });

  it('has no stepper while waiting for payment, failed or cancelled', () => {
    for (const status of ['PENDING_PAYMENT', 'FAILED', 'CANCELLED'] as const) {
      expect(stepsOf(facts({ status }))).toBeNull();
    }
  });

  it('marks the courier step collected when the customer picked it up (U23)', () => {
    const steps = stepsOf(
      facts({
        status: 'PICKED_UP',
        pickedUpAt: at(0),
        events: [event('picked-up', 0, { reason: 'customer-collected' }, 'READY')],
      }),
    );
    expect(steps?.find((step) => step.key === 'pickedUp')).toMatchObject({
      state: 'current',
      collected: true,
    });
  });
});

describe('the arrival window (S2)', () => {
  it('keeps the promised window while things are on track (S1101)', () => {
    expect(arrivalOf(facts(), T)).toEqual({
      kind: 'promised',
      from: at(39).toISOString(),
      to: at(49).toISOString(),
      lateMinutes: null,
      behind: false,
    });
  });

  it('says the kitchen is behind 5 minutes past ready-by while cooking (S1105)', () => {
    const s1105 = facts({
      status: 'PREPARING',
      placedAt: at(-30),
      acceptedAt: at(-28),
      preparingAt: at(-25),
      prepMinutes: 20,
      arrivalFromMinutes: 35,
      arrivalToMinutes: 45,
    });
    expect(arrivalOf(s1105, T)).toMatchObject({ kind: 'promised', behind: true });
    expect(arrivalOf(s1105, at(-6))).toMatchObject({ behind: false });
  });

  it('moves the window by the whole minutes ready was late, 5 or more (S1107)', () => {
    const s1107 = facts({
      status: 'READY',
      placedAt: at(-40),
      readyAt: at(-16),
      prepMinutes: 12,
      arrivalFromMinutes: 30,
      arrivalToMinutes: 40,
    });
    expect(arrivalOf(s1107, T)).toEqual({
      kind: 'moved',
      from: at(2).toISOString(),
      to: at(12).toISOString(),
      lateMinutes: 12,
      behind: false,
    });
    // Ready 4 minutes late: the window stays (asked before it has passed).
    expect(arrivalOf({ ...s1107, readyAt: at(-24) }, at(-20))).toMatchObject({
      kind: 'promised',
      lateMinutes: null,
    });
    // Early never moves it earlier.
    expect(arrivalOf({ ...s1107, readyAt: at(-35) }, at(-30))).toMatchObject({
      kind: 'promised',
    });
  });

  it('turns past due once the end has passed, and goes when delivered or cancelled', () => {
    expect(arrivalOf(facts(), at(49))).toMatchObject({ kind: 'pastDue', to: at(49).toISOString() });
    expect(arrivalOf(facts({ status: 'DELIVERED' }), T)).toBeNull();
    expect(arrivalOf(facts({ status: 'CANCELLED' }), T)).toBeNull();
    expect(arrivalOf(facts({ arrivalFromMinutes: null, arrivalToMinutes: null }), T)).toBeNull();
  });
});

describe('the whole progress (S2.5, S3.9)', () => {
  it('words a Placed order that waits 5 and 15 minutes, and says when that changes', () => {
    expect(buildProgress(facts(), T)).toMatchObject({
      placedWaiting: 'none',
      live: true,
      refreshAt: at(4).toISOString(),
    });
    expect(buildProgress(facts(), at(5)).placedWaiting).toBe('5');
    expect(buildProgress(facts(), at(14)).placedWaiting).toBe('15');
  });

  it('shows the delivery time and cash collected, and holds no connection after', () => {
    const delivered = buildProgress(
      facts({ status: 'DELIVERED', paymentStatus: 'PAID', deliveredAt: at(30) }),
      at(40),
    );
    expect(delivered).toMatchObject({
      deliveredAt: at(30).toISOString(),
      cashCollected: true,
      live: false,
      arrival: null,
      steps: expect.arrayContaining([expect.objectContaining({ key: 'delivered', state: 'done' })]),
    });
  });
});

/** Priya's card order refused for Pad Thai, as the kitchen stores it (A6.4). */
const refused = (extra: Partial<ProgressFacts> = {}) =>
  facts({
    status: 'CANCELLED',
    cancelledAt: T,
    cancelReason: 'kitchen-refused',
    cancelCode: 'dish-unavailable',
    cancelLineIds: [LINE_B],
    paymentMethod: 'CARD',
    paymentStatus: 'PAID',
    cardBrand: 'visa',
    cardLast4: '4242',
    hasPaymentIntent: true,
    autoRefundReason: 'staff-cancel',
    events: [
      event('refused', 0, {
        actor: 'staff',
        by: { name: 'Alex Kim', role: 'kitchen' },
        reason: 'dish-unavailable',
        lineIds: [LINE_B],
        note: 'Fryer broke, ask Alex',
        refundCents: 5397,
        refundAnnounced: true,
        sample: false,
        codeReleased: 'LASTONE',
      }),
    ],
    ...extra,
  });

describe('cancellations (S5)', () => {
  it('tells her the store cancelled, with the dishes, the refund and the code (S5.1)', () => {
    expect(cancellationOf(refused(), T)).toEqual({
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
      at: T.toISOString(),
    });
  });

  it('never carries a staff name, role, note or the reason code (S5.6)', () => {
    const text = JSON.stringify(buildProgress(refused(), T));
    expect(text).not.toMatch(/Alex|kitchen|Fryer|dish-unavailable|refused|staff/i);
    expect(JSON.stringify(customerTimeline(refused()))).not.toMatch(/Alex|Fryer|dish-unavailable/);
  });

  it('turns refunding into refunded once Stripe confirms, and slow after 15 minutes', () => {
    expect(cancellationOf(refused(), at(16))?.refundSlow).toBe(true);
    const done = cancellationOf(
      refused({
        paymentStatus: 'REFUNDED',
        refundedCents: 5397,
        events: [...refused().events, event('refunded', 2, { amountCents: 5397 })],
      }),
      at(3),
    );
    expect(done).toMatchObject({
      moneyLine: 'refunded',
      amountCents: 5397,
      refundedAt: at(2).toISOString(),
      refundSlow: false,
    });
  });

  it('says plainly when she asked, nothing charged for cash, and sample for seeded cards', () => {
    expect(
      cancellationOf(
        refused({
          cancelReason: 'staff',
          cancelCode: 'customer-asked',
          paymentMethod: 'CASH',
          paymentStatus: 'UNPAID',
          hasPaymentIntent: false,
          autoRefundReason: null,
        }),
        T,
      ),
    ).toMatchObject({
      opener: 'plain',
      reasonLine: 'atYourRequest',
      moneyLine: 'nothing',
      dishes: [],
    });
    expect(
      cancellationOf(refused({ hasPaymentIntent: false, autoRefundReason: null }), T),
    ).toMatchObject({ moneyLine: 'sample', amountCents: null });
  });

  it("keeps her own cancellation as hers, and leaves expired orders to F4's page", () => {
    expect(
      cancellationOf(facts({ status: 'CANCELLED', cancelledAt: T, cancelReason: 'customer' }), T),
    ).toMatchObject({ by: 'you', opener: null, reasonLine: null, moneyLine: 'nothing' });
    expect(
      cancellationOf(
        facts({ status: 'CANCELLED', cancelledAt: T, cancelReason: 'payment-expired' }),
        T,
      ),
    ).toBeNull();
  });

  it('stays live until a card refund is confirmed (S3.9)', () => {
    expect(buildProgress(refused(), T).live).toBe(true);
    expect(buildProgress(refused({ paymentMethod: 'CASH', autoRefundReason: null }), T).live).toBe(
      false,
    );
  });
});

describe('the customer timeline (S6.7)', () => {
  it('drops undone and moved-back steps, keeping the ones redone', () => {
    const accepted = event('accepted', 1, { by: { name: 'Alex Kim', role: 'kitchen' } }, 'PLACED');
    const timeline = customerTimeline(
      facts({
        status: 'PREPARING',
        events: [
          event('placed', 0, { actor: 'customer', method: 'cash' }),
          accepted,
          event('undone', 2, { eventId: accepted.id, undid: 'ACCEPTED' }, 'ACCEPTED'),
          event('accepted', 3, {}, 'PLACED'),
          event('preparing', 4, {}, 'ACCEPTED'),
          event('ready', 5, { lateMinutes: 0 }, 'PREPARING'),
          event('moved-back', 6, { reason: 'marked-ready-by-mistake' }, 'READY'),
        ],
      }),
    );
    expect(timeline.map((entry) => [entry.kind, entry.at])).toEqual([
      ['placed', at(0).toISOString()],
      ['accepted', at(3).toISOString()],
      ['preparing', at(4).toISOString()],
    ]);
  });

  it('reads the hand-over and the cash, and the store cancellation by its line', () => {
    const timeline = customerTimeline(
      facts({
        status: 'DELIVERED',
        events: [
          event('picked-up', 1, { reason: 'customer-collected' }, 'READY'),
          event('delivered', 2, { reason: 'own-driver', cashCollectedCents: 5397 }, 'PICKED_UP'),
        ],
      }),
    );
    expect(timeline).toEqual([
      { kind: 'pickedUp', at: at(1).toISOString(), amountCents: null, collected: true },
      { kind: 'delivered', at: at(2).toISOString(), amountCents: 5397 },
    ]);
    const cancelled = customerTimeline(
      facts({
        status: 'CANCELLED',
        events: [
          event('cancelled', 1, {
            actor: 'staff',
            reason: 'customer-asked',
            lineIds: [],
            note: 'Called back to confirm',
          }),
        ],
      }),
    );
    expect(cancelled).toEqual([
      {
        kind: 'cancelled',
        at: at(1).toISOString(),
        amountCents: null,
        cancellation: { by: 'store', reasonLine: 'atYourRequest', dishes: [] },
      },
    ]);
  });
});

describe('the orders list (S7.1, S7.5)', () => {
  it('gives in-progress rows their arrival, finished rows "Order again", and "Collected"', () => {
    expect(summaryProgress(facts(), T)).toEqual({
      arrival: expect.objectContaining({ kind: 'promised' }),
      reorderable: false,
      collected: false,
    });
    expect(summaryProgress(facts({ status: 'DELIVERED' }), T)).toMatchObject({
      arrival: null,
      reorderable: true,
    });
    expect(
      summaryProgress(
        facts({
          status: 'PICKED_UP',
          events: [event('picked-up', 0, { reason: 'customer-collected' }, 'READY')],
        }),
        T,
      ).collected,
    ).toBe(true);
  });
});
