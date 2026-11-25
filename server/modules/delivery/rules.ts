import type { DeliveryStatus } from '@/server/db/enums';
import { isDeployedProduction } from '@/server/deployment';
import type {
  CourierState,
  CustomerDispatchView,
  DeliveryPool,
  DispatchTimings,
  OfferEnding,
  OfferKind,
} from './schema';
import {
  DISPATCH_DEFAULTS,
  MISS_LIMIT,
  MISS_WARNING_AT,
  OFFERS_PER_EARLY_REACH,
  REACHES_KM,
  UNSEEN_PAUSE_AT,
} from './schema';

/*
 * Pure rules of dispatch (F7 W2 to W7, P25, U12, B13). The workflow and the services pass in
 * what they read from the database; nothing here touches storage or a clock of its own.
 */

// ------------------------------------------------------------------ timings (B13)

const OVERRIDES: Record<keyof DispatchTimings, string> = {
  startDelaySeconds: 'DISPATCH_START_DELAY_SECONDS',
  offerSeconds: 'DISPATCH_OFFER_SECONDS',
  staffOfferSeconds: 'DISPATCH_STAFF_OFFER_SECONDS',
  graceSeconds: 'DISPATCH_GRACE_SECONDS',
  escalateSeconds: 'DISPATCH_ESCALATE_SECONDS',
  sweepSeconds: 'DISPATCH_SWEEP_SECONDS',
  stopMinutes: 'DISPATCH_STOP_MINUTES',
  freshPointSeconds: 'DISPATCH_FRESH_POINT_SECONDS',
};

const TIMING_KEYS = [
  'startDelaySeconds',
  'offerSeconds',
  'staffOfferSeconds',
  'graceSeconds',
  'escalateSeconds',
  'sweepSeconds',
  'stopMinutes',
  'freshPointSeconds',
] as const satisfies readonly (keyof DispatchTimings)[];

type Env = Record<string, string | undefined>;
const isOn = (value: string | undefined) => value === '1' || value === 'true';

/**
 * W14.1: test timings need the explicit test-only flag `FOODZ_TEST_TIMING=1`, which a production
 * deployment (Vercel or AWS) refuses at boot, the same rule as `CLIENT_IP_FROM_HEADER`.
 */
export function dispatchOverridesRefused(env: Env): boolean {
  return isOn(env.FOODZ_TEST_TIMING) && isDeployedProduction(env);
}

const testTimingOn = (env: Env) => isOn(env.FOODZ_TEST_TIMING) && !dispatchOverridesRefused(env);

/** The startup warning, like CLIENT_IP_FROM_HEADER's: test timing on, or overrides ignored. */
export function dispatchTimingWarning(env: Env): string | null {
  if (testTimingOn(env)) {
    return 'FOODZ_TEST_TIMING is on: DISPATCH_* overrides shorten offers and searches. Use it for tests only.';
  }
  return Object.values(OVERRIDES).some((name) => Boolean(env[name]))
    ? 'DISPATCH_* timing overrides are ignored without FOODZ_TEST_TIMING=1.'
    : null;
}

/** The timings in force: the story's values, or positive whole-number test overrides. */
export function dispatchTimings(env: Env): DispatchTimings {
  const timings: DispatchTimings = { ...DISPATCH_DEFAULTS };
  if (!testTimingOn(env)) return timings;
  for (const key of TIMING_KEYS) {
    const value = Number(env[OVERRIDES[key]]);
    if (Number.isInteger(value) && value > 0 && value <= DISPATCH_DEFAULTS[key] * 4) {
      timings[key] = value;
    }
  }
  return timings;
}

// ------------------------------------------------------------------ pay (U12)

/**
 * The delivery fee before any discount plus the whole tip, frozen when an offer is made. A
 * free-delivery code never cuts the courier's pay.
 */
export const offerPay = (order: { deliveryFeeCents: number; tipCents: number }) => ({
  payCents: order.deliveryFeeCents + order.tipCents,
  tipCents: order.tipCents,
});

// ------------------------------------------------------------------ who may be offered (W2)

