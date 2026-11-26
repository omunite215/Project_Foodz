import { z } from 'zod';
import type { VehicleType } from '@/server/db/enums';
import type { PartnerDelivery } from '@/server/modules/delivery/schema';
import { stepUpInput } from '@/server/modules/staff/schema';

/*
 * Live tracking, the courier's own steps and the delivery code (F8). Positions are the
 * server's accepted points; every time is the server's (acceptance time, the database clock for
 * cut-offs). Inputs are strict; the session decides who the partner, customer or staff member
 * is. Codes, coordinates, addresses and phones never reach logs.
 */

// ------------------------------------------------------------------ constants (U9, U11, U21, U24)

export const TRACKING_DEFAULTS = {
  /** L4.1: the estimate is refreshed this often while a delivery is active. */
  etaSeconds: 30,
  /** U6: "isn't answering" waits this long before staff may decide. */
  noAnswerSeconds: 5 * 60,
  /** L10.1: the demo courier rides at this speed (km/h). */
  demoSpeedKmh: 30,
  /** U16, L8.2. */
  retentionDays: 30,
} as const;
export type TrackingTimings = { -readonly [K in keyof typeof TRACKING_DEFAULTS]: number };

/** L5.1, U11: one freshness rule everywhere, from the server's acceptance time. */
export const FRESHNESS = {
  liveSeconds: 30,
  hollowSeconds: 45,
  staleSeconds: 120,
  redSeconds: 600,
} as const;

/** U9: publishing throttles and history spacing. */
export const CADENCE = {
  customerMs: 4_000,
  opsMapMs: 10_000,
  historyMs: 15_000,
} as const;

/** U21. */
export const GEOFENCE = {
  atKitchenM: 100,
  almostThereM: 200,
  almostThereSeconds: 120,
  confirmFarM: 300,
  /** L4.1: farther than this from the current route re-plans it. */
  offRouteM: 150,
} as const;

/** L4.2, U24. */
export const ROUTING = {
  timeoutMs: 3_000,
  straightLineKmh: 20,
  bicycleKmh: 15,
  bicycleFactor: 1.3,
  /** L4.4: an estimate that moved this much is pushed at once. */
  pushShiftSeconds: 5 * 60,
} as const;

/** P42.3, L6. */
export const CODE_TRIES = 5;
export const CODE_LENGTH = 4;
/** L10.2. */
export const DEMO_RUNS_PER_HOUR = 6;
export const STAFF_NOTE_MAX = 500;

// ------------------------------------------------------------------ enums

/** The courier's stage on his phone and on the customer's page. */
export const TRACKING_STAGES = ['toKitchen', 'atKitchen', 'delivering'] as const;
export type TrackingStage = (typeof TRACKING_STAGES)[number];

/** P43.1. */
export const PROBLEM_KINDS = ['no-answer', 'address', 'refused', 'cant-finish', 'other'] as const;
export type ProblemKind = (typeof PROBLEM_KINDS)[number];

/** A50.1. */
export const CONFIRM_REASONS = [
  'customer-confirmed',
  'left-as-asked',
  'code-checked',
  'other',
] as const;
export type ConfirmReason = (typeof CONFIRM_REASONS)[number];

/** A46.2 plus D29's two: a courier's state on the ops map. */
export const MAP_STATES = [
  'free',
  'offered',
  'toKitchen',
  'atKitchen',
  'delivering',
  'noAnswer',
  'problem',
  'locked',
] as const;
export type MapState = (typeof MAP_STATES)[number];

/** How fresh a courier's point is (L5.1). */
export type Freshness = 'live' | 'recent' | 'hollow' | 'stale' | 'red';

/** A49: what needs staff now. */
export const ATTENTION_KINDS = ['no-answer', 'locked', 'problem', 'no-location'] as const;
export type AttentionKind = (typeof ATTENTION_KINDS)[number];

/** What the partner's phone is told after staff act (design 2.9, 2.10; P44.3). */
export const PARTNER_NOTICES = [
  'askedToWait',
  'confirmed',
  'cancelledBringBack',
  'markedDelivered',
] as const;
export type PartnerTrackingNotice = (typeof PARTNER_NOTICES)[number];

// ------------------------------------------------------------------ partner REST bodies (B3)

const point = z
  .object({
    lat: z.number().finite().min(-90).max(90),
    lng: z.number().finite().min(-180).max(180),
  })
  .strict();

