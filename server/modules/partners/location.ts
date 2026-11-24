import { distanceMeters, type Point } from '@/lib/map-geometry';

/*
 * Pure rules of location sharing (F6 P9, P10, P11, P16, B7, B8, B22). The route keeps the last
 * accepted point in Redis and feeds it back in; nothing here touches storage or the clock.
 */

/** P16.5: a point less accurate than this is refused and never stored. */
export const MAX_ACCURACY_M = 500;
/** P9.7: above this (and up to the maximum) the line reads "Weak GPS signal". */
export const WEAK_ACCURACY_M = 100;
/** P16.3 and plan §4: faster than this from the last accepted point is a spoofed jump. */
export const MAX_SPEED_KMH = 200;
/** P16.4: recorded more than this far ahead of the server's clock. */
export const MAX_FUTURE_MS = 10_000;
/** P16.4, P11.3: points older than this are refused (and dropped unsent by the app). */
export const MAX_POINT_AGE_MS = 10 * 60_000;
/** P16.2: points in one batch closer together than this are thinned, the later kept. */
export const MIN_POINT_GAP_MS = 2_000;
/** P16.2, P11.2. */
export const MAX_BATCH_POINTS = 50;
/** P10.8, B22: no accepted point for this long means stale, which dispatch reads as "don't offer". */
export const STALE_AFTER_MS = 2 * 60_000;
/** P10.8, B8: no accepted point for this long takes the partner offline. */
export const OFFLINE_AFTER_MS = 10 * 60_000;
/** P10.6, B8: idle partners go offline this long after the kitchen closes. */
export const KITCHEN_CLOSED_OFFLINE_AFTER_MS = 60 * 60_000;
/** B7, P15.2: the Redis point expires on its own after this many seconds. */
export const LOCATION_TTL_SECONDS = 600;
/** B7: `last_location` and `last_seen_at` are written at most this often. */
export const LAST_LOCATION_WRITE_MS = 60_000;
/** P10.1: "At the kitchen" within this distance. */
export const AT_KITCHEN_M = 100;
/** B12: where the demo partner is placed; real points from demo accounts are refused. */
export const DEMO_POINT: Point = { lat: 42.3515, lng: -71.043 };

/** One position as the app sends it (P16.5). Instants are ISO 8601. */
export interface LocationPoint {
  lat: number;
  lng: number;
  accuracy: number;
  heading: number | null;
  speed: number | null;
  recordedAt: string;
}

/** The last point the server accepted, as kept in Redis (`partner:loc:<id>`). */
export interface AcceptedPoint {
  lat: number;
  lng: number;
  accuracy: number;
  recordedAt: string;
}

export const POINT_REFUSALS = [
  'LOW_ACCURACY',
  'FUTURE_POINT',
  'STALE_POINT',
  'IMPLAUSIBLE_JUMP',
] as const;
export type PointRefusal = (typeof POINT_REFUSALS)[number];

/**
 * What happened to each point of a batch, in the order sent (P11.5): accepted points are kept,
 * ignored ones are harmless repeats or thinned, refused ones are dropped by the app and never
 * retried.
 */
export type PointResult =
  | { index: number; result: 'accepted' }
  | { index: number; result: 'ignored'; why: 'repeat' | 'thinned' }
  | { index: number; result: 'refused'; code: PointRefusal };

export interface BatchVerdict {
  results: PointResult[];
  /** The newest accepted point, or the previous one when nothing was accepted. */
  last: AcceptedPoint | null;
  /** How many jumps were refused, for the alert at 10 an hour (P16.6). */
  jumps: number;
}

/** km/h between two points; the time difference counts as at least one second (B7). */
export function speedKmh(from: AcceptedPoint, to: AcceptedPoint): number {
  const seconds = Math.max(1, (Date.parse(to.recordedAt) - Date.parse(from.recordedAt)) / 1000);
  return (distanceMeters(from, to) / seconds) * 3.6;
}

/**
 * Checks one point on its own (P16.4, P16.5): accuracy and recorded time. A point that passes
 * may still be a repeat or a jump against the last accepted one.
 */
export function pointRefusal(
  point: LocationPoint,
  now: Date,
): Exclude<PointRefusal, 'IMPLAUSIBLE_JUMP'> | null {
  if (point.accuracy > MAX_ACCURACY_M) return 'LOW_ACCURACY';
  const at = Date.parse(point.recordedAt);
  if (at > now.getTime() + MAX_FUTURE_MS) return 'FUTURE_POINT';
  if (at < now.getTime() - MAX_POINT_AGE_MS) return 'STALE_POINT';
  return null;
}

const toAccepted = (point: LocationPoint): AcceptedPoint => ({
  lat: point.lat,
  lng: point.lng,
  accuracy: point.accuracy,
  recordedAt: new Date(point.recordedAt).toISOString(),
});

/**
 * Judges a batch against the last accepted point (P16.2 to P16.5). Points are taken in
 * recorded order; within the batch, a point less than 2 seconds before the next one is thinned
 * (the later is kept). A point at or before the last accepted one is a harmless repeat. The
 * speed check compares with the last accepted point only, so a refused jump never moves it.
 * `last` is null right after going online, so the first point starts afresh.
 */
