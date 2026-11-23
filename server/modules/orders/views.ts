import 'server-only';
import { displayPhone } from '@/lib/phone';
import { runAsSystem } from '@/server/db/context';
import { getStoreStatus } from '@/server/modules/menu/service';
import { findOrderView, type OrderSummaryRow, type OrderViewRow } from './repo';
import {
  CANCEL_REASONS,
  type CancelReason,
  type Decline,
  type OrderSummary,
  type OrderView,
  type TimelineKind,
} from './schema';
import { canCancel, isPayable, moneyFlag, statusWord } from './state';
import { cardLabel, cardSpoken } from './text';

/** The order page's data from the stored order: every figure is the snapshot, never re-quoted. */

const MINUTE_MS = 60_000;

const TIMELINE: Record<string, TimelineKind> = {
  placed: 'placed',
  revived: 'revived',
  cancelled: 'cancelled',
  expired: 'expired',
  refunded: 'refunded',
  'dispute-opened': 'disputeOpened',
  'dispute-closed': 'disputeClosed',
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {};

const numberOr = (value: unknown, fallback: number | null) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const stringOr = (value: unknown) => (typeof value === 'string' ? value : null);

export const cancelReasonOf = (value: string | null): CancelReason | null =>
  CANCEL_REASONS.find((reason) => reason === value) ?? null;

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
    timeline: row.events.flatMap((event) => {
      const kind = TIMELINE[event.type];
      if (!kind) return [];
      return [
        {
          kind,
          at: event.createdAt.toISOString(),
          amountCents:
            kind === 'refunded' ? numberOr(asRecord(event.data).amountCents, null) : null,
        },
      ];
    }),
    flags: {
      revivedAfterLatePayment: row.events.some((event) => event.type === 'revived'),
      lateRefund: row.autoRefundReason === 'late-payment',
      mismatchRefund: row.autoRefundReason === 'mismatch',
    },
    store,
  };
}

export function toOrderSummary(row: OrderSummaryRow): OrderSummary {
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
