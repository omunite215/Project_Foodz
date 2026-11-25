import { FRESHNESS, type Freshness } from '@/server/modules/tracking/schema';

/*
 * One freshness rule for every screen (F8 L5, U11): live under 30 s, "Updated 40 s ago" from
 * 30 s, hollow on the live map from 45 s, gray and "can't see" from 2 minutes, red for staff
 * from 10 minutes. Ages count from the server's acceptance time against the server's clock
 * (F5's offset), never the device's clock alone.
 */

/** Whole seconds since `at` on the server's clock; null without a point. */
export function ageSeconds(at: string | null, serverNowMs: number): number | null {
  if (!at) return null;
  const parsed = Date.parse(at);
  if (Number.isNaN(parsed)) return null;
  return Math.max(0, Math.floor((serverNowMs - parsed) / 1000));
}

export function freshnessFor(seconds: number | null): Freshness {
  if (seconds === null) return 'red';
  if (seconds < FRESHNESS.liveSeconds) return 'live';
  if (seconds < FRESHNESS.hollowSeconds) return 'recent';
  if (seconds < FRESHNESS.staleSeconds) return 'hollow';
  if (seconds < FRESHNESS.redSeconds) return 'stale';
  return 'red';
}

/** Two minutes or more without a point: gray, "can't see" (S5.2). */
export const isStale = (freshness: Freshness) => freshness === 'stale' || freshness === 'red';

/** 45 s or more: the live map's marker turns hollow (A46.3). */
export const isHollow = (freshness: Freshness) => freshness !== 'live' && freshness !== 'recent';

/** "40 s" in 10-second steps, then whole minutes: "1 min", "3 min". */
export function ageWords(seconds: number): { text: string; spoken: string } {
  if (seconds < 60) {
    const tens = Math.max(10, Math.floor(seconds / 10) * 10);
    return { text: `${tens} s`, spoken: `${tens} seconds` };
  }
  const minutes = Math.floor(seconds / 60);
  return { text: `${minutes} min`, spoken: `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}` };
}

/**
 * The customer's and courier's footer line (design 1.7): "Live" under 30 s, then "Updated 40 s
 * ago", "Updated 1 min ago". The 2-minute state has its own words (`pausedWords`).
 */
export function updatedWords(seconds: number): { text: string; spoken: string } {
  if (seconds < FRESHNESS.liveSeconds) return { text: 'Live', spoken: 'Live' };
  const age = ageWords(seconds);
  return { text: `Updated ${age.text} ago`, spoken: `Updated ${age.spoken} ago` };
}

/** Staff rows and panels (design 3.4): "Updated 12 s ago" from the first second. */
export function staffUpdatedWords(seconds: number | null): { text: string; spoken: string } {
  if (seconds === null) return { text: 'No location yet', spoken: 'No location yet' };
  if (seconds < 10) return { text: 'Updated just now', spoken: 'Updated just now' };
  if (seconds < 60) {
    return { text: `Updated ${seconds} s ago`, spoken: `Updated ${seconds} seconds ago` };
  }
  const age = ageWords(seconds);
  return { text: `Updated ${age.text} ago`, spoken: `Updated ${age.spoken} ago` };
}

/** The live map's label once a courier goes hollow (design 0): "No location · 45 s". */
export function noLocationWords(seconds: number): string {
  if (seconds < 60) return `No location · ${seconds} s`;
  return `No location · ${Math.floor(seconds / 60)} min`;
}
