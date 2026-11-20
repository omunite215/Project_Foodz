import type { DisputeStatus, OrderStatus, PaymentStatus } from '@/server/db/enums';
import type { IntentStatus } from '@/server/payments/stripe';
import type { Decline, OrderStatusWord, OrderSummary } from './schema';

/*
 * The order's payment rules (story B1, U2, U6, U10, S10), as pure functions. The service reads
 * the facts, asks these what to do, and does it under a row lock, so the webhook and the
 * direct check with Stripe (B7) reach the same decision and only one of them acts on it.
 */

export interface OrderPaymentFacts {
  status: OrderStatus;
  paymentMethod: 'CASH' | 'CARD';
  paymentStatus: PaymentStatus;
  totalCents: number;
  cancelReason: string | null;
  autoRefundReason: string | null;
}

export interface IntentFacts {
  status: IntentStatus;
  amountCents: number;
  amountReceivedCents: number;
  currency: string;
  lastError: Decline | null;
}

export type PaymentDecision =
  /** Nothing to change. */
  | { kind: 'none' }
  /** Waiting → PLACED and PAID; the code is used. */
  | { kind: 'place' }
  /** Waiting → FAILED; the code is released (U2). */
  | { kind: 'fail'; decline: Decline }
  /** Paid after the order expired or failed: place it if still possible, else refund (U10). */
  | { kind: 'late' }
  /** Paid for an order the customer had cancelled: refund in full. */
  | { kind: 'refundUnwanted' }
  /** The payment doesn't match the order: never place it; refund in full (S10.4). */
  | { kind: 'mismatch' };

const matches = (order: OrderPaymentFacts, intent: IntentFacts) =>
  intent.currency.toLowerCase() === 'usd' &&
  intent.amountCents === order.totalCents &&
  intent.amountReceivedCents === order.totalCents;

export function decidePayment(order: OrderPaymentFacts, intent: IntentFacts): PaymentDecision {
  // Money already taken for this order is never undone here (a paid order never goes back).
  if (order.paymentMethod !== 'CARD' || order.paymentStatus !== 'UNPAID') return { kind: 'none' };

  if (intent.status === 'succeeded') {
    if (!matches(order, intent)) {
      return order.autoRefundReason === 'mismatch' ? { kind: 'none' } : { kind: 'mismatch' };
    }
    switch (order.status) {
      case 'PENDING_PAYMENT':
        return { kind: 'place' };
      case 'FAILED':
        return { kind: 'late' };
      case 'CANCELLED':
        return order.cancelReason === 'payment-expired'
          ? { kind: 'late' }
          : { kind: 'refundUnwanted' };
      default:
        return { kind: 'none' };
    }
  }

  if (order.status !== 'PENDING_PAYMENT') return { kind: 'none' };
  if (intent.status === 'canceled') {
    return { kind: 'fail', decline: { code: 'canceled', declineCode: null } };
  }
  if (intent.status === 'requires_payment_method' && intent.lastError) {
    return { kind: 'fail', decline: intent.lastError };
  }
  return { kind: 'none' };
}

/** U10: placed after all only when nothing about it has changed; otherwise refunded. */
export function decideLatePayment(facts: {
  dishesAvailable: boolean;
  storeOpen: boolean;
  /** No newer live order holds the same checkout key. */
  attemptKeyFree: boolean;
}): 'revive' | 'refund' {
  return facts.dishesAvailable && facts.storeOpen && facts.attemptKeyFree ? 'revive' : 'refund';
}

/**
 * The expiry job (B8): notYet before the time; expire once the payment is cancelled or was
 * never made; paid when Stripe already took the money (the order is placed); wait while the
 * bank is still processing.
 */
export function decideExpiry(
  order: { status: OrderStatus; expiresAt: Date | null },
  now: Date,
  intent: IntentFacts | null,
): 'none' | 'notYet' | 'expire' | 'paid' | 'wait' {
  if (order.status !== 'PENDING_PAYMENT') return 'none';
  if (order.expiresAt && order.expiresAt.getTime() > now.getTime()) return 'notYet';
  if (!intent) return 'expire';
  if (intent.status === 'succeeded') return 'paid';
  if (intent.status === 'processing') return 'wait';
  return 'expire';
}

/** U6: until the kitchen accepts. In M1 nothing accepts orders, so every placed order can. */
export const canCancel = (status: OrderStatus) =>
  status === 'PENDING_PAYMENT' || status === 'PLACED';

/** "Finish paying" (S7.6): waiting for payment with time left. */
export const isPayable = (order: { status: OrderStatus; expiresAt: Date | null }, now: Date) =>
  order.status === 'PENDING_PAYMENT' &&
  (order.expiresAt === null || order.expiresAt.getTime() > now.getTime());

const WORDS: Record<OrderStatus, OrderStatusWord> = {
  PENDING_PAYMENT: 'waitingForPayment',
  PLACED: 'placed',
  ACCEPTED: 'accepted',
  PREPARING: 'preparing',
  READY: 'ready',
  PICKED_UP: 'pickedUp',
  DELIVERED: 'delivered',
  CANCELLED: 'cancelled',
  // Failed attempts are never listed; the word is only a fallback.
  FAILED: 'cancelled',
};

export function statusWord(status: OrderStatus, cancelReason: string | null): OrderStatusWord {
  if (status === 'CANCELLED' && cancelReason === 'payment-expired') return 'expired';
  return WORDS[status];
}

export function moneyFlag(
  paymentStatus: PaymentStatus,
  disputeStatus: DisputeStatus,
): OrderSummary['moneyFlag'] {
  if (disputeStatus === 'OPEN' || disputeStatus === 'LOST') return 'disputed';
  if (paymentStatus === 'REFUNDED') return 'refunded';
  if (paymentStatus === 'PARTIALLY_REFUNDED') return 'partlyRefunded';
  return null;
}
