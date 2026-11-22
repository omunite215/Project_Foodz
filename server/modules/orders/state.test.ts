import { describe, expect, it } from 'vitest';
import {
  canCancel,
  decideExpiry,
  decideLatePayment,
  decidePayment,
  type IntentFacts,
  isPayable,
  moneyFlag,
  type OrderPaymentFacts,
  statusWord,
} from './state';

const NOW = new Date('2026-11-20T00:10:00Z');

const order = (extra: Partial<OrderPaymentFacts> = {}): OrderPaymentFacts => ({
  status: 'PENDING_PAYMENT',
  paymentMethod: 'CARD',
  paymentStatus: 'UNPAID',
  totalCents: 5397,
  cancelReason: null,
  autoRefundReason: null,
  ...extra,
});

const intent = (extra: Partial<IntentFacts> = {}): IntentFacts => ({
  status: 'succeeded',
  amountCents: 5397,
  amountReceivedCents: 5397,
  currency: 'usd',
  lastError: null,
  ...extra,
});

const declined = (code: string, declineCode: string | null = null) =>
  intent({
    status: 'requires_payment_method',
    amountReceivedCents: 0,
    lastError: { code, declineCode },
  });

describe('what a PaymentIntent means for its order (S10.1, B1)', () => {
  it('places a waiting order once the payment succeeds', () => {
    expect(decidePayment(order(), intent())).toEqual({ kind: 'place' });
  });

  it('changes nothing for an order already paid, whatever arrives later (S10.3)', () => {
    const paid = order({ status: 'PLACED', paymentStatus: 'PAID' });
    expect(decidePayment(paid, intent())).toEqual({ kind: 'none' });
    expect(decidePayment(paid, declined('card_declined'))).toEqual({ kind: 'none' });
    expect(decidePayment(paid, intent({ status: 'canceled' }))).toEqual({ kind: 'none' });
    const refunded = order({ status: 'CANCELLED', paymentStatus: 'REFUNDED' });
    expect(decidePayment(refunded, intent())).toEqual({ kind: 'none' });
  });

  it('ends the attempt on a decline or a failed bank check, with the reason (U2, S6.8)', () => {
    expect(decidePayment(order(), declined('card_declined', 'insufficient_funds'))).toEqual({
      kind: 'fail',
      decline: { code: 'card_declined', declineCode: 'insufficient_funds' },
    });
    expect(decidePayment(order(), declined('payment_intent_authentication_failure'))).toEqual({
      kind: 'fail',
      decline: { code: 'payment_intent_authentication_failure', declineCode: null },
    });
  });

  it('ends a waiting order whose payment was cancelled at Stripe, and leaves others alone', () => {
    expect(decidePayment(order(), intent({ status: 'canceled', amountReceivedCents: 0 }))).toEqual({
      kind: 'fail',
      decline: { code: 'canceled', declineCode: null },
    });
    const expired = order({ status: 'CANCELLED', cancelReason: 'payment-expired' });
    expect(decidePayment(expired, intent({ status: 'canceled' }))).toEqual({ kind: 'none' });
  });

  it('waits while the bank is still deciding, and for a payment not yet tried', () => {
    for (const status of ['processing', 'requires_action', 'requires_confirmation'] as const) {
      expect(decidePayment(order(), intent({ status, amountReceivedCents: 0 }))).toEqual({
        kind: 'none',
      });
    }
    expect(
      decidePayment(order(), intent({ status: 'requires_payment_method', amountReceivedCents: 0 })),
    ).toEqual({ kind: 'none' });
  });

  it('treats a payment for an expired or failed order as late (U10)', () => {
    expect(
      decidePayment(order({ status: 'CANCELLED', cancelReason: 'payment-expired' }), intent()),
    ).toEqual({ kind: 'late' });
    expect(decidePayment(order({ status: 'FAILED' }), intent())).toEqual({ kind: 'late' });
  });

  it('refunds a payment for an order the customer cancelled', () => {
    for (const cancelReason of ['customer', 'account-deleted']) {
      expect(decidePayment(order({ status: 'CANCELLED', cancelReason }), intent())).toEqual({
        kind: 'refundUnwanted',
      });
    }
  });

  it("never places an order whose payment doesn't match it, and handles that once (S10.4)", () => {
    expect(decidePayment(order(), intent({ amountReceivedCents: 5396 }))).toEqual({
      kind: 'mismatch',
    });
    expect(
      decidePayment(order(), intent({ amountCents: 9999, amountReceivedCents: 9999 })),
    ).toEqual({
      kind: 'mismatch',
    });
    expect(decidePayment(order(), intent({ currency: 'eur' }))).toEqual({ kind: 'mismatch' });
    expect(
      decidePayment(
        order({ status: 'FAILED', autoRefundReason: 'mismatch' }),
        intent({ currency: 'eur' }),
      ),
    ).toEqual({ kind: 'none' });
  });

  it('ignores card payments for cash orders', () => {
    expect(decidePayment(order({ paymentMethod: 'CASH', status: 'PLACED' }), intent())).toEqual({
      kind: 'none',
    });
  });
});

