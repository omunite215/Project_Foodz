import type { Cuisine } from '@/server/db/enums';
import type { PromoReason, Quote, QuoteDelivery, QuotePromo } from '@/server/modules/cart/schema';
import type { StoreMoment } from '@/server/modules/menu/schema';
import { CUISINE_LABELS, formatClock, formatPrice, momentText, plural } from './format';

/*
 * Wording for the cart (F3 design 2). Pure functions, so the same words come out in the browser,
 * in Storybook and in unit tests. Every figure is the server's; these only put it into words.
 */

/** The minus sign (U+2212), not a hyphen, for discounts. */
export const MINUS = '−';

/** "−$4.80" */
export const discountText = (cents: number) => `${MINUS}${formatPrice(cents)}`;

/** What a screen reader hears for a discount: "minus $4.80". */
export const discountLabel = (cents: number) => `minus ${formatPrice(cents)}`;

/** 700 gives "7%", 625 gives "6.25%" (no trailing zeros). */
export function taxRateText(rateBps: number): string {
  return `${Number((rateBps / 100).toFixed(2))}%`;
}

/** The header button: "Cart, 3 items", "Cart, 1 item", "Cart, empty", or "Cart" before it loads. */
export function cartButtonLabel(items: number | null): string {
  if (items === null) return 'Cart';
  return items === 0 ? 'Cart, empty' : `Cart, ${plural(items, 'item')}`;
}

/** The list of lines: "3 dishes in your cart". */
export const linesLabel = (items: number) => `${plural(items, 'dish', 'dishes')} in your cart`;

/** "2 × $12.99" and its spoken form "2 times $12.99". */
export const unitText = (quantity: number, unitCents: number) =>
  `${quantity} × ${formatPrice(unitCents)}`;
export const unitLabel = (quantity: number, unitCents: number) =>
  `${quantity} times ${formatPrice(unitCents)}`;

/** "Now $13.99 (was $12.99)" */
export const priceChangeText = (nowCents: number, wasCents: number) =>
  `Now ${formatPrice(nowCents)} (was ${formatPrice(wasCents)})`;

/** "Sesame oil isn't offered for Kimchi any more, so we took it off." */
export function droppedFlavorText(flavors: readonly string[], dish: string): string {
  const names = joinWords(flavors, 'and');
  return `${names} ${flavors.length === 1 ? "isn't" : "aren't"} offered for ${dish} any more, so we took ${flavors.length === 1 ? 'it' : 'them'} off.`;
}

export function joinWords(words: readonly string[], last: 'and' | 'or'): string {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} ${last} ${words.at(-1)}`;
}

const NOTE_SNIPPET = 24;

/** The start of a note, for telling two lines of one dish apart: "No cucumber please…". */
export function noteSnippet(note: string): string {
  const chars = Array.from(note.trim());
  return chars.length <= NOTE_SNIPPET
    ? chars.join('')
    : `${chars.slice(0, NOTE_SNIPPET).join('').trimEnd()}…`;
}

export interface NamedLine {
  id: string;
  menuItemId: string;
  flavors: readonly string[];
  note?: string;
}

/**
 * What tells a line apart from other lines of the same dish (S7.2): its flavors ("with
 * Gochujang"), else its note ("with note No cucumber…"), else its place (", line 2"). Empty when
 * the dish has one line.
 */
export function lineSuffix(line: NamedLine, lines: readonly NamedLine[]): string {
  const same = lines.filter((other) => other.menuItemId === line.menuItemId);
  if (same.length < 2) return '';
  const flavorsKey = line.flavors.join('|');
  const flavorsUnique = same.filter((other) => other.flavors.join('|') === flavorsKey).length === 1;
  if (line.flavors.length > 0 && flavorsUnique) return ` with ${joinWords(line.flavors, 'and')}`;
  if (line.note) return ` with note ${noteSnippet(line.note)}`;
  return `, line ${lines.findIndex((other) => other.id === line.id) + 1}`;
}

// ------------------------------------------------------------------ notices (design 2.4)

/** "We're closed right now. You can fill your cart and order from 11 am today." */
export function storeClosedText(opensAt: StoreMoment | null): string {
  return opensAt
    ? `We're closed right now. You can fill your cart and order from ${momentText(opensAt)}.`
    : "We're closed right now. You can fill your cart and order when we open again.";
}