export function judgeBatch(
  points: readonly LocationPoint[],
  last: AcceptedPoint | null,
  now: Date,
): BatchVerdict {
  const order = points
    .map((point, index) => ({ point, index, at: Date.parse(point.recordedAt) }))
    .toSorted((a, b) => a.at - b.at || a.index - b.index);

  const results: PointResult[] = [];
  let current = last;
  let jumps = 0;

  order.forEach(({ point, index, at }, position) => {
    const next = order[position + 1];
    const refusal = pointRefusal(point, now);
    if (refusal) {
      results.push({ index, result: 'refused', code: refusal });
      return;
    }
    if (next && next.at - at < MIN_POINT_GAP_MS && !pointRefusal(next.point, now)) {
      results.push({ index, result: 'ignored', why: 'thinned' });
      return;
    }
    if (current && at <= Date.parse(current.recordedAt)) {
      results.push({ index, result: 'ignored', why: 'repeat' });
      return;
    }
    const candidate = toAccepted(point);
    if (current && speedKmh(current, candidate) > MAX_SPEED_KMH) {
      jumps += 1;
      results.push({ index, result: 'refused', code: 'IMPLAUSIBLE_JUMP' });
      return;
    }
    current = candidate;
    results.push({ index, result: 'accepted' });
  });

  return { results: results.toSorted((a, b) => a.index - b.index), last: current, jumps };
}

/**
 * Security gate S7: a point at exactly the coordinates already held counts as fresh for at most
 * this long after the partner last moved. A phone that has lost its GPS but keeps sending its
 * last fix then goes stale, so dispatch stops offering him orders, and offline 10 minutes later.
 */
export const SAME_PLACE_FRESH_MS = STALE_AFTER_MS;

/**
 * The stored point's two clocks after an accepted point (B7, S7): `acceptedAt` is what freshness
 * reads ("last point"), `movedAt` when the coordinates last changed. Unchanged coordinates move
 * `acceptedAt` no further than `movedAt` + 2 minutes, and never back.
 */
export function pointClocks(
  previous: { lat: number; lng: number; acceptedAt: string; movedAt?: string | null } | null,
  point: Point,
  now: Date,
): { acceptedAt: string; movedAt: string } {
  const at = now.toISOString();
  if (!previous || previous.lat !== point.lat || previous.lng !== point.lng) {
    return { acceptedAt: at, movedAt: at };
  }
  const movedAt = previous.movedAt ?? previous.acceptedAt;
  const cap = Date.parse(movedAt) + SAME_PLACE_FRESH_MS;
  const acceptedAt = Math.max(Date.parse(previous.acceptedAt), Math.min(now.getTime(), cap));
  return { acceptedAt: new Date(acceptedAt).toISOString(), movedAt };
}

// ------------------------------------------------------------------ availability

/** B22: what dispatch (F7) and the staff page read. */
export type Freshness = 'offline' | 'available' | 'stale';

export function freshnessOf(
  partner: { isOnline: boolean; lastPointAt: string | null },
  now: Date,
): Freshness {
  if (!partner.isOnline) return 'offline';
  if (!partner.lastPointAt) return 'stale';
  return now.getTime() - Date.parse(partner.lastPointAt) < STALE_AFTER_MS ? 'available' : 'stale';
}

/** Why the server took a partner offline by itself (B8, B9, B11). */
export type AutoOfflineReason = 'no-location' | 'kitchen-closed';

/**
 * The auto-offline job's decision for one online partner (B8, P10.6, P10.8). The "no point"
 * clock runs from the last accepted point, or from going online when none came. Kitchen
 * closed: idle partners an hour after the last closing, while the kitchen is still closed.
 * F8 adds "never during a delivery".
 */
export function autoOfflineReason(
  partner: { onlineSince: string; lastPointAt: string | null },
  kitchen: { isOpen: boolean; lastClosedAt: string | null },
  now: Date,
): AutoOfflineReason | null {
  const since = Date.parse(partner.lastPointAt ?? partner.onlineSince);
  if (now.getTime() - since >= OFFLINE_AFTER_MS) return 'no-location';
  if (
    !kitchen.isOpen &&
    kitchen.lastClosedAt &&
    now.getTime() - Date.parse(kitchen.lastClosedAt) >= KITCHEN_CLOSED_OFFLINE_AFTER_MS &&
    Date.parse(partner.onlineSince) < now.getTime() - KITCHEN_CLOSED_OFFLINE_AFTER_MS
  ) {
    return 'kitchen-closed';
  }
  return null;
}

/** "At the kitchen" within 100 m, otherwise kilometres to one decimal (P10.1). */
export function kitchenDistance(at: Point, kitchen: Point): { atKitchen: boolean; km: number } {
  const meters = distanceMeters(at, kitchen);
  return { atKitchen: meters <= AT_KITCHEN_M, km: Math.round(meters / 100) / 10 };
}

/** Whether a location write to Postgres is due (B7): at most once a minute. */
export const lastLocationWriteDue = (lastWrittenAt: string | null, now: Date): boolean =>
  !lastWrittenAt || now.getTime() - Date.parse(lastWrittenAt) >= LAST_LOCATION_WRITE_MS;
