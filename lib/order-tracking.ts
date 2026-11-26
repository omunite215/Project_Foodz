import type { CustomerTracking } from '@/server/modules/tracking/schema';
import { clockAt } from '@/server/modules/orders/text';
import { isStale } from '@/lib/tracking/freshness';
import type { Freshness } from '@/server/modules/tracking/schema';

/*
 * The customer's tracking words (F8 design 1.4 to 1.7, "Copy"): the arrival row from pickup,
 * the map's text twin and footer, the code card and the at-the-door banner. Figures come from
 * the server (`etaAt`, `distanceM`); minutes are counted on the server's clock. Names keep their
 * capitals: sentences are built from parts, never lowercased (F7 review S4).
 */

export type ArrivalKind = 'eta' | 'almost' | 'overdue' | 'cantSee';

export interface TrackingArrival {
  kind: ArrivalKind;
  headline: string;
  spoken: string;
  /** F5 6.5's note box: the apology once the estimate has passed. */
  note: string | null;
}

export const LATER_NOTE = 'Running a few minutes later than we thought.';
export const OVERDUE_NOTE =
  "Your order is later than we said, sorry. Call us on {phone} if you'd like to check on it.";

/** Minutes until `etaAt`, rounded up; null at or past it (never "0 min"). */
export function minutesUntil(etaAt: string, serverNowMs: number): number | null {
  const ms = Date.parse(etaAt) - serverNowMs;
  if (Number.isNaN(ms) || ms <= 0) return null;
  return Math.max(1, Math.ceil(ms / 60_000));
}

const possessive = (name: string) => `${name}'s`;

export const cantSeeText = (courierFirst: string) =>
  `We can't see ${possessive(courierFirst)} location right now. Your order is still on its way.`;

export const almostText = (courierFirst: string) => `${courierFirst} is almost there.`;

/** The arrival row from pickup to the end (design 1.4). */
export function trackingArrival(facts: {
  tracking: Pick<CustomerTracking, 'route' | 'almost'>;
  courierFirst: string;
  freshness: Freshness;
  serverNowMs: number;
  timeZone: string;
}): TrackingArrival | null {
  const { tracking, courierFirst, freshness, serverNowMs, timeZone } = facts;
  if (isStale(freshness)) {
    const text = cantSeeText(courierFirst);
    return { kind: 'cantSee', headline: text, spoken: text, note: null };
  }
  if (tracking.almost) {
    const text = almostText(courierFirst);
    return { kind: 'almost', headline: text, spoken: text, note: null };
  }
  const route = tracking.route;
  if (!route) return null;
  const minutes = minutesUntil(route.etaAt, serverNowMs);
  if (minutes === null) {
    return {
      kind: 'overdue',
      headline: 'Arriving soon',
      spoken: 'Arriving soon',
      note: OVERDUE_NOTE,
    };
  }
  const clock = clockAt(route.etaAt, timeZone);
  return {
    kind: 'eta',
    headline: `Arriving in about ${minutes} min · ${clock}`,
    spoken: `Arriving in about ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}, at ${clock}`,
    note: null,
  };
}

/** S2.3: the estimate grew by 5 minutes or more since the last one this page showed. */
export const grewALot = (before: string | null, after: string) =>
  before !== null && Date.parse(after) - Date.parse(before) >= 5 * 60_000;

/** The map's text twin (S1.5): "Luis is about 0.9 km away." */
export function distanceSentence(courierFirst: string, meters: number | null): string {
  if (meters === null) return `${courierFirst} is on the way.`;
  if (meters < 100) return `${courierFirst} is very close.`;
  if (meters < 1000) return `${courierFirst} is about ${Math.round(meters / 50) * 50} m away.`;
  return `${courierFirst} is about ${(Math.round(meters / 100) / 10).toFixed(1)} km away.`;
}

/** "Location paused · last seen 7:51 pm" (design 1.7). */
export const pausedWords = (lastAt: string, timeZone: string) =>
  `Location paused · last seen ${clockAt(lastAt, timeZone)}`;

/** The code card: "4 8 2 1" on screen, "4, 8, 2, 1." read aloud (S3.2). */
export const codeShown = (code: string) => code.split('').join(' ');
export const codeSpoken = (code: string) => `${code.split('').join(', ')}.`;

export const codeHelpText = (courierFirst: string) =>
  `Give this code to ${courierFirst} when your food arrives. Don't share it before then.`;

/** The at-the-door banner (S4.2): the first sentence carries the phone as a link. */
export const atDoorText = (courierFirst: string) =>
  `${courierFirst} is at your door and couldn't reach you. Come to the door with your code, or call us on {phone}.`;

/** U1: before pickup, once the courier is at the kitchen. */
export const atKitchenLine = (courierFirst: string) =>
  `${courierFirst} is at the kitchen picking up your order.`;

/** The courier's name, never a pronoun guessed for them. */
export const mapFailedText = (courierFirst: string) =>
  `Map unavailable right now. ${courierFirst} is still on the way.`;

/** Whether the map, code and banner apply: on its way, with the server's tracking view. */
export const tracksLive = (tracking: CustomerTracking | null | undefined) =>
  Boolean(tracking && tracking.stage === 'delivering');
