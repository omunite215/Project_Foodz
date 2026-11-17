/*
 * Wording for sign-in and account screens. Pure functions, so the same text comes out on the
 * server and in the browser, and the edge cases are tested.
 */

/** The avatar letter: the first grapheme of the name in capitals ("M", "김", "É"). */
export function initialOf(name: string): string {
  const text = name.trim();
  if (!text) return '?';
  const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
  const first = segmenter.segment(text)[Symbol.iterator]().next().value?.segment ?? text[0]!;
  return first.toLocaleUpperCase('en-US');
}

/** "(1 item)", "(3 items)": the cart's total quantity, as on the header badge. */
export function itemsText(count: number): string {
  return `(${count} ${count === 1 ? 'item' : 'items'})`;
}

const dayMonthYear = (timeZone?: string) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone });

/** "12 Nov 2026". */
export function shortDate(iso: string, timeZone?: string): string {
  return dayMonthYear(timeZone).format(new Date(iso));
}

/** "6:40 pm" in the reader's clock. */
export function clockTime(date: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone })
    .format(date)
    .replace(/\s?([AP])M$/i, (_, half: string) => ` ${half.toLowerCase()}m`);
}

/** The moment a wait of `seconds` ends, as a clock time. */
export function clockTimeAfter(seconds: number, now = new Date(), timeZone?: string): string {
  return clockTime(new Date(now.getTime() + Math.max(0, seconds) * 1000), timeZone);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** "Active now" for this device; otherwise "Last active today", "yesterday", "2 days ago". */
export function lastActiveText(lastActiveAt: string, isCurrent: boolean, now = new Date()) {
  if (isCurrent) return 'Active now';
  const days = Math.max(0, Math.floor((now.getTime() - new Date(lastActiveAt).getTime()) / DAY_MS));
  if (days === 0) return 'Last active today';
  if (days === 1) return 'Last active yesterday';
  return `Last active ${days} days ago`;
}

/** "Signed in 12 Nov 2026 · Active now". */
export function deviceActivityText(
  device: { signedInAt: string; lastActiveAt: string; isCurrent: boolean },
  now = new Date(),
  timeZone?: string,
): string {
  return `Signed in ${shortDate(device.signedInAt, timeZone)} · ${lastActiveText(device.lastActiveAt, device.isCurrent, now)}`;
}

/** The device name as shown; an agent the server could not read gets a plain sentence. */
export function deviceName(label: string): string {
  return label === 'Unknown browser' ? "A browser we don't recognise" : label;
}

/** "You can resend in 45 s". */
export function resendCountdownText(secondsLeft: number): string {
  return `You can resend in ${Math.max(1, Math.ceil(secondsLeft))} s`;
}

// ------------------------------------------------------------------ delivery (design 5.7)

export interface DeliveryFigures {
  deliverable: boolean;
  /** The server's figure, one decimal. */
  distanceKm: number;
  radiusKm: number;
  /** "88 Harbor Street". */
  storeStreet: string;
}

const km = (value: number) => value.toFixed(1);
const radiusText = (radius: number) => (Number.isInteger(radius) ? String(radius) : km(radius));

/**
 * The delivery result in words. Distances read so the edges never contradict the verdict: an
 * address inside that rounds to the radius is "just under", one outside is "just over".
 */
export function deliveryText(figures: DeliveryFigures, place: string): string {
  const radius = radiusText(figures.radiusKm);
  const distance = Number(km(figures.distanceKm));
  if (figures.deliverable) {
    if (distance < 0.1) return 'We deliver here · less than 0.1 km from our kitchen';
    if (distance >= figures.radiusKm) {
      return `We deliver here · just under ${radius} km from our kitchen`;
    }
    return `We deliver here · about ${km(distance)} km from our kitchen`;
  }
  const how = distance <= figures.radiusKm ? `just over ${radius} km` : `about ${km(distance)} km`;
  return `Sorry, we don't deliver to ${place} yet. It's ${how} from our kitchen at ${figures.storeStreet}, and we deliver within ${radius} km.`;
}
