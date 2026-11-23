import { describe, expect, it } from 'vitest';
import {
  orderSummaryFixture,
  orderViewFixture,
  paidCardOrder,
  VISA,
} from '@/components/orders/orders.fixtures';
import {
  arrivingText,
  cancelDescription,
  countdownText,
  dishesText,
  eventTimeText,
  moneyNotices,
  ORDER_HEADINGS,
  orderDateText,
  orderLine,
  orderStateOf,
  paymentLine,
  placedAtText,
  telOf,
  timelineLabel,
} from './order-text';

const TZ = 'America/New_York';
// Thursday 19 November 2026, 7:30 pm in Boston.
const NOW = new Date('2026-11-20T00:30:00.000Z');

describe('dates in Boston time (design 4.2)', () => {
  it('says today, yesterday, a date, or a date with the year', () => {
    expect(orderDateText('2026-11-20T00:02:00.000Z', NOW, TZ)).toBe('Today, 7:02 pm');
    expect(orderDateText('2026-11-19T00:02:00.000Z', NOW, TZ)).toBe('Yesterday, 7:02 pm');
    expect(orderDateText('2026-11-16T15:00:00.000Z', NOW, TZ)).toBe('Nov 16, 10 am');
    expect(orderDateText('2025-11-19T15:30:00.000Z', NOW, TZ)).toBe('Nov 19, 2025, 10:30 am');
  });

  it('gives the timeline a clock time today and a date otherwise', () => {
    expect(eventTimeText('2026-11-20T00:02:00.000Z', NOW, TZ)).toBe('7:02 pm');
    expect(eventTimeText('2026-11-18T15:00:00.000Z', NOW, TZ)).toBe('Nov 18');
  });

  it('writes the receipt date in full', () => {
    expect(placedAtText('2026-11-20T00:02:00.000Z', TZ)).toBe(
      'Placed Thursday, November 19 at 7:02 pm',
    );
  });

  it('shares am and pm across an arrival window', () => {
    expect(arrivingText('2026-11-20T00:35:00.000Z', '2026-11-20T00:45:00.000Z', TZ)).toEqual({
      text: 'Arriving about 7:35–7:45 pm',
      spoken: 'Arriving about 7:35 to 7:45 pm',
    });
    expect(arrivingText('2026-11-19T16:55:00.000Z', '2026-11-19T17:05:00.000Z', TZ).text).toBe(
      'Arriving about 11:55 am–12:05 pm',
    );
  });
});

describe('the unpaid countdown (S9.3)', () => {
  it('counts whole minutes, then less than a minute, then nothing', () => {
    const now = Date.parse('2026-11-20T00:30:00.000Z');
    expect(countdownText('2026-11-20T00:42:30.000Z', now)).toBe(
      'Waiting for payment · 12 min left',
    );
    expect(countdownText('2026-11-20T00:30:40.000Z', now)).toBe('Less than a minute left');
    expect(countdownText('2026-11-20T00:29:00.000Z', now)).toBeNull();
  });
});

describe('the orders list (S12.1)', () => {
  it('names up to three dishes and counts the rest', () => {
    const order = orderSummaryFixture();
    expect(dishesText(order.dishes, 0)).toBe('Gimbap ×2, Pad Thai');
    expect(dishesText(order.dishes, 2)).toBe('Gimbap ×2, Pad Thai +2 more');
  });
});

describe('order states (design 3.9)', () => {
  it('follows the order, with confirming as the browser state', () => {
    const view = orderViewFixture();
    expect(orderStateOf(view, false)).toBe('placed');
    expect(orderStateOf({ ...view, status: 'PENDING_PAYMENT' }, true)).toBe('confirming');
    expect(orderStateOf({ ...view, status: 'PENDING_PAYMENT' }, false)).toBe('waiting');
    expect(orderStateOf({ ...view, status: 'FAILED' }, false)).toBe('failed');
    expect(orderStateOf({ ...view, status: 'CANCELLED', cancelReason: 'customer' }, false)).toBe(
      'cancelled',
    );
    expect(
      orderStateOf({ ...view, status: 'CANCELLED', cancelReason: 'payment-expired' }, false),
    ).toBe('expired');
    expect(
      orderStateOf(
        {
          ...view,
          status: 'FAILED',
          flags: { ...view.flags, mismatchRefund: true },
        },
        false,
      ),
    ).toBe('mismatch');
    expect(ORDER_HEADINGS.confirming).toBe('Confirming your payment…');
  });

  it('words each line, naming the decline when it is known', () => {
    const failed = paidCardOrder({
      status: 'FAILED',
      payment: {
        method: 'card',
        status: 'UNPAID',
        card: VISA,
        decline: { code: 'card_declined', declineCode: 'insufficient_funds' },
      },
    });
    expect(orderLine(failed, 'failed')).toBe(
      'Nothing was charged. Your card was declined for insufficient funds. Try another card, or pay with cash.',
    );
    expect(orderLine(orderViewFixture(), 'waiting')).toBe('Order 1042 · $53.97');
    expect(orderLine(orderViewFixture(), 'cancelled')).toBe('Nothing was charged.');
    expect(orderLine(paidCardOrder(), 'cancelled')).toBeNull();
  });
});

