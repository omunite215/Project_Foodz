import { CUISINE_LABELS, formatPrice } from '@/lib/format';
import type { Cuisine } from '@/server/db/enums';
import type { PromoReason } from './schema';

/*
 * The story's sentences for a code that gives nothing (S4 table). Each one names the code, says
 * why in plain words and what to do; the word "invalid" never appears. Dates are in the store's
 * time zone. No server imports, so the browser can use the same wording.
 */

export const PROMO_UNAVAILABLE =
  "We can't check promo codes right now. Your cart is fine. Try the code again in a minute.";

const joined = (cuisines: Cuisine[], word: 'and' | 'or') => {
  const names = cuisines.map((cuisine) => CUISINE_LABELS[cuisine]);
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} ${word} ${names.at(-1)}`;
};

const day = (iso: string, timeZone: string, weekday: boolean) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone,
    ...(weekday && { weekday: 'long' }),
    month: 'long',
    day: 'numeric',
  }).format(new Date(iso));

const perCustomer = (count: number) => (count === 1 ? 'one' : String(count));

export interface PromoTextOptions {
  /** The store's IANA time zone. */
  timeZone: string;
  /** With reason rateLimited: the limiter's sentence, with the real wait. */
  rateLimitMessage?: string;
}

/** The sentence for a refusal, R9 or an unchecked code. */
export function promoMessage(code: string, reason: PromoReason, options: PromoTextOptions): string {
  switch (reason.code) {
    case 'notFound':
      return `We couldn't find the code ${code}. Check the spelling, or try another code.`;
    case 'notStarted':
      return `${code} starts on ${day(reason.startsAt, options.timeZone, true)}. You can use it from then.`;
    case 'ended':
      return `${code} ended on ${day(reason.endedAt, options.timeZone, false)}, so it can't be used any more.`;
    case 'usedUp':
      return `Sorry, ${code} has run out.`;
    case 'signInRequired':
      return `Sign in to use ${code}. It's ${perCustomer(reason.perCustomer)} per customer, so we need to know it's you.`;
    case 'alreadyUsed':
      return reason.perCustomer === 1
        ? `You've already used ${code}. It's one per customer.`
        : `You've already used ${code} ${reason.perCustomer} times. It's ${reason.perCustomer} per customer.`;
    case 'onHold':
      return `${code} is on hold for your unpaid order ${reason.orderNumber}. It frees up if you cancel that order, or if it isn't paid within 15 minutes.`;
    case 'notForTheseDishes':
      return `${code} is for ${joined(reason.cuisines, 'and')} dishes. Add a ${joined(reason.cuisines, 'or')} dish to use it.`;
    case 'minimumNotReached':
      return reason.cuisines.length === 0
        ? `${code} needs a subtotal of ${formatPrice(reason.minSubtotalCents)}. Add ${formatPrice(reason.shortfallCents)} more to use it.`
        : `${code} needs ${formatPrice(reason.minSubtotalCents)} of ${joined(reason.cuisines, 'and')} dishes. You have ${formatPrice(reason.eligibleCents)}, so add ${formatPrice(reason.shortfallCents)} more.`;
    case 'rateLimited':
      return (
        options.rateLimitMessage ?? 'Too many codes tried. You can try again in a few minutes.'
      );
    case 'unavailable':
    default:
      return PROMO_UNAVAILABLE;
  }
}
