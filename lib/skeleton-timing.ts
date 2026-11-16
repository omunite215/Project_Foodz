/*
 * Loading skeletons appear only after 150 ms, and once they appear they stay at least 300 ms,
 * so a page that arrives just after the skeleton does not flicker. The skeleton records when it
 * became visible; the page that replaces it asks how much longer to hold it.
 */

export const SKELETON_DELAY_MS = 150;
export const SKELETON_MIN_VISIBLE_MS = 300;

let visibleSince: number | null = null;

export function markSkeletonVisible(now = performance.now()): void {
  visibleSince = now;
}

export function markSkeletonGone(): void {
  visibleSince = null;
}

/** How long the arriving page should keep showing the skeleton: 0 when none was shown. */
export function skeletonHoldMs(now = performance.now()): number {
  if (visibleSince === null) return 0;
  return Math.max(0, SKELETON_MIN_VISIBLE_MS - (now - visibleSince));
}
