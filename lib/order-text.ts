import type {
  OrderStatusWord,
  OrderSummary,
  OrderView,
  TimelineKind,
} from '@/server/modules/orders/schema';
import { clockAt, declineMessage } from '@/server/modules/orders/text';
import type { Route } from 'next';
import { formatPrice } from './format';
import { isSitePath } from './navigation';

/*
 * Wording for the order page and the orders list (F4 design 3 and 4). One set of status words
 * everywhere (D37). Pure functions: the server's HTML, the browser and the unit tests agree.
 */

export const STORE_TIME_ZONE = 'America/New_York';

// ------------------------------------------------------------------ dates and times

function dayKey(at: Date, timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

const yearOf = (at: Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric' }).format(at);

/** "Nov 19", or "Nov 19, 2025" in another year. */
function shortDate(at: Date, now: Date, timeZone: string) {
  const sameYear = yearOf(at, timeZone) === yearOf(now, timeZone);
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(at);
}

/** "Today, 7:02 pm", "Yesterday, 7:02 pm", "Nov 19, 7:02 pm", "Nov 19, 2025, 7:02 pm". */
export function orderDateText(iso: string, now: Date, timeZone: string): string {
  const at = new Date(iso);
  const clock = clockAt(at, timeZone);
  const day = dayKey(at, timeZone);
  if (day === dayKey(now, timeZone)) return `Today, ${clock}`;
  if (day === dayKey(new Date(now.getTime() - 86_400_000), timeZone)) return `Yesterday, ${clock}`;
  return `${shortDate(at, now, timeZone)}, ${clock}`;
}

/** "7:02 pm" today, else "Nov 20" (the timeline's time column). */
export function eventTimeText(iso: string, now: Date, timeZone: string): string {
  const at = new Date(iso);
  return dayKey(at, timeZone) === dayKey(now, timeZone)
    ? clockAt(at, timeZone)
    : shortDate(at, now, timeZone);
}

/** "Placed Thursday, November 19 at 7:02 pm". */
export function placedAtText(iso: string, timeZone: string): string {
  const at = new Date(iso);
  const date = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(at);
  return `Placed ${date} at ${clockAt(at, timeZone)}`;
}

/** "November 20". */
export const longDate = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat('en-US', { timeZone, month: 'long', day: 'numeric' }).format(
    new Date(iso),
  );

/**
 * "Arriving about 7:35–7:45 pm" (sr "7:35 to 7:45 pm"). Both ends keep their own am/pm only
 * when they differ ("11:55 am–12:05 pm").
 */
const half = (clock: string) => clock.slice(-2);
const bare = (clock: string) => clock.slice(0, -3);

export function arrivingText(from: string, to: string, timeZone: string) {
  const start = clockAt(from, timeZone);
  const end = clockAt(to, timeZone);
  const range = half(start) === half(end) ? `${bare(start)}–${end}` : `${start}–${end}`;
  const spoken = half(start) === half(end) ? `${bare(start)} to ${end}` : `${start} to ${end}`;
  return { text: `Arriving about ${range}`, spoken: `Arriving about ${spoken}` };
}

/** "Waiting for payment · 12 min left", then "Less than a minute left". Null once it is over. */
export function countdownText(expiresAt: string, now: number): string | null {
  const left = Date.parse(expiresAt) - now;
  if (!Number.isFinite(left) || left <= 0) return null;
  if (left < 60_000) return 'Less than a minute left';
  return `Waiting for payment · ${Math.floor(left / 60_000)} min left`;
}

// ------------------------------------------------------------------ status words (design 4.3)

export const STATUS_WORDS: Record<OrderStatusWord, string> = {
  waitingForPayment: 'Waiting for payment',
  placed: 'Placed',
  accepted: 'Accepted',
  preparing: 'Cooking',
  ready: 'Ready',
  pickedUp: 'On its way',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  expired: 'Expired, not paid',
};

export const MONEY_FLAG_WORDS: Record<NonNullable<OrderSummary['moneyFlag']>, string> = {
  refunded: 'Refunded',
  partlyRefunded: 'Partly refunded',
  disputed: 'Disputed',
};

/** "Gimbap ×2, Pad Thai", then "+2 more" (S12.1). */
export function dishesText(dishes: OrderSummary['dishes'], moreCount: number): string {
  const names = dishes
    .map((dish) => (dish.quantity > 1 ? `${dish.title} ×${dish.quantity}` : dish.title))
    .join(', ');
  return moreCount > 0 ? `${names} +${moreCount} more` : names;
}

export const methodWord = (method: 'cash' | 'card') => (method === 'card' ? 'Card' : 'Cash');

// ------------------------------------------------------------------ the order page (design 3.9)

export type OrderState =
  | 'confirming'
  | 'placed'
  | 'delivered'
  | 'waiting'
  | 'failed'
  | 'expired'
  | 'cancelled'
  | 'mismatch';

/**
 * What the page says about the order. "Confirming" is the browser's own state: a card payment
 * it saw go through that the server doesn't know about yet (B7).
 */
export function orderStateOf(
  view: Pick<OrderView, 'status' | 'cancelReason' | 'flags'>,
  confirming: boolean,
): OrderState {
  if (view.flags.mismatchRefund) return 'mismatch';
  switch (view.status) {
    case 'PENDING_PAYMENT':
      return confirming ? 'confirming' : 'waiting';
    case 'FAILED':
      return 'failed';
    case 'CANCELLED':
      return view.cancelReason === 'payment-expired' ? 'expired' : 'cancelled';
    case 'DELIVERED':
      return 'delivered';
    default:
      return 'placed';
  }
}

/** The h1 per state; "Confirming your payment…" never shows the check (D39). */
export const ORDER_HEADINGS: Record<OrderState, string> = {
  confirming: 'Confirming your payment…',
  placed: 'Order placed',
  delivered: 'Delivered',
  waiting: 'Waiting for payment',
  failed: "Your payment didn't go through",
  expired: 'Order expired',
  cancelled: 'Order cancelled',
  mismatch: 'Payment refunded',
};

export const CONFIRMING_SLOW =
  "This is taking longer than usual. You don't need to pay again; we'll update this page and email you.";

/** Whether Foodz holds (or held) money for this card order. */
const paidByCard = (view: OrderView) =>
  view.payment.method === 'card' &&
  (view.payment.status === 'PAID' ||
    view.payment.status === 'REFUNDED' ||
    view.payment.status === 'PARTIALLY_REFUNDED');

/** The line under the h1, or null. */
export function orderLine(view: OrderView, state: OrderState): string | null {
  switch (state) {
    case 'placed':
      return 'Waiting for the kitchen to accept it. You can cancel until they do.';
    case 'delivered':
      return 'Enjoy your meal.';
    case 'waiting':
      return `Order ${view.number} · ${formatPrice(view.breakdown.totalCents)}`;
    case 'failed': {
      const decline = view.payment.decline ? ` ${declineMessage(view.payment.decline)}` : '';
      return `Nothing was charged.${decline}`;
    }
    case 'expired':
      return "This order expired because it wasn't paid within 15 minutes. Nothing was charged. Your cart is still here.";
    case 'cancelled':
      // A store cancellation's card says it all (F5 design 6.3).
      if (view.cancelReason === 'store') return null;
      return paidByCard(view) ? null : 'Nothing was charged.';
    default:
      return null;
  }
}

/** "Visa •••• 4242", or "your card" when the card isn't known. */
const cardWords = (view: OrderView) => view.payment.card?.label ?? 'your card';

export interface MoneyNotice {
  key: string;
  variant: 'info' | 'error';
  text: string;
}

/** Refunds, disputes, late payments and mismatches, in that order (design 3.9). */
export function moneyNotices(view: OrderView, state: OrderState): MoneyNotice[] {
  const notices: MoneyNotice[] = [];
  const total = formatPrice(view.breakdown.totalCents);
  const tz = view.store.timeZone;
  const lastRefund = view.refunds.entries.at(-1);
  const refundedOn = lastRefund ? ` on ${longDate(lastRefund.at, tz)}` : '';

  if (state === 'mismatch') {
    notices.push({
      key: 'mismatch',
      variant: 'error',
      text: `Something went wrong with this payment, so we refunded ${total} in full. Please place your order again.`,
    });
    return notices;
  }
  if (view.flags.revivedAfterLatePayment && (state === 'placed' || state === 'delivered')) {
    notices.push({
      key: 'revived',
      variant: 'info',
      text: `Your payment arrived just after the deadline, and we've placed order ${view.number}.`,
    });
  }
  if (view.flags.lateRefund) {
    notices.push({
      key: 'late',
      variant: 'info',
      text: `Your payment arrived after this order had expired, so we refunded ${total} to ${cardWords(view)}. Refunds take 5 to 10 business days to appear.`,
    });
  } else if (
    state === 'cancelled' &&
    view.payment.method === 'card' &&
    view.payment.status === 'PAID'
  ) {
    notices.push({
      key: 'refunding',
      variant: 'info',
      text: `We're refunding ${total} to ${cardWords(view)}. It can take 5 to 10 business days to appear.`,
    });
  } else if (view.payment.status === 'REFUNDED') {
    notices.push({
      key: 'refunded',
      variant: 'info',
      text: `Refunded ${formatPrice(view.refunds.refundedCents || view.breakdown.totalCents)} to ${cardWords(view)}${refundedOn}. It can take 5 to 10 business days to appear.`,
    });
  } else if (view.payment.status === 'PARTIALLY_REFUNDED') {
    notices.push({
      key: 'partly',
      variant: 'info',
      text: `Refunded ${formatPrice(view.refunds.refundedCents)} of ${total} to ${cardWords(view)}${refundedOn}.`,
    });
  }
  if (view.dispute.status === 'OPEN') {
    notices.push({
      key: 'dispute',
      variant: 'info',
      text: "Your bank has opened a dispute about this payment. You don't need to do anything here; your bank will contact you.",
    });
  } else if (view.dispute.status === 'WON' || view.dispute.status === 'LOST') {
    notices.push({
      key: 'dispute',
      variant: 'info',
      text: 'Your bank has closed the dispute about this payment.',
    });
  }
  return notices;
}

/** A timeline entry's label (design 3.5). */
export function timelineLabel(
  kind: TimelineKind,
  amountCents: number | null,
  view: Pick<OrderView, 'payment' | 'cancelReason'>,
): string {
  switch (kind) {
    case 'placed':
      if (view.payment.method === 'cash') return 'Placed · Cash on delivery';
      return view.payment.card
        ? `Placed · Paid with ${view.payment.card.label}`
        : 'Placed · Paid by card';
    case 'revived':
      return 'Placed after your payment arrived';
    case 'cancelled':
      return view.cancelReason === 'customer' ? 'Cancelled by you' : 'Cancelled';
    case 'expired':
      return 'Expired, not paid';
    case 'refunded':
      return amountCents === null ? 'Refunded' : `Refunded ${formatPrice(amountCents)}`;
    case 'disputeOpened':
      return 'Dispute opened by your bank';
    case 'disputeClosed':
      return 'Dispute closed';
    default:
      return '';
  }
}

/** The receipt's last line: "Paid · Visa •••• 4242", "Cash on delivery · $53.97 to pay". */
export function paymentLine(view: OrderView, state: OrderState) {
  if (view.payment.method === 'cash') {
    if (view.progress.cashCollected) {
      const text = `Paid in cash · ${formatPrice(view.breakdown.totalCents)}`;
      return { text, spoken: text };
    }
    const nothing = state === 'cancelled' || state === 'expired';
    const text = nothing
      ? 'Cash on delivery · nothing to pay'
      : `Cash on delivery · ${formatPrice(view.breakdown.totalCents)} to pay`;
    return { text, spoken: text };
  }
  if (!view.payment.card || !paidByCard(view)) {
    return { text: 'Card · not paid', spoken: 'Card, not paid' };
  }
  return {
    text: `Paid · ${view.payment.card.label}`,
    spoken: `Paid with ${view.payment.card.spoken}`,
  };
}

/** The cancel dialog's description (design 3.11). */
export function cancelDescription(view: OrderView): string {
  if (view.payment.method === 'card' && view.payment.status === 'PAID') {
    return `We'll refund ${formatPrice(view.breakdown.totalCents)} to ${cardWords(view)}. It can take 5 to 10 business days to appear.`;
  }
  return 'Nothing has been charged.';
}

/** The order page's address: a typed route for any order id. */
export function orderHref(orderId: string): Route {
  const href = `/orders/${orderId}`;
  return isSitePath(href) ? href : '/account/orders';
}

/** "(617) 555-0142" as a tel: target. */
export const telOf = (display: string) =>
  `+1${display.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '')}`;