describe('money notices (S9.5, S10.1, S10.4, S10.6, S12.5)', () => {
  it('says the refund is on its way after cancelling a paid card order', () => {
    const view = paidCardOrder({ status: 'CANCELLED', cancelReason: 'customer' });
    expect(moneyNotices(view, 'cancelled').map((notice) => notice.text)).toEqual([
      "We're refunding $61.17 to Visa •••• 4242. It can take 5 to 10 business days to appear.",
    ]);
    const refunded = paidCardOrder({
      status: 'CANCELLED',
      cancelReason: 'customer',
      payment: { method: 'card', status: 'REFUNDED', card: VISA, decline: null },
      refunds: { refundedCents: 6117, entries: [{ amountCents: 6117, at: NOW.toISOString() }] },
    });
    expect(moneyNotices(refunded, 'cancelled')[0]?.text).toBe(
      'Refunded $61.17 to Visa •••• 4242 on November 19. It can take 5 to 10 business days to appear.',
    );
  });

  it('words a partial refund and disputes', () => {
    const view = paidCardOrder({
      payment: { method: 'card', status: 'PARTIALLY_REFUNDED', card: VISA, decline: null },
      refunds: { refundedCents: 500, entries: [{ amountCents: 500, at: NOW.toISOString() }] },
      dispute: { status: 'OPEN', openedAt: NOW.toISOString(), closedAt: null },
    });
    expect(moneyNotices(view, 'placed').map((notice) => notice.text)).toEqual([
      'Refunded $5.00 of $61.17 to Visa •••• 4242 on November 19.',
      "Your bank has opened a dispute about this payment. You don't need to do anything here; your bank will contact you.",
    ]);
  });

  it('explains late payments and mismatches', () => {
    const revived = paidCardOrder({
      flags: { revivedAfterLatePayment: true, lateRefund: false, mismatchRefund: false },
    });
    expect(moneyNotices(revived, 'placed')[0]?.text).toBe(
      "Your payment arrived just after the deadline, and we've placed order 1042.",
    );
    const mismatch = paidCardOrder({
      flags: { revivedAfterLatePayment: false, lateRefund: false, mismatchRefund: true },
    });
    expect(moneyNotices(mismatch, 'mismatch')).toEqual([
      {
        key: 'mismatch',
        variant: 'error',
        text: 'Something went wrong with this payment, so we refunded $61.17 in full. Please place your order again.',
      },
    ]);
  });
});

describe('timeline and receipt', () => {
  it('labels events in the one set of words', () => {
    const cash = orderViewFixture();
    expect(timelineLabel('placed', null, cash)).toBe('Placed · Cash on delivery');
    expect(timelineLabel('placed', null, paidCardOrder())).toBe(
      'Placed · Paid with Visa •••• 4242',
    );
    expect(timelineLabel('cancelled', null, { ...cash, cancelReason: 'customer' })).toBe(
      'Cancelled by you',
    );
    expect(timelineLabel('refunded', 5397, cash)).toBe('Refunded $53.97');
    expect(timelineLabel('expired', null, cash)).toBe('Expired, not paid');
  });

  it('says how it was paid', () => {
    expect(paymentLine(orderViewFixture(), 'placed').text).toBe('Cash on delivery · $53.97 to pay');
    expect(paymentLine(orderViewFixture(), 'cancelled').text).toBe(
      'Cash on delivery · nothing to pay',
    );
    expect(paymentLine(paidCardOrder(), 'placed')).toEqual({
      text: 'Paid · Visa •••• 4242',
      spoken: 'Paid with Visa ending in 4242',
    });
  });

  it('describes what cancelling does', () => {
    expect(cancelDescription(orderViewFixture())).toBe('Nothing has been charged.');
    expect(cancelDescription(paidCardOrder())).toBe(
      "We'll refund $61.17 to Visa •••• 4242. It can take 5 to 10 business days to appear.",
    );
  });

  it('promises only what cancelling refunds (security S13)', () => {
    // Part refunded before: the rest comes back, not "nothing has been charged".
    const partly = paidCardOrder({
      payment: { method: 'card', status: 'PARTIALLY_REFUNDED', card: VISA, decline: null },
      refunds: { refundedCents: 500, entries: [{ amountCents: 500, at: NOW.toISOString() }] },
    });
    expect(cancelDescription(partly)).toBe(
      "We'll refund $56.17 to Visa •••• 4242. It can take 5 to 10 business days to appear.",
    );
    // Refunded in full already: charged and refunded, nothing more to come.
    const refunded = paidCardOrder({
      payment: { method: 'card', status: 'REFUNDED', card: VISA, decline: null },
      refunds: { refundedCents: 6117, entries: [{ amountCents: 6117, at: NOW.toISOString() }] },
    });
    expect(cancelDescription(refunded)).toBe('Your payment was refunded on November 19.');
  });

  it('says the rest is on its way after cancelling a partly refunded order (security S13)', () => {
    const view = paidCardOrder({
      status: 'CANCELLED',
      cancelReason: 'customer',
      payment: { method: 'card', status: 'PARTIALLY_REFUNDED', card: VISA, decline: null },
      refunds: { refundedCents: 500, entries: [{ amountCents: 500, at: NOW.toISOString() }] },
    });
    expect(moneyNotices(view, 'cancelled').map((notice) => notice.text)).toEqual([
      "We're refunding the remaining $56.17 to Visa •••• 4242. It can take 5 to 10 business days to appear.",
      'Refunded $5.00 of $61.17 to Visa •••• 4242 on November 19.',
    ]);
  });

  it('turns the store phone into a tel: target', () => {
    expect(telOf('(617) 555-0142')).toBe('+16175550142');
  });
});
