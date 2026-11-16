import type { Cuisine } from '@/server/db/enums';
import type { DayHours, StoreMoment, StoreStatus, Weekday } from '@/server/modules/menu/schema';

/*
 * Wording for the storefront: prices, ratings, countdowns and the store's hours. Pure functions
 * only, so the same text comes out on the server and in the browser.
 */

export const CUISINE_LABELS: Record<Cuisine, string> = {
  KOREAN: 'Korean',
  THAI: 'Thai',
  VIETNAMESE: 'Vietnamese',
};

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const count = new Intl.NumberFormat('en-US');

/** 1299 gives "$12.99"; always two decimals. */
export function formatPrice(cents: number): string {
  return usd.format(cents / 100);
}

export function plural(value: number, one: string, many = `${one}s`): string {
  return `${count.format(value)} ${value === 1 ? one : many}`;
}

/** One decimal: 4.6, 5.0. */
export function formatRating(average: number): string {
  return average.toFixed(1);
}

/** What a rating reads as: "4.6 · 120 reviews", or "No reviews yet". */
export function ratingText(average: number, reviews: number): string {
  if (reviews === 0) return 'No reviews yet';
  return `${formatRating(average)} · ${plural(reviews, 'review')}`;
}

/** What a screen reader hears for a rating: "rated 4.6 out of 5, 120 reviews". */
export function ratingLabel(average: number, reviews: number): string {
  if (reviews === 0) return 'No reviews yet';
  return `rated ${formatRating(average)} out of 5, ${plural(reviews, 'review')}`;
}

export type StarKind = 'full' | 'half' | 'empty';

/** Five stars: a half star when the decimal part is at least .25 and below .75. */
export function starKinds(average: number): StarKind[] {
  const clamped = Math.min(5, Math.max(0, average));
  const whole = Math.floor(clamped);
  const rest = clamped - whole;
  return Array.from({ length: 5 }, (_, index) => {
    if (index < whole) return 'full';
    if (index === whole && rest >= 0.75) return 'full';
    if (index === whole && rest >= 0.25) return 'half';
    return 'empty';
  });
}

export function prepTimeText(minutes: number): string {
  return `Ready in about ${minutes} min`;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * Time left on an offer: "Ends in 29 days", "Ends in 5 h", "Ends in 42 min". Null once the
 * offer has ended, so the badge disappears instead of counting below zero.
 */
export function offerTimeLeft(endsAt: string, now: Date | number): string | null {
  const left = Date.parse(endsAt) - (typeof now === 'number' ? now : now.getTime());
  if (!Number.isFinite(left) || left <= 0) return null;
  if (left >= DAY_MS) return `Ends in ${plural(Math.floor(left / DAY_MS), 'day')}`;
  if (left >= HOUR_MS) return `Ends in ${Math.floor(left / HOUR_MS)} h`;
  return `Ends in ${Math.ceil(left / MINUTE_MS)} min`;
}

/** "21:00" gives "9 pm", "11:30" gives "11:30 am", "00:00" gives "12 am". */
export function formatClock(clock: string): string {
  const [hours = 0, minutes = 0] = clock.split(':').map(Number);
  const suffix = hours < 12 ? 'am' : 'pm';
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return minutes === 0
    ? `${hour12} ${suffix}`
    : `${hour12}:${String(minutes).padStart(2, '0')} ${suffix}`;
}

export const WEEKDAY_NAMES: Record<Weekday, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};

const WEEKDAY_SHORT: Record<Weekday, string> = {
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
  sun: 'Sun',
};

/** "11 am tomorrow", "12 pm today", "12 pm Saturday". */
export function momentText(moment: StoreMoment): string {
  const time = formatClock(moment.time);
  if (moment.day === 'today') return `${time} today`;
  if (moment.day === 'tomorrow') return `${time} tomorrow`;
  return `${time} ${WEEKDAY_NAMES[moment.weekday]}`;
}

