import { distanceMeters, type Point } from '@/lib/map-geometry';
import { ageSeconds, freshnessFor, isStale } from '@/lib/tracking/freshness';

/*
 * Moving or stopped (F8 P37.1): the courier's map takes no touch while he moves. Moving is a
 * speed of 2 m/s or more, or 20 m covered in the last 10 s; stopped is 10 s below that.
 */

export interface PartnerFix extends Point {
  accuracy: number | null;
  speed: number | null;
  /** Device time, ms. */
  at: number;
}

const MOVING_SPEED = 2;
const MOVING_METERS = 20;
const WINDOW_MS = 10_000;

export function isMoving(fixes: readonly PartnerFix[], now: number): boolean {
  const recent = fixes.filter((fix) => now - fix.at <= WINDOW_MS);
  if (recent.some((fix) => (fix.speed ?? 0) >= MOVING_SPEED)) return true;
  const first = recent[0];
  const last = recent.at(-1);
  return Boolean(first && last && distanceMeters(first, last) >= MOVING_METERS);
}

/** Keeps the last 10 seconds of fixes (plus the newest), oldest first. */
export function keepRecent(fixes: readonly PartnerFix[], next: PartnerFix): PartnerFix[] {
  if (fixes.at(-1)?.at === next.at) return [...fixes];
  return [...fixes.filter((fix) => next.at - fix.at <= WINDOW_MS), next];
}

/**
 * F8 review S8 (design 0's map table): his own map goes gray and dashed by the same rule as the
 * customer's, from the server's last accepted point (or going online, before the first one).
 */
export function ownMapStale(
  lastAcceptedAt: string | null,
  onlineSince: string | null,
  serverNowMs: number,
): boolean {
  const since = lastAcceptedAt ?? onlineSince;
  if (!since) return false;
  return isStale(freshnessFor(ageSeconds(since, serverNowMs)));
}
