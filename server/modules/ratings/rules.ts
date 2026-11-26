import { isDeployedProduction } from '@/server/deployment';
import {
  COURIER_TAGS,
  RATING_RULES,
  type RatingCardState,
  type StaffOrderFeedback,
  type TagCount,
} from './schema';

/*
 * Ratings rules as pure functions (contract §6, §7): the window, the card's state, the Orders
 * list flag, the staff feedback state, the partner's tag split, the reminder's words and the
 * test knobs (B13), which may only shorten waits and are refused on a deployed production.
 */

type Env = Record<string, string | undefined>;
const isOn = (value: string | undefined) => value === '1' || value === 'true';
const testTimingOn = (env: Env) => isOn(env.FOODZ_TEST_TIMING) && !isDeployedProduction(env);

function knob(env: Env, name: string, fallback: number, min: number): number {
  if (!testTimingOn(env)) return fallback;
  const value = Number(env[name]);
  return Number.isFinite(value) && value >= min && value <= fallback ? value : fallback;
}

export interface RatingTimings {
  windowDays: number;
  reminderMinutes: number;
  partnerLagDays: number;
}

/** The story's values, or shorter test values behind `FOODZ_TEST_TIMING=1`. */
export function ratingTimings(env: Env): RatingTimings {
  return {
    windowDays: knob(env, 'RATING_WINDOW_DAYS', RATING_RULES.windowDays, 0.0001),
    reminderMinutes: knob(env, 'RATING_REMINDER_MINUTES', RATING_RULES.reminderMinutes, 0.05),
    partnerLagDays: knob(env, 'PARTNER_RATING_LAG_DAYS', RATING_RULES.partnerLagDays, 0),
  };
}

export const windowClosesAt = (deliveredAt: Date, windowDays: number) =>
  new Date(deliveredAt.getTime() + windowDays * 86_400_000);

export interface RatingFacts {
  status: string;
  deliveredAt: Date | null;
  skippedAt: Date | null;
  ratedAny: boolean;
}

/** The card's state and whether it can still change (story "What Maya sees", V1.2). */
export function ratingCardState(
  facts: RatingFacts,
  now: Date,
  windowDays: number,
): { state: RatingCardState; editable: boolean; closesAt: Date | null } {
  if (facts.status === 'CANCELLED' || !facts.deliveredAt) {
    return { state: 'none', editable: false, closesAt: null };
  }
  const closesAt = windowClosesAt(facts.deliveredAt, windowDays);
  const open = now.getTime() <= closesAt.getTime();
  if (facts.ratedAny) return { state: 'rated', editable: open, closesAt };
  if (!open) return { state: 'closed', editable: false, closesAt };
  return { state: facts.skippedAt ? 'skipped' : 'open', editable: true, closesAt };
}

/** S6.1: "Rate" while open and untouched, "Rated" once anything is rated. */
export function orderListFlag(
  facts: RatingFacts,
  now: Date,
  windowDays: number,
): 'rate' | 'rated' | null {
  const { state } = ratingCardState(facts, now, windowDays);
  if (state === 'rated') return 'rated';
  return state === 'open' ? 'rate' : null;
}

/** A65.1's line when nothing is rated. */
export function feedbackState(
  facts: RatingFacts,
  now: Date,
  windowDays: number,
): StaffOrderFeedback['state'] {
  if (facts.status === 'CANCELLED') return 'cancelled';
  const { state } = ratingCardState(facts, now, windowDays);
  if (state === 'none') return 'none';
  if (state === 'rated') return 'rated';
  if (state === 'closed') return 'closed';
  return state === 'skipped' ? 'skipped' : 'open';
}

/** V3.3, U14: customers see a courier's rating from 5 counted ratings. */
export const courierShown = (count: number) => count >= RATING_RULES.courierShownAt;

/** "What customers liked" and "What customers mentioned" (P58.2). */
export function splitCourierTags(tags: readonly TagCount[]): {
  liked: TagCount[];
  mentioned: TagCount[];
} {
  const good: readonly string[] = COURIER_TAGS.good;
  return {
    liked: tags.filter((tag) => good.includes(tag.tag)),
    mentioned: tags.filter((tag) => !good.includes(tag.tag)),
  };
}

function listWords(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

/** S4.1, S7.1: "Rate your Gimbap, Pad Thai and Luis's delivery. It takes ten seconds." */
export function reminderBody(
  dishTitles: readonly string[],
  courierFirstName: string | null,
): string {
  const dishes = dishTitles.length >= 4 ? [`${dishTitles.length} dishes`] : [...dishTitles];
  const parts = courierFirstName ? [...dishes, `${courierFirstName}'s delivery`] : dishes;
  return `Rate your ${listWords(parts)}. It takes ten seconds.`;
}

/** The staff list's cursor: newest first by time, then id. */
export function encodeCursor(at: Date, id: string): string {
  return `${at.toISOString()}|${id}`;
}

export function decodeCursor(cursor: string | null): { at: Date; id: string } | null {
  if (!cursor) return null;
  const [at, id] = cursor.split('|');
  const time = Date.parse(at ?? '');
  if (!id || Number.isNaN(time) || !/^[0-9a-f-]{36}$/.test(id)) return null;
  return { at: new Date(time), id };
}