/** The short status line: "Open now · until 10 pm", "Closed · opens 11 am tomorrow". */
export function storeStatusText(status: Pick<StoreStatus, 'isOpen' | 'closesAt' | 'opensAt'>) {
  if (status.isOpen) {
    return status.closesAt ? `Open now · until ${formatClock(status.closesAt.time)}` : 'Open now';
  }
  return status.opensAt ? `Closed · opens ${momentText(status.opensAt)}` : 'Closed';
}

/** The second line of the closed notice. */
export function closedNoticeText(opensAt: StoreMoment | null): string {
  return opensAt
    ? `You can fill your cart now and order from ${momentText(opensAt)}.`
    : 'You can fill your cart now and order when we open again.';
}

export interface HoursRow {
  /** "Mon–Thu", "Fri" */
  days: string;
  /** "11 am–10 pm", or "Closed" */
  hours: string;
  weekdays: Weekday[];
}

const sameHours = (a: DayHours | null, b: DayHours | null) =>
  a === b || (a !== null && b !== null && a.open === b.open && a.close === b.close);

/** Weekly hours with neighbouring days that share their hours grouped: "Mon–Thu 11 am–10 pm". */
export function groupWeeklyHours(week: StoreStatus['weeklyHours']): HoursRow[] {
  const rows: { hours: DayHours | null; weekdays: Weekday[] }[] = [];
  for (const day of week) {
    const last = rows.at(-1);
    if (last && sameHours(last.hours, day.hours)) last.weekdays.push(day.weekday);
    else rows.push({ hours: day.hours, weekdays: [day.weekday] });
  }
  return rows.map(({ hours, weekdays }) => {
    const first = weekdays[0] ?? 'mon';
    const last = weekdays.at(-1) ?? first;
    return {
      days:
        first === last ? WEEKDAY_SHORT[first] : `${WEEKDAY_SHORT[first]}–${WEEKDAY_SHORT[last]}`,
      hours: hours ? `${formatClock(hours.open)}–${formatClock(hours.close)}` : 'Closed',
      weekdays,
    };
  });
}

/** "1 item in your cart", "2 items in your cart". */
export function cartCountLabel(items: number): string {
  return `${plural(items, 'item')} in your cart`;
}

/** The number on the header badge: "99+" above 99. */
export function cartBadgeText(items: number): string {
  return items > 99 ? '99+' : String(items);
}

/** "1 dish added to your cart", "3 dishes added to your cart". */
export function dishesAddedText(dishes: number): string {
  return `${plural(dishes, 'dish', 'dishes')} added to your cart`;
}

/** "Korean, 12 dishes" */
export function cuisineTabLabel(cuisine: Cuisine, dishes: number): string {
  return `${CUISINE_LABELS[cuisine]}, ${plural(dishes, 'dish', 'dishes')}`;
}

export interface TextPart {
  text: string;
  isCode: boolean;
  /** Where the part starts in the text: a stable key. */
  start: number;
}

const isWordChar = (char: string | undefined) => char !== undefined && /[A-Za-z0-9]/.test(char);

/**
 * Splits campaign copy around its coupon code, so the code can be shown as selectable text:
 * "with code KBBQ5" gives ["with code ", "KBBQ5"]. The code is matched as a whole word, case
 * sensitively; text without the code comes back as one part.
 */
export function splitByCode(text: string, code: string): TextPart[] {
  if (!code) return [{ text, isCode: false, start: 0 }];
  const parts: TextPart[] = [];
  let rest = 0;
  let index = text.indexOf(code);
  while (index !== -1) {
    const end = index + code.length;
    if (!isWordChar(text[index - 1]) && !isWordChar(text[end])) {
      if (index > rest) parts.push({ text: text.slice(rest, index), isCode: false, start: rest });
      parts.push({ text: code, isCode: true, start: index });
      rest = end;
    }
    index = text.indexOf(code, end);
  }
  if (rest < text.length) parts.push({ text: text.slice(rest), isCode: false, start: rest });
  return parts;
}

export function containsCode(text: string, code: string): boolean {
  return splitByCode(text, code).some((part) => part.isCode);
}

/** The street and town of an address: "88 Harbor Street, Boston, MA 02210" gives "88 Harbor Street, Boston". */
export function shortAddress(address: string): string {
  return address.split(',').slice(0, 2).join(',').trim();
}