export interface CandidateFacts {
  status: 'APPLIED' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';
  banned: boolean;
  isOnline: boolean;
  /** When the server last accepted a point from this partner (`last_point_at`). */
  lastPointAt: string | null;
  /** Straight line from that point to the kitchen. */
  distanceM: number | null;
  hasActiveDelivery: boolean;
  hasOpenOffer: boolean;
  /** Declined this order, gave it back or was taken off it. */
  excluded: boolean;
  /** Already offered this order by the automatic rounds, and how that ended. */
  previousAutoEnding: OfferEnding | null;
  /** How many automatic offers this order has already made him. */
  autoOffers: number;
  /** W5.4: the sweep allows one more offer after a timeout, once everyone else has had a turn. */
  secondChance: boolean;
  isDemo: boolean;
  unseenInRow: number;
}

export type NotOfferable =
  | 'not-approved'
  | 'offline'
  | 'stale'
  | 'out-of-reach'
  | 'busy'
  | 'has-offer'
  | 'excluded'
  | 'already-offered'
  | 'other-pool'
  | 'paused';

/**
 * W2.1's ten conditions, in order; the first that fails is the reason. The database query
 * applies the same conditions (B3); this is the one place their meaning is written down and
 * unit-tested, and the assign dialog's disabled reasons come from it.
 */
export function notOfferable(
  partner: CandidateFacts,
  context: {
    pool: DeliveryPool;
    reachM: number;
    radiusM: number;
    now: Date;
    freshPointSeconds: number;
  },
): NotOfferable | null {
  if (partner.status !== 'APPROVED' || partner.banned) return 'not-approved';
  if (!partner.isOnline) return 'offline';
  if (
    !partner.lastPointAt ||
    context.now.getTime() - Date.parse(partner.lastPointAt) > context.freshPointSeconds * 1000
  ) {
    return 'stale';
  }
  if (partner.distanceM === null || partner.distanceM > Math.min(context.reachM, context.radiusM)) {
    return 'out-of-reach';
  }
  if (partner.hasActiveDelivery) return 'busy';
  if (partner.hasOpenOffer) return 'has-offer';
  if (partner.excluded) return 'excluded';
  if (
    partner.autoOffers > 1 ||
    (partner.previousAutoEnding !== null &&
      !(partner.secondChance && partner.previousAutoEnding === 'expired'))
  ) {
    return 'already-offered';
  }
  if ((context.pool === 'DEMO') !== partner.isDemo) return 'other-pool';
  if (partner.unseenInRow >= UNSEEN_PAUSE_AT) return 'paused';
  return null;
}

// ------------------------------------------------------------------ ranking (W3)

export interface RankedCandidate {
  partnerId: string;
  waitingSince: string;
  distanceM: number;
}

/** Whoever has waited longest first; then the nearer; then by id, so the order never varies. */
export function compareCandidates(a: RankedCandidate, b: RankedCandidate): number {
  return (
    Date.parse(a.waitingSince) - Date.parse(b.waitingSince) ||
    a.distanceM - b.distanceM ||
    a.partnerId.localeCompare(b.partnerId)
  );
}

/**
 * W3.3: "waiting since" after an event. Going online or ending an assignment by delivering,
 * giving back or being taken off starts it again; a cancellation or a hand-over another way
 * gives back the place held before accepting; declines and misses change nothing.
 */
export function waitingSinceAfter(
  event:
    | 'online'
    | 'delivered'
    | 'gave-back'
    | 'taken-off'
    | 'cancelled'
    | 'handed-over'
    | 'declined'
    | 'missed',
  facts: { current: string; beforeAssignment: string | null; now: Date },
): string {
  switch (event) {
    case 'online':
    case 'delivered':
    case 'gave-back':
    case 'taken-off':
      return facts.now.toISOString();
    case 'cancelled':
    case 'handed-over':
      return facts.beforeAssignment ?? facts.current;
    default:
      return facts.current;
  }
}

/**
 * W9.2: when several orders search at once, the one ready longest gets first pick. Given each
 * searching order's ranked candidates (oldest order first), returns the partner `target` may
 * be offered: the best one not already the pick of an older order.
 */
