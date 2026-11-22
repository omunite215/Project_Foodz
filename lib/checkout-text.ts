import {
  MAX_TIP_CENTS,
  type QuoteArrival,
  TIP_AMOUNT_ERROR,
  TIP_LIMIT_ERROR,
  type TipChoice,
  type TipPercent,
} from '@/server/modules/cart/schema';
import { clockAt } from '@/server/modules/orders/text';
import { formatPrice, plural } from './format';

/*
 * Wording for checkout (F4 design 2). Pure functions, so the browser, Storybook and unit tests
 * say the same thing. Every figure is the server's; these only put it into words.
 */

// ------------------------------------------------------------------ tip (design 2.11)

/** What the tip tiles hold in this tab: a preset, or "Other" with what she typed beside it. */
export type TipTile =
  | { kind: 'none' }
  | { kind: 'percent'; percent: TipPercent }
  | { kind: 'other' };

export type TipAmount =
  | { kind: 'empty' }
  | { kind: 'ok'; cents: number }
  | { kind: 'error'; message: string };

/**
 * "5", "5.0", "5.00" and "$5" are $5.00; "5.5" is $5.50; "0" is no tip. More than two decimals,
 * a negative amount or anything that isn't a number answers the dollars-and-cents sentence; more
 * than $100.00 answers the limit.
 */
export function parseTipAmount(raw: string): TipAmount {
  if (!raw.trim()) return { kind: 'empty' };
  const text = raw.trim().replace(/^\$\s*/, '');
  if (!/^(\d+(\.\d{0,2})?|\.\d{1,2})$/.test(text)) {
    return { kind: 'error', message: TIP_AMOUNT_ERROR };
  }
  const [whole = '0', fraction = ''] = text.split('.');
  const cents = Number(whole || '0') * 100 + Number(fraction.padEnd(2, '0') || '0');
  if (!Number.isSafeInteger(cents)) return { kind: 'error', message: TIP_AMOUNT_ERROR };
  if (cents > MAX_TIP_CENTS) return { kind: 'error', message: TIP_LIMIT_ERROR };
  return { kind: 'ok', cents };
}

/**
 * The tip choice the quote is asked for. While "Other" holds nothing valid, the last valid
 * amount is kept (design 2.11), or no tip when there never was one.
 */
export function tipChoiceFor(tile: TipTile, amount: TipAmount, lastValidCents: number | null) {
  if (tile.kind === 'none') return { kind: 'none' } satisfies TipChoice;
  if (tile.kind === 'percent')
    return { kind: 'percent', percent: tile.percent } satisfies TipChoice;
  if (amount.kind === 'ok') return { kind: 'amount', cents: amount.cents } satisfies TipChoice;
  if (amount.kind === 'empty') return { kind: 'none' } satisfies TipChoice;
  return lastValidCents === null
    ? ({ kind: 'none' } satisfies TipChoice)
    : ({ kind: 'amount', cents: lastValidCents } satisfies TipChoice);
}

/** A tile's accessible name: "No tip", "15 %, $7.20", "Other", "Other, $5.00". */
export function tipTileName(tile: TipTile, cents: number | null): string {
  if (tile.kind === 'none') return 'No tip';
  const label = tile.kind === 'percent' ? `${tile.percent} %` : 'Other';
  return cents === null ? label : `${label}, ${formatPrice(cents)}`;
}

// ------------------------------------------------------------------ arrival (design 2.10)

export interface ArrivalWords {
  line1: string;
  /** What a screen reader hears for line 1 (no en dash). */
  spoken: string;
  line2: string | null;
  /** The quiet look of the no-address line. */
  quiet: boolean;
}

/** "Arrives in about 35–45 min" / "by 7:45 pm", or the line for no address or closed. */
export function arrivalWords(
  arrival: QuoteArrival,
  timeZone: string,
  opensText: string | null,
): ArrivalWords {
  if (arrival.status === 'noAddress') {
    return {
      line1: 'Choose an address to see when it arrives.',
      spoken: 'Choose an address to see when it arrives.',
      line2: null,
      quiet: true,
    };
  }
  if (arrival.status === 'closed') {
    const line1 = opensText ?? 'Ordering opens soon';
    return {
      line1,
      spoken: line1,
      line2: "We'll show the arrival time when we open.",
      quiet: false,
    };
  }
  const by = `by ${clockAt(arrival.by, timeZone)}`;
  return {
    line1: `Arrives in about ${arrival.fromMinutes}–${arrival.toMinutes} min`,
    spoken: `Arrives in about ${arrival.fromMinutes} to ${arrival.toMinutes} minutes, ${by}`,
    line2: by,
    quiet: false,
  };
}

export const ARRIVAL_UNAVAILABLE = "We'll show the arrival time when your total updates.";

// ------------------------------------------------------------------ the summary (design 2.6)

/** "3 items", "1 item". */
export const itemsText = (count: number) => plural(count, 'item');

/** The list's name: "3 dishes in your order". */
export const orderLinesLabel = (count: number) =>
  `${plural(count, 'dish', 'dishes')} in your order`;

// ------------------------------------------------------------------ payment (design 2.12, 2.16)

export type PayMethod = 'cash' | 'card';

