import type { VehicleType } from '@/server/db/enums';
import { isDeployedProduction } from '@/server/deployment';
import type {
  AttentionItem,
  AttentionKind,
  DeliveryLine,
  Freshness,
  MapState,
  ProblemKind,
  TrackingStage,
  TrackingTimings,
} from './schema';
import {
  CADENCE,
  CODE_LENGTH,
  CODE_TRIES,
  DEMO_RUNS_PER_HOUR,
  FRESHNESS,
  GEOFENCE,
  ROUTING,
  TRACKING_DEFAULTS,
} from './schema';

/*
 * Pure rules of tracking (F8 L1 to L13, A48 to A50, P38 to P46). Services pass in what they
 * read; nothing here touches storage, the network or a clock of its own.
 */

type Env = Record<string, string | undefined>;

// ------------------------------------------------------------------ test timings (L13.1)

const OVERRIDES: Record<keyof TrackingTimings, string> = {
  etaSeconds: 'TRACKING_ETA_SECONDS',
  noAnswerSeconds: 'TRACKING_NO_ANSWER_SECONDS',
  demoSpeedKmh: 'DEMO_RUN_SPEED',
  retentionDays: 'LOCATION_RETENTION_DAYS',
};
const KEYS = ['etaSeconds', 'noAnswerSeconds', 'demoSpeedKmh', 'retentionDays'] as const;
const isOn = (value: string | undefined) => value === '1' || value === 'true';

/**
 * The story's values, or test overrides under F7's test-only flag (`FOODZ_TEST_TIMING=1`), never
 * on a production deployment. The demo speed may go up to 20 times faster; the others shorter.
 */
export function trackingTimings(env: Env): TrackingTimings {
  const timings: TrackingTimings = { ...TRACKING_DEFAULTS };
  if (!isOn(env.FOODZ_TEST_TIMING) || isDeployedProduction(env)) return timings;
  for (const key of KEYS) {
    const value = Number(env[OVERRIDES[key]]);
    const ceiling = key === 'demoSpeedKmh' ? TRACKING_DEFAULTS[key] * 20 : TRACKING_DEFAULTS[key];
    if (Number.isInteger(value) && value > 0 && value <= ceiling) timings[key] = value;
  }
  return timings;
}

// ------------------------------------------------------------------ freshness and cadence (L5, U9)

/** L5.1: one rule everywhere, from the server's acceptance time. */
export function freshnessOf(at: string | null, now: Date): Freshness {
  if (!at) return 'red';
  const seconds = (now.getTime() - Date.parse(at)) / 1000;
  if (seconds < FRESHNESS.liveSeconds) return 'live';
  if (seconds < FRESHNESS.hollowSeconds) return 'recent';
  if (seconds < FRESHNESS.staleSeconds) return 'hollow';
  if (seconds < FRESHNESS.redSeconds) return 'stale';
  return 'red';
}

/** L2.1: coordinates leave the server rounded to 5 decimals (about 1 m). */
export const roundCoordinate = (value: number) => Math.round(value * 1e5) / 1e5;

/** Whether a history row is due (one per 15 s at most, L8.1). */
export const historyDue = (lastAt: string | null, now: Date) =>
  !lastAt || now.getTime() - Date.parse(lastAt) >= CADENCE.historyMs;

// ------------------------------------------------------------------ distances and the estimate (L4)

const EARTH_M = 6_371_008.8;
const rad = (degrees: number) => (degrees * Math.PI) / 180;

export interface Point {
  lat: number;
  lng: number;
}

export function distanceM(a: Point, b: Point): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** U24: a bicycle takes the driving route's time × 1.3. */
export const vehicleSeconds = (seconds: number, vehicle: VehicleType) =>
  Math.round(vehicle === 'BICYCLE' ? seconds * ROUTING.bicycleFactor : seconds);

/** L4.2: the straight line at 20 km/h (15 for a bicycle), flagged as estimated. */
export function straightLineEstimate(from: Point, to: Point, vehicle: VehicleType, now: Date) {
  const meters = Math.round(distanceM(from, to));
  const kmh = vehicle === 'BICYCLE' ? ROUTING.bicycleKmh : ROUTING.straightLineKmh;
  const durationSec = Math.round((meters / 1000 / kmh) * 3600);
  return {
    distanceM: meters,
    durationSec,
    etaAt: new Date(now.getTime() + durationSec * 1000).toISOString(),
    estimated: true as const,
  };
}