export function allocateOldestFirst(
  target: string,
  orders: readonly { deliveryId: string; candidates: readonly string[] }[],
): string | null {
  const taken = new Set<string>();
  for (const order of orders) {
    const pick = order.candidates.find((partnerId) => !taken.has(partnerId)) ?? null;
    if (order.deliveryId === target) return pick;
    if (pick) taken.add(pick);
  }
  return null;
}

// ------------------------------------------------------------------ rounds and reach (W4)

/**
 * Which reaches to try next, nearest first (W4.3): reaches 1 and 2 until each has made 3
 * offers in this search, then reach 3 for everyone left. A reach with nobody new is skipped by
 * the caller, which tries the next index in the list.
 */
export function reachesToTry(offersByReach: readonly number[]): number[] {
  return REACHES_KM.map((_, index) => index).filter(
    (index) =>
      index === REACHES_KM.length - 1 || (offersByReach[index] ?? 0) < OFFERS_PER_EARLY_REACH,
  );
}

export const reachMeters = (index: number, radiusKm: number) =>
  Math.min(REACHES_KM[index] ?? REACHES_KM[REACHES_KM.length - 1]!, radiusKm) * 1000;

// ------------------------------------------------------------------ escalate, keep going, stop (W5)

export type SearchStep = 'stop' | 'escalate' | 'continue';

/**
 * W5.1, W5.2, W5.5: stop 60 minutes after ready; escalate 5 minutes after the search started,
 * when nobody is left to ask, or at once when nobody of the pool is online; otherwise go on.
 */
export function searchStep(
  facts: {
    readyAt: string;
    searchStartedAt: string;
    escalatedAt: string | null;
    anyoneOnline: boolean;
    anyoneLeft: boolean;
  },
  now: Date,
  timings: Pick<DispatchTimings, 'escalateSeconds' | 'stopMinutes'> = DISPATCH_DEFAULTS,
): SearchStep {
  if (now.getTime() - Date.parse(facts.readyAt) >= timings.stopMinutes * 60_000) return 'stop';
  if (facts.escalatedAt) return 'continue';
  if (!facts.anyoneOnline || !facts.anyoneLeft) return 'escalate';
  return now.getTime() - Date.parse(facts.searchStartedAt) >= timings.escalateSeconds * 1000
    ? 'escalate'
    : 'continue';
}

// ------------------------------------------------------------------ answers and misses (W6, P25, W7.4)

/** W6.1, P21.3: an answer counts until the end plus the grace. */
export const answerInTime = (
  expiresAt: string,
  now: Date,
  graceSeconds = DISPATCH_DEFAULTS.graceSeconds,
) => now.getTime() <= Date.parse(expiresAt) + graceSeconds * 1000;

/**
 * The partner's counters after an offer ends (P25.3, W7.4). Only an automatic offer the phone
 * showed and that timed out is a miss; one that never reached the phone counts toward the
 * pause instead. Any answer resets both. A practice offer never gets here.
 */
export function countersAfter(
  offer: { kind: OfferKind; seen: boolean; ending: OfferEnding; pressedBeforeEnd: boolean },
  counters: { missedInRow: number; unseenInRow: number },
): { missedInRow: number; unseenInRow: number; warn: boolean; takeOffline: boolean } {
  const answered = offer.ending === 'accepted' || offer.ending === 'declined';
  if (answered) return { missedInRow: 0, unseenInRow: 0, warn: false, takeOffline: false };
  const timedOut = offer.ending === 'expired' && offer.kind === 'auto' && !offer.pressedBeforeEnd;
  if (!timedOut) return { ...counters, warn: false, takeOffline: false };
  if (!offer.seen) {
    return {
      missedInRow: counters.missedInRow,
      unseenInRow: counters.unseenInRow + 1,
      warn: false,
      takeOffline: false,
    };
  }
  const missedInRow = counters.missedInRow + 1;
  return {
    missedInRow,
    unseenInRow: 0,
    warn: missedInRow === MISS_WARNING_AT,
    takeOffline: missedInRow >= MISS_LIMIT,
  };
}

// ------------------------------------------------------------------ what people see (A34.1, S1 to S4)