/** "Pay $53.97", "Place order · $53.97"; without a final total, "Pay" / "Place order". */
export function payButtonLabel(method: PayMethod, totalCents: number | null): string {
  if (method === 'card') return totalCents === null ? 'Pay' : `Pay ${formatPrice(totalCents)}`;
  return totalCents === null ? 'Place order' : `Place order · ${formatPrice(totalCents)}`;
}

/** The pending label after 300 ms. */
export const payPendingLabel = (method: PayMethod) =>
  method === 'card' ? 'Paying…' : 'Placing your order…';

/** "Pay $61.17 in cash when your order arrives, tip included. …" (S4.6, S5.1, D27). */
export function cashBoxText(totalCents: number | null, tipCents: number): string {
  const amount = totalCents === null ? '' : ` ${formatPrice(totalCents)}`;
  const tip = tipCents > 0 ? ', tip included' : '';
  return `Pay${amount} in cash when your order arrives${tip}. Please have the exact amount ready if you can.`;
}

export const SWITCHED_TO_CARD =
  'Your total is now over $100.00, so we switched to card. Cash is available for orders up to $100.00.';

/** "Paused until 8:40 pm". */
export const pausedUntilText = (until: string, timeZone: string) =>
  `Paused until ${clockAt(until, timeZone)}`;

/** Row 13 of the pay bar: no way to pay this order. */
export function noWayToPayText(paused: string | null): string {
  return paused
    ? `This order is over the $100.00 cash limit, and card payments are paused until ${paused}.`
    : "This order is over the $100.00 cash limit, and card payments aren't set up on this computer.";
}

/** Row 16: the place-order limit (B11), with the time she can try again. */
export const placeLimitText = (at: string) =>
  `You've tried to order several times in a short while. You can try again at ${at}.`;

export const PAY_REASONS = {
  unpaid: (number: string) => `Finish paying for order ${number}, or cancel it, first.`,
  offline: "You're offline. Your order hasn't been sent, and everything you've chosen is kept.",
  updating: 'Updating your total…',
  failed: "We couldn't update your total. Your cart is safe.",
  rateLimited: "You're changing your cart very fast. We'll update your total in a few seconds.",
  soldOut: 'Remove sold-out dishes to check out.',
  address: 'Choose an address we deliver to.',
  cardFailed: 'Load the card form, or choose cash.',
} as const;

export const NOT_SENT = "Your order wasn't sent. Nothing was charged.";
export const SLOW_PRESS =
  "This is taking longer than usual. Don't close this page; we're checking whether your order went through.";
export const SLOW_PRESS_OFFLINE =
  "You're offline. We'll check whether your order went through when you're back online.";
export const CARD_FORM_FAILED =
  "We couldn't load the card form. Check your connection and try again, or pay with cash.";
export const TEST_CARD_NUMBER = '4242 4242 4242 4242';
export const TEST_MODE_NOTE =
  'Test mode: no real money moves. Use 4242 4242 4242 4242, any future date and any CVC.';

// ------------------------------------------------------------------ card fields (design 2.15)

export type CardField = 'cardNumber' | 'cardExpiry' | 'cardCvc';

export const CARD_FIELD_LABELS: Record<CardField, string> = {
  cardNumber: 'Card number',
  cardExpiry: 'Expiration date',
  cardCvc: 'CVC',
};

/**
 * Our words for a card field that isn't right yet, keyed on Stripe's state or code (`empty`
 * when nothing was typed). The word "invalid" never appears.
 */
export function cardErrorText(field: CardField, code: string, brand?: string | null): string {
  if (field === 'cardNumber') {
    if (code === 'empty') return 'Enter the card number.';
    if (code === 'incomplete_number') return 'Enter the full card number.';
    if (code === 'invalid_number' || code === 'incorrect_number') {
      return "That card number doesn't look right. Check it and try again.";
    }
    return 'Check this field and try again.';
  }
  if (field === 'cardExpiry') {
    if (code === 'empty') return 'Enter the expiration date.';
    if (code === 'incomplete_expiry') return 'Enter the full expiration date, like 08/29.';
    if (code === 'invalid_expiry_month_past' || code === 'invalid_expiry_year_past') {
      return 'That date is in the past.';
    }
    if (code === 'invalid_expiry_month' || code === 'invalid_expiry_year') {
      return "That date doesn't look right. Use MM/YY, like 08/29.";
    }
    return 'Check this field and try again.';
  }
  if (code === 'empty' || code === 'incomplete_cvc' || code === 'invalid_cvc') {
    return brand === 'amex'
      ? 'Enter the 4-digit CVC from the front of your card.'
      : 'Enter the 3-digit CVC from the back of your card.';
  }
  return 'Check this field and try again.';
}

/** What is announced when a card field's error first shows: "Card number: Enter the card number." */
export const cardErrorAnnouncement = (field: CardField, text: string) =>
  `${CARD_FIELD_LABELS[field]}: ${text}`;

// ------------------------------------------------------------------ the attempt key (B2, S7.2)

/** A fresh attempt key: 24 URL-safe random characters. */
export function newAttemptKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

/** One stable string for everything a press depends on; a new one means a new attempt key. */
export function attemptFingerprint(parts: Record<string, unknown>): string {
  return JSON.stringify(
    Object.keys(parts)
      .toSorted()
      .map((key) => [key, parts[key]]),
  );
}