/** `POST /api/v1/partner/deliveries/{id}/picked-up` (P38): `confirmFar` after the 300 m ask. */
export const pickedUpInput = z.object({ confirmFar: z.boolean().optional() }).strict();

/**
 * `POST /api/v1/partner/deliveries/{id}/hand-over` (P41, P42). The digits never reach a log;
 * the server hashes them and the database compares the hashes.
 */
export const handOverInput = z
  .object({
    code: z.string().regex(/^\d{4}$/, 'Enter the 4 digits.'),
    cashCollected: z.boolean().optional(),
    confirmFar: z.boolean().optional(),
  })
  .strict();
export type HandOverInput = z.input<typeof handOverInput>;

/** `POST /api/v1/partner/deliveries/{id}/problem` (P43). */
export const problemInput = z.object({ kind: z.enum(PROBLEM_KINDS) }).strict();

/** `POST /api/v1/partner/deliveries/{id}/no-answer-report` (P43.3). */
export const noAnswerReportInput = z.object({}).strict();

/** `point` is accepted only where a check needs it in a test; the phone's points go via F6. */
export const trackingPoint = point;

// ------------------------------------------------------------------ staff inputs (B4)

const orderId = z.uuid();
const expectedVersion = z.int().min(0).max(2_147_483_647);
const CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]+/g; // oxlint-disable-line no-control-regex
const note = z
  .string()
  .max(STAFF_NOTE_MAX * 4)
  .transform((raw) => raw.replace(/\r\n?/g, '\n').replace(CONTROL, ' ').trim())
  .pipe(z.string().max(STAFF_NOTE_MAX, 'Keep the note under 500 characters.'))
  .transform((value) => value || undefined)
  .optional();

/** A50.1: SUPPORT and ADMIN, after a lock or 5 minutes of "isn't answering". */
export const confirmHandoverInput = z
  .object({
    orderId,
    expectedVersion,
    reason: z.enum(CONFIRM_REASONS, { error: 'Choose a reason.' }),
    note,
    cashCollected: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.reason === 'other' && !value.note) {
      ctx.addIssue({ code: 'custom', path: ['note'], message: 'Add a note about what happened.' });
    }
  });
export type ConfirmHandoverInput = z.input<typeof confirmHandoverInput>;

/** A50.1: restarts the 5-minute clock and tells the courier. */
export const askToWaitInput = z.object({ orderId, expectedVersion }).strict();

/**
 * A50.1, U6: F5's staff cancellation with the reason "Customer couldn't be reached"; F5's
 * refund and step-up rules apply.
 */
export const cancelUnreachableInput = z
  .object({
    orderId,
    expectedVersion,
    note,
    /** F5's step-up code (authenticator or backup), for a card refund. */
    stepUp: stepUpInput.optional(),
  })
  .strict();

/** A54.1: the demo admin starts the pretend delivery. */
export const startDemoDeliveryInput = z.object({}).strict();

// ------------------------------------------------------------------ DTOs

export interface CourierPoint {
  lat: number;
  lng: number;
  heading: number | null;
  /** The server's acceptance time. */
  at: string;
}

export interface TrackingRoute {
  geojson: { type: 'LineString'; coordinates: [number, number][] } | null;
  distanceM: number;
  durationSec: number;
  etaAt: string;
  /** True for the straight-line fallback (L4.2, S2.4). */
  estimated: boolean;
}

/** B7: `OrderProgress.tracking`, for the order's customer only, from pickup to delivery. */
export interface CustomerTracking {
  stage: TrackingStage;
  courierPoint: CourierPoint | null;
  route: TrackingRoute | null;
  /** Her door, as she gave it. */
  dropoffPoint: { lat: number; lng: number };
  almost: boolean;
  atDoor: boolean;
  /** The four digits, her view only (U4), from pickup until delivery. */
  code: string | null;
}

/** P38, P41: the hand-over answer; the same for a repeat (L7.1). */
export type HandOverResult =
  /** F9 P51.3: `today` is read in the hand-over's own transaction, so it includes this one. */
  | {
      outcome: 'delivered';
      payWords: string;
      today?: { earnedCents: number; deliveries: number } | null;
    }
  | { outcome: 'wrong'; triesLeft: number }
  | { outcome: 'locked' };

export interface PickedUpResult {
  deliveryId: string;
  version: number;
  replayed: boolean;
}

