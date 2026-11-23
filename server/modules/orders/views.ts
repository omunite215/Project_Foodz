import 'server-only';
import { displayPhone } from '@/lib/phone';
import { runAsSystem } from '@/server/db/context';
import { getStoreStatus } from '@/server/modules/menu/service';
import { buildProgress, customerTimeline, type ProgressFacts, summaryProgress } from './progress';
import { findOrderView, type OrderSummaryRow, type OrderViewRow } from './repo';
import { type CancelReason, type Decline, type OrderSummary, type OrderView } from './schema';
import { canCancel, isPayable, moneyFlag, statusWord } from './state';
import { cardLabel, cardSpoken } from './text';

/** The order page's data from the stored order: every figure is the snapshot, never re-quoted. */

const MINUTE_MS = 60_000;

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {};

const numberOr = (value: unknown, fallback: number | null) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const stringOr = (value: unknown) => (typeof value === 'string' ? value : null);

/** The reason as the customer reads it: staff cancellations and refusals are both `store`. */
export function cancelReasonOf(value: string | null): CancelReason | null {
  switch (value) {
    case 'customer':
    case 'payment-expired':
    case 'account-deleted':
      return value;
    case 'staff':
    case 'kitchen-refused':
      return 'store';
    default:
      return null;
  }
}

/** The facts the live order is worked out from (F5 B20). */
export function progressFacts(row: OrderViewRow): ProgressFacts {
  return {
    status: row.status,
    version: row.version,
    paymentMethod: row.paymentMethod,
    paymentStatus: row.paymentStatus,
    totalCents: row.totalCents,
    refundedCents: row.refundedCents,
    tipCents: row.tipCents,
    cardBrand: row.cardBrand,
    cardLast4: row.cardLast4,
    hasPaymentIntent: row.stripePaymentIntentId !== null,
    autoRefundReason: row.autoRefundReason,
    placedAt: row.placedAt,
    acceptedAt: row.acceptedAt,
    preparingAt: row.preparingAt,
    readyAt: row.readyAt,
    pickedUpAt: row.pickedUpAt,
    deliveredAt: row.deliveredAt,
    cancelledAt: row.cancelledAt,
    cancelReason: row.cancelReason,
    cancelCode: row.cancelCode,
    cancelLineIds: row.cancelLineIds,
    prepMinutes: row.prepMinutes,
    arrivalFromMinutes: row.arrivalFromMinutes,
    arrivalToMinutes: row.arrivalToMinutes,
    items: row.items.map((item) => ({ id: item.id, title: item.title })),
    events: row.events,
  };
}

const TIP_CHOICES = ['none', '10', '15', '20', 'amount'] as const;

export interface StoreFacts {
  phone: string;
  timeZone: string;
}

export async function storeFacts(): Promise<StoreFacts> {
  const store = await getStoreStatus();
  return {
    phone: displayPhone(store.store.phone.replace(/\s+/g, '')).display,
    timeZone: store.timeZone,
  };
}