/** The checkout button while closed: "Ordering opens at 11 am", "… at 12 pm tomorrow". */
export function orderingOpensText(opensAt: StoreMoment | null): string {
  if (!opensAt) return 'Ordering opens soon';
  return opensAt.day === 'today'
    ? `Ordering opens at ${formatClock(opensAt.time)}`
    : `Ordering opens at ${momentText(opensAt)}`;
}

export const soldOutNoticeText = (count: number) =>
  count === 1
    ? "1 dish in your cart is sold out today, so it isn't in your total."
    : `${count} dishes in your cart are sold out today, so they aren't in your total.`;

export const removedNoticeText = (count: number) =>
  count === 1
    ? '1 dish in your cart is no longer on our menu, so we took it out.'
    : `${count} dishes in your cart are no longer on our menu, so we took them out.`;

export const priceChangedNoticeText = (count: number) =>
  count === 1
    ? '1 price in your cart has changed since you added it.'
    : `${count} prices in your cart have changed since you added them.`;

export const removedSoldOutText = (count: number) =>
  `Removed ${plural(count, 'sold-out dish', 'sold-out dishes')}.`;

/** "9:00 pm" in the store's time zone. */
export function storeTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' })
    .format(new Date(iso))
    .replace(/\s?(AM|PM)$/, (_, half: string) => ` ${half.toLowerCase()}`);
}

/** "KBBQ5 ended at 9:00 pm, so it's no longer applied. Your total is now $55.47." */
export function codeEndedText(
  code: string,
  endedAt: string | null,
  timeZone: string,
  totalCents: number | null,
): string {
  const when = endedAt ? `ended at ${storeTime(endedAt, timeZone)}` : 'has ended';
  const total = totalCents === null ? '' : ` Your total is now ${formatPrice(totalCents)}.`;
  return `${code} ${when}, so it's no longer applied.${total}`;
}

export type CartLimit = 'items' | 'lines';

/** "Your cart is full (50 items). For a bigger order, call us on (617) 555-0142." */
export function cartFullText(limit: CartLimit, phone: string | null): string {
  const what = limit === 'items' ? '50 items' : '25 different dishes';
  return phone
    ? `Your cart is full (${what}). For a bigger order, call us on ${phone}.`
    : `Your cart is full (${what}). For a bigger order, call us.`;
}

/** "You already have 20 Gimbap with these extras in your cart. That's the most for one dish." */
export const lineFullText = (dish: string) =>
  `You already have 20 ${dish} with these extras in your cart. That's the most for one dish.`;

// ------------------------------------------------------------------ delivery (design 2.15, 2.16)

/** "4.3 km", or at the edge of the area "just under 8 km" / "just over 8 km". */
export function distanceText(delivery: Pick<QuoteDelivery, 'distanceKm' | 'edge' | 'radiusKm'>) {
  if (delivery.edge === 'justUnder') return `just under ${delivery.radiusKm} km`;
  if (delivery.edge === 'justOver') return `just over ${delivery.radiusKm} km`;
  return delivery.distanceKm === null ? '' : `${delivery.distanceKm.toFixed(1)} km`;
}

/** The delivery row's label: "Delivery to Home · 4.3 km", "Delivery to your address · 1.3 km". */
export function deliveryRowLabel(delivery: QuoteDelivery, checkedLabel?: string | null): string {
  if (delivery.status === 'unknown') return 'Delivery';
  const where =
    delivery.kind === 'saved' && delivery.address
      ? delivery.address.label
      : (checkedLabel ?? 'your address');
  const distance = distanceText(delivery);
  return distance ? `Delivery to ${where} · ${distance}` : `Delivery to ${where}`;
}