/** Meters from a point to a route (lng, lat pairs), on a local flat projection. */
export function distanceToRouteM(at: Point, coordinates: readonly [number, number][]): number {
  if (coordinates.length === 0) return Number.POSITIVE_INFINITY;
  const kx = Math.cos(rad(at.lat)) * (Math.PI / 180) * EARTH_M;
  const ky = (Math.PI / 180) * EARTH_M;
  const project = ([lng, lat]: [number, number]) => [(lng - at.lng) * kx, (lat - at.lat) * ky];
  let best = Number.POSITIVE_INFINITY;
  for (let index = 0; index < coordinates.length; index += 1) {
    const [ax = 0, ay = 0] = project(coordinates[index] ?? [at.lng, at.lat]);
    const [bx = ax, by = ay] = coordinates[index + 1] ? project(coordinates[index + 1]!) : [ax, ay];
    const dx = bx - ax;
    const dy = by - ay;
    const length = dx * dx + dy * dy;
    const t = length === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length));
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

/** L4.1: more than 150 m from the current route re-plans it. */
export const offRoute = (at: Point, coordinates: readonly [number, number][] | null) =>
  coordinates !== null && distanceToRouteM(at, coordinates) > GEOFENCE.offRouteM;

/** L4.4: a shift of 5 minutes or more is pushed at once; smaller ones ride the next refresh. */
export const etaShiftWorthPushing = (before: string | null, after: string) =>
  before === null ||
  Math.abs(Date.parse(after) - Date.parse(before)) >= ROUTING.pushShiftSeconds * 1000;

// ------------------------------------------------------------------ stages and geofences (U7, U21)

export function stageOf(status: string): TrackingStage | null {
  switch (status) {
    case 'ASSIGNED':
      return 'toKitchen';
    case 'AT_RESTAURANT':
      return 'atKitchen';
    case 'PICKED_UP':
      return 'delivering';
    default:
      return null;
  }
}

export const atKitchen = (distanceToKitchenM: number) => distanceToKitchenM <= GEOFENCE.atKitchenM;

/** U21: "almost there" within 200 m or 2 minutes of the door. */
export const almostThere = (distanceToDoorM: number, durationSec: number | null) =>
  distanceToDoorM <= GEOFENCE.almostThereM ||
  (durationSec !== null && durationSec <= GEOFENCE.almostThereSeconds);

/** U8, P38.3, P41.4: farther than 300 m asks first; it never blocks. */
export const needsFarConfirm = (distance: number | null) =>
  distance !== null && distance > GEOFENCE.confirmFarM;

// ------------------------------------------------------------------ the delivery code (L6, P42)

/** L6.1: never 0000 or another repeated digit, never a run up or down (1234, 9876). */
export function codeAllowed(code: string): boolean {
  if (!new RegExp(`^\\d{${CODE_LENGTH}}$`).test(code)) return false;
  const digits = code.split('').map(Number);
  const steps = digits.slice(1).map((digit, index) => digit - (digits[index] ?? 0));
  return (
    !steps.every((step) => step === 0) &&
    !steps.every((step) => step === 1) &&
    !steps.every((step) => step === -1)
  );
}

/** Draws until allowed; `randomInt` is `crypto.randomInt` in the service. */
export function drawCode(randomInt: (max: number) => number): string {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const code = String(randomInt(10 ** CODE_LENGTH)).padStart(CODE_LENGTH, '0');
    if (codeAllowed(code)) return code;
  }
  throw new Error('could not draw a delivery code');
}

export const triesLeft = (wrongTries: number) => Math.max(0, CODE_TRIES - wrongTries);

// ------------------------------------------------------------------ nobody at the door (P43, A50)

export function noAnswerClock(
  since: string | null,
  now: Date,
  noAnswerSeconds: number = TRACKING_DEFAULTS.noAnswerSeconds,
): { waiting: boolean; secondsLeft: number; reportable: boolean } {
  if (!since) return { waiting: false, secondsLeft: 0, reportable: false };
  const left = Math.max(0, noAnswerSeconds - (now.getTime() - Date.parse(since)) / 1000);
  return { waiting: true, secondsLeft: Math.ceil(left), reportable: left === 0 };
}

/** A50.3: SUPPORT confirms a hand-over only after a lock or 5 minutes of "isn't answering". */
export const supportMayConfirm = (facts: {
  locked: boolean;
  noAnswerSince: string | null;
  now: Date;
  noAnswerSeconds?: number;
}) =>
  facts.locked || noAnswerClock(facts.noAnswerSince, facts.now, facts.noAnswerSeconds).reportable;

