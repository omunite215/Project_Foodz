import { distanceMeters } from '@/lib/map-geometry';

/*
 * The app's rules for sending positions while online (F6 P10.3, P11, P16.5, design 6.4): a
 * point when he has moved 25 m, at most every 4 s, and a 15 s heartbeat; up to 150 kept in
 * memory while the connection is down, none older than 10 minutes, oldest dropped first; sent
 * oldest first, 50 a request, one request every 2 s. Pure, so it can be tested on its own.
 */

export const MIN_MOVE_M = 25;
export const MIN_GAP_MS = 4_000;
/**
 * Standing still sends a point this often, well inside the server's 2-minute freshness rule
 * (B22). The order's live map (F7) wants one every 15 s too.
 */
export const HEARTBEAT_MS = 15_000;
/**
 * No fix from the phone for this long: ask it for one. Some phones report only changes, so a
 * partner standing still would otherwise send nothing and go stale (P10.3). Shorter than
 * `LOOKING_AFTER_MS`, so "Looking for GPS…" means the phone really can't answer (P11.6).
 */
export const REREAD_AFTER_MS = 5_000;
export const QUEUE_MAX = 150;
export const QUEUE_MAX_AGE_MS = 10 * 60_000;
export const BATCH_SIZE = 50;
export const SEND_GAP_MS = 2_000;
/** P16.5: worse than this is never sent. */
export const SEND_ACCURACY_M = 500;
/** P9.7: 101 to 500 m goes online, with "Weak GPS signal". */
export const WEAK_ACCURACY_M = 100;
/** D21: only fixes worse than 500 m for this long means "approximate". */
export const APPROXIMATE_AFTER_MS = 10_000;
/** P9.4: no fix at all for this long means "not found". */
export const NOT_FOUND_AFTER_MS = 20_000;
/** P11.6: "Looking for GPS…" after this long without a fix. */
export const LOOKING_AFTER_MS = 10_000;
/** B22: no accepted point for 2 minutes means not offered orders. */
export const STALE_AFTER_MS = 2 * 60_000;
/** The pinned "No connection" banner waits this long, to show within 3 s (P11.1). */
export const CONNECTION_BANNER_DELAY_MS = 2_500;
/** "Back online. Location sent." stays this long. */
export const BACK_ONLINE_MS = 4_000;
/** A send without an answer in this long is given up and retried. */
export const SEND_TIMEOUT_MS = 10_000;

export interface Fix {
  lat: number;
  lng: number;
  accuracy: number;
  heading: number | null;
  speed: number | null;
  /** Device time of the fix, ms. */
  at: number;
}

export interface QueuedPoint {
  lat: number;
  lng: number;
  accuracy: number;
  heading: number | null;
  speed: number | null;
  recordedAt: string;
  at: number;
}

const finite = (value: number | null, max: number) =>
  value === null || !Number.isFinite(value) || value < 0 ? null : Math.min(value, max);

/** The fix as the server's `LocationPoint` (finite numbers, ranges respected). */
export function toPoint(fix: Fix): QueuedPoint {
  return {
    lat: fix.lat,
    lng: fix.lng,
    accuracy: Math.max(0, Math.min(fix.accuracy, 10_000)),
    heading: finite(fix.heading, 360),
    speed: finite(fix.speed, 100),
    recordedAt: new Date(fix.at).toISOString(),
    at: fix.at,
  };
}

/** Whether this fix should be sent (design 6.4). */
export function shouldQueue(fix: Fix, last: QueuedPoint | null, now: number): boolean {
  if (fix.accuracy > SEND_ACCURACY_M) return false;
  if (!last) return true;
  const gap = now - last.at;
  if (gap < MIN_GAP_MS) return false;
  if (gap >= HEARTBEAT_MS) return true;
  return distanceMeters(last, fix) >= MIN_MOVE_M;
}

/** Drops points older than 10 minutes, then the oldest beyond 150 (P11.3). */
export function pruneQueue(queue: readonly QueuedPoint[], now: number): QueuedPoint[] {
  const fresh = queue.filter((point) => now - point.at <= QUEUE_MAX_AGE_MS);
  return fresh.length > QUEUE_MAX ? fresh.slice(fresh.length - QUEUE_MAX) : fresh;
}

/** The next request's points: the oldest 50. */
export const nextBatch = (queue: readonly QueuedPoint[]) => queue.slice(0, BATCH_SIZE);

/** P11.5: 2, 4, 8… up to 30 seconds. */
export const backoffMs = (attempt: number) => Math.min(30_000, 2_000 * 2 ** Math.max(0, attempt));

/** The body of `POST /api/v1/partner/locations`. */
export const locationsBody = (points: readonly QueuedPoint[]) => ({
  points: points.map(({ lat, lng, accuracy, heading, speed, recordedAt }) => ({
    lat,
    lng,
    accuracy,
    heading,
    speed,
    recordedAt,
  })),
});

export type FixQuality = 'good' | 'weak' | 'tooCoarse';

export const fixQuality = (accuracy: number): FixQuality =>
  accuracy > SEND_ACCURACY_M ? 'tooCoarse' : accuracy > WEAK_ACCURACY_M ? 'weak' : 'good';

/** Seconds to wait from `Retry-After` (seconds) or a body's `retryAfterSeconds`. */
export function retryAfterSeconds(header: string | null, body: unknown): number {
  const fromHeader = header ? Number.parseInt(header, 10) : Number.NaN;
  if (Number.isFinite(fromHeader) && fromHeader > 0) return fromHeader;
  if (typeof body === 'object' && body !== null) {
    const value = Reflect.get(body, 'retryAfterSeconds');
    if (typeof value === 'number' && value > 0) return value;
  }
  return 60;
}