describe('a late payment (U10, S9.5)', () => {
  const unchanged = {
    dishesAvailable: true,
    storeOpen: true,
    attemptKeyFree: true,
    accountActive: true,
  };

  it('places the order after all when every dish is available, the store is open and the key is free', () => {
    expect(decideLatePayment(unchanged)).toBe('revive');
  });

  it('refunds in full otherwise', () => {
    expect(decideLatePayment({ ...unchanged, dishesAvailable: false })).toBe('refund');
    expect(decideLatePayment({ ...unchanged, storeOpen: false })).toBe('refund');
    expect(decideLatePayment({ ...unchanged, attemptKeyFree: false })).toBe('refund');
  });

  it('refunds in full when the account was deleted or suspended meanwhile (security S3)', () => {
    expect(decideLatePayment({ ...unchanged, accountActive: false })).toBe('refund');
  });
});

describe('the 15-minute expiry (B8)', () => {
  const waiting = {
    status: 'PENDING_PAYMENT' as const,
    expiresAt: new Date('2026-11-20T00:05:00Z'),
  };

  it('does nothing before the time, or for an order no longer waiting', () => {
    expect(
      decideExpiry({ ...waiting, expiresAt: new Date('2026-11-20T00:15:00Z') }, NOW, null),
    ).toBe('notYet');
    expect(decideExpiry({ ...waiting, status: 'PLACED' }, NOW, null)).toBe('none');
  });

  it('expires an unpaid order once its payment is cancelled or was never made', () => {
    expect(decideExpiry(waiting, NOW, null)).toBe('expire');
    expect(decideExpiry(waiting, NOW, intent({ status: 'canceled', amountReceivedCents: 0 }))).toBe(
      'expire',
    );
    expect(decideExpiry(waiting, NOW, declined('card_declined'))).toBe('expire');
  });

  it('applies a payment Stripe already took, and waits for one still processing', () => {
    expect(decideExpiry(waiting, NOW, intent())).toBe('paid');
    expect(
      decideExpiry(waiting, NOW, intent({ status: 'processing', amountReceivedCents: 0 })),
    ).toBe('wait');
  });
});

describe('cancelling, paying and the words for each state', () => {
  it('lets the customer cancel until the kitchen accepts (U6)', () => {
    expect(canCancel('PENDING_PAYMENT')).toBe(true);
    expect(canCancel('PLACED')).toBe(true);
    for (const status of ['ACCEPTED', 'PREPARING', 'READY', 'PICKED_UP', 'DELIVERED'] as const) {
      expect(canCancel(status)).toBe(false);
    }
    expect(canCancel('CANCELLED')).toBe(false);
    expect(canCancel('FAILED')).toBe(false);
  });

  it('offers "Finish paying" only while the order waits and has time left', () => {
    expect(
      isPayable({ status: 'PENDING_PAYMENT', expiresAt: new Date('2026-11-20T00:11:00Z') }, NOW),
    ).toBe(true);
    expect(
      isPayable({ status: 'PENDING_PAYMENT', expiresAt: new Date('2026-11-20T00:10:00Z') }, NOW),
    ).toBe(false);
    expect(isPayable({ status: 'PLACED', expiresAt: null }, NOW)).toBe(false);
  });

  it('words each state the same way everywhere (design 4.3)', () => {
    expect(statusWord('PENDING_PAYMENT', null)).toBe('waitingForPayment');
    expect(statusWord('PLACED', null)).toBe('placed');
    expect(statusWord('PICKED_UP', null)).toBe('pickedUp');
    expect(statusWord('DELIVERED', null)).toBe('delivered');
    expect(statusWord('CANCELLED', 'customer')).toBe('cancelled');
    expect(statusWord('CANCELLED', 'payment-expired')).toBe('expired');
  });

  it('flags refunds and disputes beside the total (S12.4)', () => {
    expect(moneyFlag('PAID', 'NONE')).toBeNull();
    expect(moneyFlag('REFUNDED', 'NONE')).toBe('refunded');
    expect(moneyFlag('PARTIALLY_REFUNDED', 'NONE')).toBe('partlyRefunded');
    expect(moneyFlag('PAID', 'OPEN')).toBe('disputed');
    expect(moneyFlag('PAID', 'LOST')).toBe('disputed');
    expect(moneyFlag('PAID', 'WON')).toBeNull();
  });
});