// ------------------------------------------------------------------ the board and the map (A46, A48, A49)

export interface DeliveryFacts {
  orderId: string;
  orderNumber: string;
  status: string;
  lastPointAt: string | null;
  distanceToDoorM: number | null;
  durationSec: number | null;
  noAnswerSince: string | null;
  lockedAt: string | null;
  problem: { kind: ProblemKind; at: string } | null;
}

/** A48.1's state and tone for an Out-for-delivery card (words in text.ts). */
export function deliveryLineState(
  facts: DeliveryFacts,
  now: Date,
  noAnswerSeconds: number = TRACKING_DEFAULTS.noAnswerSeconds,
): Pick<DeliveryLine, 'state' | 'tone'> {
  if (facts.lockedAt) return { state: 'locked', tone: 'red' };
  if (facts.noAnswerSince) {
    const { reportable } = noAnswerClock(facts.noAnswerSince, now, noAnswerSeconds);
    return { state: 'noAnswer', tone: reportable ? 'red' : 'amber' };
  }
  if (facts.problem) return { state: 'problem', tone: 'amber' };
  const freshness = freshnessOf(facts.lastPointAt, now);
  if (freshness === 'red') return { state: 'noLocation', tone: 'red' };
  if (freshness === 'stale') return { state: 'noLocation', tone: 'amber' };
  if (facts.distanceToDoorM !== null && almostThere(facts.distanceToDoorM, facts.durationSec)) {
    return { state: 'almost', tone: 'positive' };
  }
  return { state: 'onTheWay', tone: 'neutral' };
}

/** A49: what needs staff, oldest first (a lock, no answer, a problem, 10 minutes silent). */
export function attentionOf(
  deliveries: readonly DeliveryFacts[],
  now: Date,
): Omit<AttentionItem, 'words'>[] {
  const items = deliveries.flatMap((facts): Omit<AttentionItem, 'words'>[] => {
    const item = (kind: AttentionKind, since: string) => ({
      orderId: facts.orderId,
      orderNumber: facts.orderNumber,
      kind,
      since,
      minutes: Math.max(0, Math.floor((now.getTime() - Date.parse(since)) / 60_000)),
    });
    if (facts.lockedAt) return [item('locked', facts.lockedAt)];
    if (facts.noAnswerSince) return [item('no-answer', facts.noAnswerSince)];
    if (facts.problem) return [item('problem', facts.problem.at)];
    if (freshnessOf(facts.lastPointAt, now) === 'red' && facts.lastPointAt) {
      return [item('no-location', new Date(Date.parse(facts.lastPointAt) + 0).toISOString())];
    }
    return [];
  });
  return items.toSorted((a, b) => Date.parse(a.since) - Date.parse(b.since));
}

/** A46.2 and D29: a courier's state on the live map. */
export function mapStateOf(facts: {
  deliveryStatus: string | null;
  hasOpenOffer: boolean;
  noAnswerSince: string | null;
  locked: boolean;
  problem: boolean;
}): MapState {
  if (facts.locked) return 'locked';
  if (facts.noAnswerSince) return 'noAnswer';
  if (facts.problem) return 'problem';
  const stage = facts.deliveryStatus ? stageOf(facts.deliveryStatus) : null;
  if (stage)
    return stage === 'toKitchen' ? 'toKitchen' : stage === 'atKitchen' ? 'atKitchen' : 'delivering';
  return facts.hasOpenOffer ? 'offered' : 'free';
}

// ------------------------------------------------------------------ the demo run (L10.2)

export function demoRunVerdict(facts: {
  running: { endsAt: string } | null;
  startsInLastHour: readonly string[];
  now: Date;
}):
  | { ok: true }
  | { ok: false; why: 'busy'; endsAt: string }
  | { ok: false; why: 'limit'; nextAt: string } {
  if (facts.running) return { ok: false, why: 'busy', endsAt: facts.running.endsAt };
  const hourAgo = facts.now.getTime() - 3_600_000;
  const recent = facts.startsInLastHour
    .map((at) => Date.parse(at))
    .filter((at) => at > hourAgo)
    .toSorted((a, b) => a - b);
  if (recent.length < DEMO_RUNS_PER_HOUR) return { ok: true };
  const oldest = recent[recent.length - DEMO_RUNS_PER_HOUR] ?? facts.now.getTime();
  return { ok: false, why: 'limit', nextAt: new Date(oldest + 3_600_000).toISOString() };
}
