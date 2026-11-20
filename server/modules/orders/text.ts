import { formatClock, formatPrice, WEEKDAY_NAMES } from '@/lib/format';
import type { StoreMoment } from '@/server/modules/menu/schema';
import type { Decline } from './schema';

/*
 * The F4 sentences the server sends and the screens show (story copy table, design 2.18 and
 * 6.2). No server imports, so the browser can word things the same way. The words "error",
 * "invalid" and "fraud" never appear.
 */

const BRANDS: Record<string, string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  amex: 'American Express',
  american_express: 'American Express',
  discover: 'Discover',
  diners: 'Diners Club',
  jcb: 'JCB',
  unionpay: 'UnionPay',
  cartes_bancaires: 'Cartes Bancaires',
};

export const brandLabel = (brand: string) => BRANDS[brand.toLowerCase()] ?? 'Card';

/** "Visa •••• 4242". */
export const cardLabel = (brand: string, last4: string) => `${brandLabel(brand)} •••• ${last4}`;

/** "Visa ending in 4242", for screen readers. */
export const cardSpoken = (brand: string, last4: string) =>
  `${brandLabel(brand)} ending in ${last4}`;

/** "12/34". */
export const expiryText = (month: number, year: number) =>
  `${String(month).padStart(2, '0')}/${String(year % 100).padStart(2, '0')}`;

/** Expired once its expiry month is over (S6.12). */
export function isCardExpired(month: number, year: number, now: Date) {
  const endOfMonth = Date.UTC(year, month, 1);
  return now.getTime() >= endOfMonth;
}

/** "7:52 pm" in the store's time zone. */
export function clockAt(iso: string | Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(iso));
  const hour = parts.find((part) => part.type === 'hour')?.value ?? '00';
  const minute = parts.find((part) => part.type === 'minute')?.value ?? '00';
  return formatClock(`${hour}:${minute}`);
}

/** "11 am today", "12 pm tomorrow", "12 pm Saturday". */
export function openingPhrase(moment: StoreMoment): string {
  const day =
    moment.day === 'today'
      ? 'today'
      : moment.day === 'tomorrow'
        ? 'tomorrow'
        : WEEKDAY_NAMES[moment.weekday];
  return `${formatClock(moment.time)} ${day}`;
}

// ------------------------------------------------------------------ refusals at the press

export const DEMO_CANNOT_ORDER = "Demo accounts can't place orders.";
export const NOT_A_CUSTOMER =
  'Checkout is for customer accounts. Sign in with a customer account to order.';
export const CHOOSE_ADDRESS = 'Choose an address we deliver to.';
export const STRIPE_NOT_SET_UP = "Card payments aren't set up on this computer.";
export const CARD_NOT_SAVED = "That card isn't saved any more. Choose another card.";

export const emailGate = (email: string) =>
  `Confirm your email to place your order. We sent a link to ${email}.`;

export function storeClosedMessage(closedAt: StoreMoment | null, opensAt: StoreMoment | null) {
  const opens = opensAt ? ` You can order from ${openingPhrase(opensAt)}.` : '';
  const first = closedAt
    ? `We closed at ${formatClock(closedAt.time)} while you were checking out.`
    : "We're closed right now.";
  return `${first}${opens} Your cart is saved.`;
}

export const cashLimitMessage = (totalCents: number, limitCents: number) =>
  `Cash is available for orders up to ${formatPrice(limitCents)}. This one is ${formatPrice(totalCents)}, so please pay by card.`;

export function unpaidOrderMessage(
  number: string,
  totalCents: number,
  expiresAt: string | null,
  timeZone: string,
) {
  const expiry = expiresAt ? ` It expires at ${clockAt(expiresAt, timeZone)}.` : '';
  return `Order ${number} is waiting for payment (${formatPrice(totalCents)}).${expiry}`;
}

export const duplicateMessage = (number: string) =>
  `You placed this same order a moment ago (order ${number}). Place it again?`;

export const cardPausedMessage = (until: string, timeZone: string) =>
  `Too many declined payments. You can try a card again at ${clockAt(until, timeZone)}, or pay with cash.`;

export const kitchenStartedMessage = (number: string, phone: string) =>
  `The kitchen has already started on order ${number}, so it can't be cancelled here. Call us on ${phone}.`;

export const paymentInProgressMessage = (number: string) =>
  `Your bank is still confirming order ${number}. Give it a minute.`;

export function soldOutMessage(dishes: string[]) {
  if (dishes.length === 0) return 'Some dishes in your cart are no longer on our menu.';
  const names =
    dishes.length === 1 ? dishes[0] : `${dishes.slice(0, -1).join(', ')} and ${dishes.at(-1)}`;
  return `${names} sold out while you were checking out. Remove ${dishes.length === 1 ? 'it' : 'them'} to continue, or go back to your cart.`;
}

export function outsideAreaMessage(place: string, distanceKm: number | null, radiusKm: number) {
  const radius = Number.isInteger(radiusKm) ? String(radiusKm) : radiusKm.toFixed(1);
  const distance =
    distanceKm === null
      ? ''
      : ` It's about ${distanceKm.toFixed(1)} km away, and we deliver within ${radius} km.`;
  return `We don't deliver to ${place} yet.${distance}`;
}

/** S8.2: "Your total changed from $53.97 to $56.11 because Gimbap is now $13.99 (was $12.99). …" */
export function priceChangedMessage(
  oldCents: number,
  newCents: number,
  reason: string | null,
  method: 'cash' | 'card',
) {
  const because = reason ? ` because ${reason}` : '';
  const button =
    method === 'card' ? `Pay ${formatPrice(newCents)}` : `Place order · ${formatPrice(newCents)}`;
  return `Your total changed from ${formatPrice(oldCents)} to ${formatPrice(newCents)}${because}. Check the summary, then press ${button} to continue.`;
}

// ------------------------------------------------------------------ declines (design 2.18)

export const BANK_CHECK_FAILED =
  "Your bank couldn't confirm it's you, so the payment didn't go through. Try again, or use another card.";

/** The sentence for a declined payment. A saved card is named (S6.11). */
export function declineMessage(decline: Decline | null, savedCard?: string): string {
  const code = decline?.code ?? null;
  const reason = decline?.declineCode ?? null;
  if (code === 'payment_intent_authentication_failure') return BANK_CHECK_FAILED;
  if (savedCard) return `Your ${savedCard} was declined. Use another card, or pay with cash.`;
  if (code === 'expired_card' || reason === 'expired_card') {
    return 'This card has expired. Check the date, or use another card.';
  }
  if (code === 'incorrect_cvc' || reason === 'incorrect_cvc') {
    return "The CVC doesn't match this card. Check the 3 digits on the back.";
  }
  if (code === 'processing_error' || reason === 'processing_error') {
    return "We couldn't reach your bank. Try again in a moment.";
  }
  if (reason === 'insufficient_funds') {
    return 'Your card was declined for insufficient funds. Try another card, or pay with cash.';
  }
  return 'Your card was declined. Try another card, or pay with cash.';
}