export function toOrderView(row: OrderViewRow, store: StoreFacts, now: Date): OrderView {
  const facts = progressFacts(row);
  const failures = row.events.filter((event) => event.type === 'payment-failed');
  const lastFailure = failures.at(-1);
  const decline: Decline | null = lastFailure
    ? {
        code: stringOr(asRecord(lastFailure.data).code),
        declineCode: stringOr(asRecord(lastFailure.data).declineCode),
      }
    : null;
  const base = row.placedAt;
  const arrival =
    row.arrivalFromMinutes !== null && row.arrivalToMinutes !== null
      ? {
          fromMinutes: row.arrivalFromMinutes,
          toMinutes: row.arrivalToMinutes,
          from: base
            ? new Date(base.getTime() + row.arrivalFromMinutes * MINUTE_MS).toISOString()
            : null,
          to: base
            ? new Date(base.getTime() + row.arrivalToMinutes * MINUTE_MS).toISOString()
            : null,
        }
      : null;
  const refunds = row.events
    .filter((event) => event.type === 'refunded')
    .map((event) => ({
      amountCents: numberOr(asRecord(event.data).amountCents, 0) ?? 0,
      at: event.createdAt.toISOString(),
    }));
  const code = row.promoCode ?? row.coupon?.code ?? null;
  const tipChoice = TIP_CHOICES.find((choice) => choice === row.tipChoice) ?? 'none';

  return {
    id: row.id,
    number: row.number,
    createdAt: row.createdAt.toISOString(),
    placedAt: row.placedAt?.toISOString() ?? null,
    status: row.status,
    cancelReason: cancelReasonOf(row.cancelReason),
    cancellable: canCancel(row.status),
    payable: isPayable(row, now),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    payment: {
      method: row.paymentMethod === 'CARD' ? 'card' : 'cash',
      status: row.paymentStatus,
      card:
        row.cardBrand && row.cardLast4
          ? {
              brand: row.cardBrand,
              last4: row.cardLast4,
              label: cardLabel(row.cardBrand, row.cardLast4),
              spoken: cardSpoken(row.cardBrand, row.cardLast4),
            }
          : null,
      decline: row.status === 'FAILED' ? decline : null,
    },
    lines: row.items.map((item) => ({
      title: item.title,
      flavors: item.flavors,
      note: item.note,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      lineTotalCents: item.unitPriceCents * item.quantity,
    })),
    kitchenNote: row.note,
    breakdown: {
      subtotalCents: row.subtotalCents,
      promo:
        code && (row.discountCents > 0 || row.deliveryDiscountCents > 0)
          ? {
              code,
              foodDiscountCents: row.discountCents,
              freeDelivery: row.deliveryDiscountCents > 0,
            }
          : null,
      deliveryFeeCents: row.deliveryFeeCents,
      deliveryDiscountCents: row.deliveryDiscountCents,
      tax: { rateBps: row.taxRateBps, cents: row.taxCents },
      tipCents: row.tipCents,
      tipChoice,
      totalCents: row.totalCents,
    },
    refunds: { refundedCents: row.refundedCents, entries: refunds },
    dispute: {
      status: row.disputeStatus,
      openedAt: row.disputeOpenedAt?.toISOString() ?? null,
      closedAt: row.disputeClosedAt?.toISOString() ?? null,
    },
    delivery: {
      label: row.addressLabel,
      line1: row.addressLine1 ?? row.addressText,
      line2: row.addressLine2,
      city: row.addressCity,
      instructions: row.courierInstructions,
      distanceKm: row.distanceKm,
    },
    contact: {
      name: row.contactName,
      firstName: row.contactName.trim().split(/\s+/)[0] ?? '',
      phoneDisplay: row.contactPhone ? displayPhone(row.contactPhone).display : '',
    },
    arrival,
    timeline: customerTimeline(facts),
    flags: {
      revivedAfterLatePayment: row.events.some((event) => event.type === 'revived'),
      lateRefund: row.autoRefundReason === 'late-payment',
      mismatchRefund: row.autoRefundReason === 'mismatch',
    },
    store,
    progress: buildProgress(facts, now),
  };
}

export function toOrderSummary(row: OrderSummaryRow, now = new Date()): OrderSummary {
  return {
    id: row.id,
    number: row.number,
    createdAt: row.createdAt.toISOString(),
    dishes: row.items.slice(0, 3).map((item) => ({ title: item.title, quantity: item.quantity })),
    moreCount: Math.max(0, row.items.length - 3),
    totalCents: row.totalCents,
    status: row.status,
    statusWord: statusWord(row.status, row.cancelReason),
    method: row.paymentMethod === 'CARD' ? 'card' : 'cash',
    moneyFlag: moneyFlag(row.paymentStatus, row.disputeStatus),
    ...summaryProgress(row, now),
  };
}

/** Any order, read by the platform (jobs and emails). */
export async function loadOrderViewAsSystem(orderId: string, now = new Date()) {
  const [row, store] = await Promise.all([
    runAsSystem('order view', (ctx) => findOrderView(ctx, orderId)),
    storeFacts(),
  ]);
  return row ? { view: toOrderView(row, store, now), userId: row.userId } : null;
}