/** P30.6, A34.1: an assigned courier's line turns amber after this long without a point. */
export const STALE_ASSIGNED_MINUTES = 10;

export interface CourierLineInput {
  orderStatus: string;
  readyAt: string | null;
  delivery: {
    status: DeliveryStatus;
    searchStartedAt: string | null;
    escalatedAt: string | null;
    searchStoppedAt: string | null;
  } | null;
  openOfferKind: OfferKind | null;
  anyoneOnline: boolean;
  /** The holder's last point, for an assigned order. */
  lastPointAt: string | null;
}

const minutesSince = (iso: string | null, now: Date) =>
  iso === null ? Number.POSITIVE_INFINITY : (now.getTime() - Date.parse(iso)) / 60_000;

/**
 * A34.1's nine states for a Ready card, and the carrying courier on an Out-for-delivery card.
 * Null where there is no courier line. "Starting" covers the run's start delay after Mark ready.
 */
export function courierStateOf(
  facts: CourierLineInput,
  now: Date,
  startDelaySeconds: number = DISPATCH_DEFAULTS.startDelaySeconds,
): CourierState | null {
  const held = (): CourierState =>
    minutesSince(facts.lastPointAt, now) >= STALE_ASSIGNED_MINUTES ? 'assignedStale' : 'assigned';
  const delivery = facts.delivery;
  if (facts.orderStatus === 'PICKED_UP') return delivery?.status === 'PICKED_UP' ? held() : null;
  if (facts.orderStatus !== 'READY') return null;
  const justReady =
    facts.readyAt !== null &&
    now.getTime() - Date.parse(facts.readyAt) < (startDelaySeconds + 10) * 1000;
  if (!delivery || delivery.status === 'CANCELLED' || delivery.status === 'DELIVERED') {
    return justReady ? 'starting' : 'notLooking';
  }
  if (delivery.status !== 'SEARCHING') return held();
  if (delivery.searchStoppedAt) return 'notLooking';
  if (facts.openOfferKind === 'staff') return 'staffOffered';
  if (facts.openOfferKind === 'auto') return 'offered';
  if (delivery.escalatedAt) return facts.anyoneOnline ? 'escalated' : 'nobodyOnline';
  if (!delivery.searchStartedAt) return justReady ? 'starting' : 'notLooking';
  return 'between';
}

/**
 * The ending the offers list words (A36.2, design 2.4.1). An offer that expired although the
 * partner pressed Accept within its time (offline, reported after the end, P28.2) was answered
 * too late, not missed: the press time decides, not only the stored end reason.
 */
export function listedEnding(
  offer: {
    status: string;
    endedReason: OfferEnding | null;
    pressedAt: Date | null;
    expiresAt: Date;
  },
  graceSeconds: number = DISPATCH_DEFAULTS.graceSeconds,
): OfferEnding | 'open' {
  if (offer.status === 'PENDING') return 'open';
  const ending = offer.endedReason ?? 'expired';
  if (
    ending === 'expired' &&
    offer.pressedAt !== null &&
    offer.pressedAt.getTime() <= offer.expiresAt.getTime() + graceSeconds * 1000
  ) {
    return 'too-late';
  }
  return ending;
}

/** F7 S1 to S4: the customer's state; never who was asked or what staff did (S5.4). */
export function customerStateOf(facts: {
  orderStatus: string;
  delivery: {
    status: DeliveryStatus;
    escalatedAt: string | null;
    searchStoppedAt: string | null;
  } | null;
}): CustomerDispatchView['state'] {
  const status = facts.delivery?.status ?? null;
  switch (facts.orderStatus) {
    case 'READY':
      if (status === 'ASSIGNED' || status === 'AT_RESTAURANT') return 'assigned';
      return facts.delivery?.escalatedAt || facts.delivery?.searchStoppedAt ? 'slow' : 'searching';
    case 'PICKED_UP':
      return status === 'PICKED_UP' ? 'pickedUp' : 'none';
    case 'DELIVERED':
      return status === 'DELIVERED' ? 'delivered' : 'none';
    default:
      return 'none';
  }
}