/** "$1.99 to $5.99" */
export const feeRangeText = ({ minCents, maxCents }: QuoteDelivery['feeRange']) =>
  `${formatPrice(minCents)} to ${formatPrice(maxCents)}`;

/**
 * The outside box (S2.8, design 2.15 B and C): "We don't deliver to 1300 Hancock Street yet. It's
 * about 11.4 km away, and we deliver within 8 km." At the edge: "It's just over 8 km away".
 */
export function outsideText(
  place: string,
  delivery: Pick<QuoteDelivery, 'distanceKm' | 'edge' | 'radiusKm'>,
): string {
  const distance =
    delivery.edge === 'justOver'
      ? `just over ${delivery.radiusKm} km`
      : delivery.distanceKm === null
        ? null
        : `about ${delivery.distanceKm.toFixed(1)} km`;
  const away = distance ? ` It's ${distance} away, and we` : ' We';
  return `We don't deliver to ${place} yet.${away} deliver within ${delivery.radiusKm} km.`;
}

/**
 * A free-delivery code is applied and no address is known yet: delivery will cost nothing, so the
 * delivery row reads "Free" rather than the fee range (design 2.16 row 3).
 */
export const freeDeliveryWithoutAddress = (quote: Pick<Quote, 'promo' | 'delivery'>) =>
  quote.promo?.status === 'applied' &&
  quote.promo.freeDelivery &&
  quote.delivery.status === 'unknown';

/** "Total $55.47" or "Total before delivery $51.33", announced once a change settles. */
export const totalAnnouncement = (quote: Pick<Quote, 'totalCents' | 'totalKind'>) =>
  `${quote.totalKind === 'final' ? 'Total' : 'Total before delivery'} ${formatPrice(quote.totalCents)}`;

// ------------------------------------------------------------------ promo codes (design 2.10 to 2.14)

/** "KBBQ5 applied. You save $5.00." / "FREEDELIVERY applied. Delivery will be free." */
export function promoAppliedText(promo: Pick<QuotePromo, 'code' | 'amountCents' | 'freeDelivery'>) {
  if (promo.freeDelivery && promo.amountCents === 0) {
    return `${promo.code} applied. Delivery will be free.`;
  }
  return `${promo.code} applied. You save ${formatPrice(promo.amountCents)}.`;
}

const cuisineWords = (cuisines: readonly Cuisine[]) =>
  joinWords(
    cuisines.map((cuisine) => CUISINE_LABELS[cuisine]),
    'and',
  );

type MinimumReason = Extract<PromoReason, { code: 'minimumNotReached' }>;

/** Under the chip, and in an offer: "Add $18.01 of Korean dishes" (no full stop). */
export function shortfallText(reason: MinimumReason): string {
  return reason.cuisines.length === 0
    ? `Add ${formatPrice(reason.shortfallCents)} more`
    : `Add ${formatPrice(reason.shortfallCents)} of ${cuisineWords(reason.cuisines)} dishes`;
}

/** "WELCOME10 is no longer applied. It needs a subtotal of $15.00. Add $0.51 more to use it." */
export function noLongerAppliedText(code: string, reason: MinimumReason): string {
  const need =
    reason.cuisines.length === 0
      ? `It needs a subtotal of ${formatPrice(reason.minSubtotalCents)}. Add ${formatPrice(reason.shortfallCents)} more to use it.`
      : `It needs ${formatPrice(reason.minSubtotalCents)} of ${cuisineWords(reason.cuisines)} dishes. Add ${formatPrice(reason.shortfallCents)} more to use it.`;
  return `${code} is no longer applied. ${need}`;
}