/** B3: what F7's `PartnerDelivery` gains in F8. */
export interface PartnerDeliveryTracking {
  stage: TrackingStage;
  /** False while the kitchen moved the order back (P38.4). */
  orderReady: boolean;
  route: TrackingRoute | null;
  /** After pickup only (P39). */
  dropoff: {
    firstName: string;
    addressText: string;
    apt: string | null;
    instructions: string | null;
    point: { lat: number; lng: number };
    phone: string | null;
  } | null;
  noAnswer: {
    since: string;
    reportable: boolean;
    told: boolean;
    waitRestartedAt: string | null;
  } | null;
  problem: { kind: ProblemKind } | null;
  otp: { locked: boolean; triesLeft: number };
  notice: { kind: PartnerTrackingNotice; orderNumber: string; at: string } | null;
}
export type PartnerDeliveryF8 = Omit<PartnerDelivery, 'dropoff'> & PartnerDeliveryTracking;

/** A53: the detail's tracking data (SUPPORT, ADMIN; the demo admin sees demo orders only). */
export interface StaffTrackingDetail {
  steps: {
    assignedAt: string | null;
    atKitchenAt: string | null;
    pickedUpAt: string | null;
    deliveredAt: string | null;
    noAnswerSince: string | null;
    codeLockedAt: string | null;
    problem: ProblemKind | null;
  };
  point: { lat: number; lng: number; at: string | null; freshness: Freshness } | null;
  route: TrackingRoute | null;
  dropoffPoint: { lat: number; lng: number } | null;
  etaAt: string | null;
  estimated: boolean;
  /** A48.2: the estimate is more than 10 minutes past the promised window. */
  late: boolean;
}

/** A48.1: the Out-for-delivery courier line, resolved on the server. */
export interface DeliveryLine {
  /** A48.2: more than 10 minutes past the promised window; the card turns red. */
  late?: boolean;
  state: 'onTheWay' | 'almost' | 'noLocation' | 'noAnswer' | 'locked' | 'problem';
  words: string;
  tone: 'neutral' | 'positive' | 'amber' | 'red';
  icon: 'truck' | 'pin' | 'signal-off' | 'door' | 'lock' | 'alert';
  spoken: string;
}

/** A49: one stuck delivery, oldest first on the board. */
export interface AttentionItem {
  orderId: string;
  orderNumber: string;
  kind: AttentionKind;
  since: string;
  minutes: number;
  words: string;
}

export interface OpsMapCourier {
  partnerId: string;
  fullName: string;
  shortName: string;
  vehicle: VehicleType;
  vehicleWords: string;
  plate: string | null;
  state: MapState;
  words: string;
  orderId: string | null;
  orderNumber: string | null;
  point: { lat: number; lng: number } | null;
  heading: number | null;
  at: string | null;
  freshness: Freshness;
  phone: { e164: string; display: string } | null;
}

export interface OpsMapDelivery {
  orderId: string;
  number: string;
  courierShortName: string;
  stateWords: string;
  etaAt: string | null;
  lateMinutes: number | null;
  dropoffPoint: { lat: number; lng: number };
  customerFirstName: string;
  /** "Downtown", else "Boston 02109". */
  areaWords: string;
}

export interface DemoRunState {
  running: boolean;
  orderNumber: string | null;
  endsAt: string | null;
  runsLeft: number;
  nextAt: string | null;
}

/** L3.3, A46: the live map's snapshot for the viewer's pool. */
export interface OpsMapSnapshot {
  asOf: string;
  pool: 'REAL' | 'DEMO';
  couriers: OpsMapCourier[];
  deliveries: OpsMapDelivery[];
  readyWithoutCourier: { orderId: string; number: string; readyAt: string }[];
  demoRun: DemoRunState | null;
  /** A49 (design 3.9): the stuck deliveries, as on the board, oldest first. */
  attention?: AttentionItem[];
  /** Design 3.3: the kitchen's pin; null when the store has no location. */
  kitchen?: { lat: number; lng: number } | null;
}

/** `details` per new refusal code (server/errors.ts). */
export interface TrackingRefusalDetails {
  ORDER_NOT_READY: { orderNumber: string };
  CONFIRM_NOT_ALLOWED: { why: 'not-stuck' | 'not-picked-up' };
  DEMO_RUN_BUSY: { orderNumber: string; endsAt: string };
  DEMO_RUN_LIMIT: { nextAt: string };
}