export const isMinimumReason = (reason: PromoReason | null): reason is MinimumReason =>
  reason?.code === 'minimumNotReached';

/** One side of the compare card (S4.7, U6): a code and the real total it gives. */
export interface CompareSide {
  code: string;
  totalCents: number;
  /**
   * What the total says about delivery when no address is known yet: it leaves the fee out
   * ("before delivery"), or the code makes delivery free. Null once the fee is in the total.
   */
  note: 'beforeDelivery' | 'freeDelivery' | null;
  /** The delivery fee still to come on top of the total ($0 once it is known or free). */
  toAdd: QuoteDelivery['feeRange'];
}

const NOTHING_TO_ADD = { minCents: 0, maxCents: 0 } as const;

/** A side of the compare card from the quote with that code. */
export function compareSide(
  code: string,
  quote: Pick<Quote, 'totalCents' | 'totalKind' | 'delivery' | 'promo'>,
): CompareSide {
  const { totalCents } = quote;
  if (freeDeliveryWithoutAddress(quote)) {
    return { code, totalCents, note: 'freeDelivery', toAdd: NOTHING_TO_ADD };
  }
  if (quote.totalKind === 'beforeDelivery') {
    const toAdd = quote.delivery.status === 'unknown' ? quote.delivery.feeRange : NOTHING_TO_ADD;
    return { code, totalCents, note: 'beforeDelivery', toAdd };
  }
  return { code, totalCents, note: null, toAdd: NOTHING_TO_ADD };
}

/**
 * Which code costs less once delivery is paid. When both totals leave out the same fee, the fee
 * doesn't change the answer. When only one does (free delivery against a food discount, before
 * the address is known), the answer is known only if it holds for every fee in the range;
 * otherwise it is `unknown` and neither is called cheaper.
 */
export function cheaperSide(
  current: CompareSide,
  next: CompareSide,
): 'current' | 'next' | 'equal' | 'unknown' {
  const sameFee =
    current.toAdd.minCents === next.toAdd.minCents &&
    current.toAdd.maxCents === next.toAdd.maxCents;
  if (sameFee) {
    if (current.totalCents === next.totalCents) return 'equal';
    return current.totalCents < next.totalCents ? 'current' : 'next';
  }
  if (current.totalCents + current.toAdd.maxCents < next.totalCents + next.toAdd.minCents) {
    return 'current';
  }
  if (next.totalCents + next.toAdd.maxCents < current.totalCents + current.toAdd.minCents) {
    return 'next';
  }
  return 'unknown';
}

/** "$45.98 before delivery", "$51.33 with free delivery" or "$50.12". */
function compareFigure(side: CompareSide): string {
  const money = formatPrice(side.totalCents);
  if (side.note === 'beforeDelivery') return `${money} before delivery`;
  if (side.note === 'freeDelivery') return `${money} with free delivery`;
  return money;
}

/** Under each total on the compare card's tiles: "before delivery" or "free delivery". */
export const compareNoteText = (side: CompareSide) =>
  side.note === 'beforeDelivery'
    ? 'before delivery'
    : side.note === 'freeDelivery'
      ? 'free delivery'
      : null;

/**
 * The compare card's question (S4.7, U6). A total that leaves delivery out says so, and when the
 * delivery fee decides which code is cheaper, the card says that instead of guessing.
 */
export function compareText(current: CompareSide, next: CompareSide): string {
  const base = `Use ${next.code} instead of ${current.code}? With ${current.code} your total is ${compareFigure(current)}. With ${next.code} it's ${compareFigure(next)}.`;
  const outcome = cheaperSide(current, next);
  if (outcome === 'equal') return `${base} Both give the same total.`;
  if (outcome === 'unknown') {
    const range = current.toAdd.maxCents > 0 ? current.toAdd : next.toAdd;
    return `${base} Which one saves more depends on your delivery fee (${feeRangeText(range)}).`;
  }
  return base;
}

/** "Too many codes tried. You can try again in 10 minutes." (the real wait) */
export function retryWaitText(seconds: number): string {
  if (seconds >= 90) return `in ${plural(Math.ceil(seconds / 60), 'minute')}`;
  if (seconds >= 60) return 'in 1 minute';
  return `in ${plural(Math.max(1, Math.ceil(seconds)), 'second')}`;
}

export const tooManyCodesText = (seconds: number | null) =>
  `Too many codes tried. You can try again ${seconds ? retryWaitText(seconds) : 'in a few minutes'}.`;

// ------------------------------------------------------------------ the checkout button (design 2.17)

export type CheckoutReason =
  | 'updating'
  | 'failed'
  | 'rateLimited'
  | 'offline'
  | 'soldOut'
  | 'closed'
  | 'outside'
  | 'loading';

export const CHECKOUT_REASONS: Record<Exclude<CheckoutReason, 'closed' | 'loading'>, string> = {
  updating: 'Updating your total…',
  failed: "We couldn't update your total. Your cart is safe.",
  rateLimited: "You're changing your cart very fast. We'll update your total in a few seconds.",
  offline: "You're offline.",
  soldOut: 'Remove sold-out dishes to check out.',
  outside: 'Choose an address we deliver to.',
};

/** Where the cart's quote is (see useQuote in components/cart). */
export type QuoteStatus =
  | 'loading'
  | 'ready'
  | 'updating'
  | 'failed'
  | 'rateLimited'
  | 'offline'
  | 'tooBig';

type CheckoutQuote = Pick<Quote, 'totalCents' | 'totalKind' | 'store' | 'checkoutBlockers'>;

/** Why checkout can't start now, the first that applies (design 2.17). Null: it can. */
export function checkoutReason(
  quote: Pick<Quote, 'checkoutBlockers'> | null,
  status: QuoteStatus,
): CheckoutReason | null {
  if (status === 'offline') return 'offline';
  if (status === 'updating') return 'updating';
  if (status === 'loading') return 'loading';
  if (status === 'failed' || status === 'tooBig') return 'failed';
  if (status === 'rateLimited') return 'rateLimited';
  const blockers = quote?.checkoutBlockers ?? [];
  if (blockers.includes('soldOut')) return 'soldOut';
  if (blockers.includes('closed')) return 'closed';
  if (blockers.includes('outside')) return 'outside';
  if (blockers.includes('empty')) return 'soldOut';
  return null;
}

export interface CheckoutButtonState {
  reason: CheckoutReason | null;
  /** "Go to checkout · $55.47", "Go to checkout" or "Ordering opens at 12 pm". */
  label: string;
  /** The reserved line under the button; null leaves it empty. */
  line: string | null;
}

/**
 * The checkout button and the line under it (design 2.17). While the store is closed the button
 * keeps saying when ordering opens, also while a new total is on its way; the line then carries
 * any other reason, such as an address outside the area (S2.8).
 */
export function checkoutButtonState(
  quote: CheckoutQuote | null,
  status: QuoteStatus,
  slow: boolean,
): CheckoutButtonState {
  const reason = checkoutReason(quote, status);
  const closed = quote && !quote.store.isOpen ? orderingOpensText(quote.store.opensAt) : null;
  const final = reason === null && status === 'ready' && quote?.totalKind === 'final';
  const label =
    closed ??
    (final && quote ? `Go to checkout · ${formatPrice(quote.totalCents)}` : 'Go to checkout');
  let line: string | null;
  if (reason === null) line = null;
  else if (reason === 'closed') {
    line = quote?.checkoutBlockers.includes('outside') ? CHECKOUT_REASONS.outside : null;
  } else if (reason === 'loading' || reason === 'updating') {
    line = slow ? CHECKOUT_REASONS.updating : null;
  } else line = CHECKOUT_REASONS[reason];
  return { reason, label, line };
}
