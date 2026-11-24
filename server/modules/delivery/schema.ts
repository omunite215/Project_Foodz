import { z } from 'zod';
import type { DeliveryStatus, VehicleType } from '@/server/db/enums';

/*
 * Dispatch and delivery offers (F7): who is offered a ready order and in what order, the offer
 * a partner answers, the pick-up screen, the staff courier line, offers list and actions, and
 * the courier the customer sees. Money is integer cents and frozen when an offer is made; every
 * cut-off comes from the database's clock. Inputs are strict; the session decides who the
 * partner is.
 */

// ------------------------------------------------------------------ timings (U1 to U6, U19)

/** The values the story quotes. Test runs may shorten them (B13); production refuses that. */
export const DISPATCH_DEFAULTS = {
  /** W1.1: F5's 10-second undo window plus 2 seconds. */
  startDelaySeconds: 12,
  /** W4.1, U3. */
  offerSeconds: 30,
  /** A37.2, U14: staff offers often follow a phone call. */
  staffOfferSeconds: 60,
  /** P21.3, W4.2: an answer this late still counts, and the next partner waits for it. */
  graceSeconds: 2,
  /** W5.1. */
  escalateSeconds: 5 * 60,
  /** W5.3: an escalated search sweeps this often (and on a partner becoming available). */
  sweepSeconds: 30,
  /** W5.5: counted from "Mark ready". */
  stopMinutes: 60,
  /** U19: "offerable" means a point accepted this recently. */
  freshPointSeconds: 45,
} as const;
export type DispatchTimings = { -readonly [K in keyof typeof DISPATCH_DEFAULTS]: number };

/** W3.2, U5: the reaches around the kitchen; the last one is the delivery radius. */
export const REACHES_KM = [2, 4, 8] as const;
/** W4.3: reaches 1 and 2 make at most this many offers before the reach grows. */
export const OFFERS_PER_EARLY_REACH = 3;
/** P25, U9: a warning at 2, offline at 3. */
export const MISS_WARNING_AT = 2;
export const MISS_LIMIT = 3;
/** W7.4: after this many offers in a row that never reached the phone, offers pause. */
export const UNSEEN_PAUSE_AT = 2;
/** B12: `last_location` and `last_point_at` are written at most this often while online. */
export const POSITION_WRITE_MS = 15_000;
/** A40.2, P20.1: "at the kitchen" within this distance. */
export const AT_KITCHEN_M = 100;
export const STAFF_NOTE_MAX = 500;

// ------------------------------------------------------------------ enums

export const OFFER_KINDS = ['auto', 'staff'] as const;
export type OfferKind = (typeof OFFER_KINDS)[number];

/** How an offer ended (B2), stored as `ended_reason`. */
export const OFFER_ENDINGS = [
  'accepted',
  'declined',
  'expired',
  'withdrawn-offline',
  'withdrawn-order',
  'withdrawn-staff',
  'taken',
  'too-late',
] as const;
export type OfferEnding = (typeof OFFER_ENDINGS)[number];

/** What `offer.ended` tells the phone (design "[BE] needs"). */
export type OfferEndedWhy = Exclude<OfferEnding, 'accepted' | 'too-late'>;

/** OFFER_GONE's `why` (B6). */
export const OFFER_GONE_WHY = ['expired', 'withdrawn', 'taken', 'order-changed'] as const;
export type OfferGoneWhy = (typeof OFFER_GONE_WHY)[number];

/** Why a search stopped (W5.5, W8.1). */
export type SearchStopReason = 'timeout' | 'order-changed';

/** P30.1. */
export const GIVE_BACK_REASONS = ['vehicle', 'emergency', 'too-far', 'other'] as const;
export type GiveBackReason = (typeof GIVE_BACK_REASONS)[number];

/** A38.1. */
export const TAKE_OFF_REASONS = ['courier-asked', 'not-responding', 'too-far', 'other'] as const;
export type TakeOffReason = (typeof TAKE_OFF_REASONS)[number];

/** W12: demo accounts' orders go only to demo partners, everyone else's only to real ones. */
export type DeliveryPool = 'REAL' | 'DEMO';

/** The courier-line state on a Ready card (A34.1), resolved by the server. */
export const COURIER_STATES = [
  'starting',
  'offered',
  'between',
  'staffOffered',
  'assigned',
  'assignedStale',
  'escalated',
  'nobodyOnline',
  'notLooking',
] as const;
export type CourierState = (typeof COURIER_STATES)[number];
export type CourierTone = 'neutral' | 'positive' | 'amber' | 'red';

// ------------------------------------------------------------------ partner REST bodies

export const DISPATCH_FIELD_ERRORS = {
  reason: 'Choose a reason.',
  note: 'Add a note about what happened.',
  noteLength: 'Keep the note under 500 characters.',
} as const;

const offerId = z.uuid();

/** `POST /api/v1/partner/offers/{id}/seen` (W7.4): the card is on screen. */
export const offerSeenInput = z.object({}).strict();

/** `POST /api/v1/partner/offers/{id}/accept` (P22). Idempotent per offer (W6.4). */
export const offerAcceptInput = z.object({}).strict();

/**
 * `POST /api/v1/partner/offers/{id}/decline` (P23). `pressedAt` is when the phone took the
 * press while offline (P28.4); the server records it but never lets it change the outcome.
 */
export const offerDeclineInput = z
  .object({ pressedAt: z.iso.datetime({ offset: true }).optional() })
  .strict();

/**
 * P28.2: the app pressed Accept before the end but couldn't reach the server in time. It is
 * recorded so the expired offer isn't counted as a miss; it never assigns anything.
 */
export const offerLateAcceptInput = z
  .object({ pressedAt: z.iso.datetime({ offset: true }) })
  .strict();

/** `POST /api/v1/partner/deliveries/{id}/give-back` (P30). */
export const giveBackInput = z
  .object({ reason: z.enum(GIVE_BACK_REASONS, { error: DISPATCH_FIELD_ERRORS.reason }) })
  .strict();
export type GiveBackInput = z.input<typeof giveBackInput>;

/** `POST /api/v1/partner/practice-offers` (P34): the demo partner, one session. */
export const practiceOfferInput = z.object({}).strict();

export const offerIdParam = z.object({ offerId }).strict();
export const deliveryIdParam = z.object({ deliveryId: z.uuid() }).strict();

// ------------------------------------------------------------------ staff inputs

const orderId = z.uuid();
/** The delivery `version` the person saw (A42.1). */
const expectedVersion = z.int().min(0).max(2_147_483_647);

const CONTROL_EXCEPT_NEWLINE = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]+/g; // oxlint-disable-line no-control-regex
const cleanNote = (raw: string) =>
  raw.replace(/\r\n?/g, '\n').replace(CONTROL_EXCEPT_NEWLINE, ' ').trim();

const staffNote = z
  .string()
  .max(STAFF_NOTE_MAX * 4, DISPATCH_FIELD_ERRORS.noteLength)
  .transform(cleanNote)
  .pipe(z.string().max(STAFF_NOTE_MAX, DISPATCH_FIELD_ERRORS.noteLength))
  .transform((value) => value || undefined)
  .optional();

/** The assign dialog's list (A37.2), fetched when it opens and on "Refresh list". */
export const assignableCouriersInput = z.object({ orderId }).strict();

/** A37.3: a 60-second "Foodz support picked you" offer to one online partner. */
export const sendStaffOfferInput = z
  .object({ orderId, partnerId: z.uuid(), expectedVersion })
  .strict();
export type SendStaffOfferInput = z.input<typeof sendStaffOfferInput>;

/** A38.1: take an assigned order off its courier before pickup. `other` needs a note. */
export const takeOffCourierInput = z
  .object({
    orderId,
    expectedVersion,
    reason: z.enum(TAKE_OFF_REASONS, { error: DISPATCH_FIELD_ERRORS.reason }),
    note: staffNote,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.reason === 'other' && !value.note) {
      ctx.addIssue({ code: 'custom', path: ['note'], message: DISPATCH_FIELD_ERRORS.note });
    }
  });
export type TakeOffCourierInput = z.input<typeof takeOffCourierInput>;

/** A39.4: "Find a courier" restarts a stopped search at once. */
export const restartSearchInput = z.object({ orderId, expectedVersion }).strict();
export type RestartSearchInput = z.input<typeof restartSearchInput>;

/** The customer's courier photo (B11): a fresh 5-minute link for their own order. */
export const courierPhotoInput = z.object({ orderId }).strict();

// ------------------------------------------------------------------ partner DTOs

/** `offer.created` gives only the id and end (P33.3); the card fetches this (design). */
export interface OfferDetail {
  offerId: string;
  kind: OfferKind | 'practice';
  /** Database clock; the phone counts down with F5's server offset (P21.1). */
  expiresAt: string;
  totalSeconds: number;
  /** "$7.64". */
  payText: string;
  payCents: number;
  /** "includes $5.00 tip", or null. */
  tipText: string | null;
  /** "Foodz Kitchen · 0.2 km from you" / "Foodz Kitchen · you're at the kitchen". */
  pickupText: string;
  /** "Boston 02109 · 1.3 km from the kitchen". */
  dropoffText: string;
  /** "3 items". */
  itemsText: string;
  payment: { kind: 'cash' | 'card'; text: string };
  /** "New order", "Foodz support picked you for this order.", "Practice offer". */
  heading: string;
  /** For the screen reader's description (P35.3). */
  summary: string;
  seen: boolean;
}

/** `GET /api/v1/partner/offers/current` (P28.6): the open offer, if any. */
export type CurrentOffer = { offer: OfferDetail | null; serverTime: string };

/** The accept answer (P22.4), the same for a repeat (P22.5). */
export interface AcceptResult {
  deliveryId: string;
  orderNumber: string;
  replayed: boolean;
}

/** P31: what happened to an order he held, when he missed the event. */
export type DeliveryNotice = 'takenOff' | 'cancelled' | 'handedOver' | 'movedBack';

/** `GET /api/v1/partner/deliveries/current` (P29), only while he holds the order. */
export interface PartnerDelivery {
  deliveryId: string;
  status: Extract<DeliveryStatus, 'ASSIGNED' | 'AT_RESTAURANT' | 'PICKED_UP'>;
  version: number;
  orderNumber: string;
  payText: string;
  tipText: string | null;
  payment: { kind: 'cash' | 'card'; text: string };
  itemsText: string;
  /** "Then: Boston 02109 · 1.3 km from the kitchen". */
  dropoffText: string;
  kitchen: {
    name: string;
    addressText: string;
    point: { lat: number; lng: number };
    phone: string;
  };
  /** After pickup only (P29.6 until F8, U11). */
  dropoff: {
    firstName: string;
    addressText: string;
    instructions: string | null;
    point: { lat: number; lng: number };
  } | null;
  canGiveBack: boolean;
}

/** The partner-state additions (design "[BE] needs"). */
export interface PartnerDispatchState {
  missedInRow: number;
  /** Set while offers are paused for an old point (P26.2). */
  offersPausedSince: string | null;
  howOffersWork: { reachesKm: number[]; offerSeconds: number; missLimit: number };
  delivery: { deliveryId: string; orderNumber: string; status: PartnerDelivery['status'] } | null;
  notice: { kind: DeliveryNotice; orderNumber: string; at: string } | null;
}

// ------------------------------------------------------------------ staff DTOs

/** A Ready or Out-for-delivery card's courier line (A34.1, A34.2), resolved on the server. */
export interface BoardCourier {
  state: CourierState;
  tone: CourierTone;
  /** "Offered to Grace O. · 24 s left" without the seconds; the board adds them from expiresAt. */
  words: string;
  expiresAt: string | null;
  /** "Morgan" for a staff offer; first names only on cards. */
  offeredBy: string | null;
  /** "Grace O.", masked for the demo admin when a real partner. */
  shortName: string | null;
  vehicleWords: string | null;
  plate: string | null;
  /** "0.9 km away", "at the kitchen", "no location for 12 min". */
  distanceWords: string | null;
  deliveryVersion: number | null;
}

/** A35.1: "Couriers · 4 online · 2 free" (no names). */
export interface CouriersCount {
  online: number;
  free: number;
}

/** A36.2: one row of the offers list (SUPPORT, ADMIN, demo admin). */
export interface OfferRow {
  offerId: string;
  at: string;
  partner: { id: string | null; name: string | null };
  /** "Foodz (automatic)" or "Morgan Diaz (Support)". */
  sentBy: string;
  /** "Within 2 km". */
  reachWords: string | null;
  /** "1.4 km from the kitchen". */
  distanceWords: string;
  seenAt: string | null;
  ending: OfferEnding | 'open';
  /** "Accepted after 6 s", "Missed", "Didn't reach the phone", … */
  outcomeWords: string;
}

/** A36: the order detail's courier section, per role. */
export type StaffCourierSection =
  | { view: 'kitchen'; courier: BoardCourier }
  | {
      view: 'full';
      courier: BoardCourier;
      deliveryId: string | null;
      deliveryVersion: number | null;
      assigned: {
        partnerId: string | null;
        name: string;
        vehicleWords: string;
        plate: string | null;
        acceptedFromWords: string;
        /** SUPPORT and ADMIN; null for the demo admin (A36.5). */
        phone: { e164: string; display: string } | null;
      } | null;
      offers: OfferRow[];
      actions: {
        assign: boolean;
        takeOff: boolean;
        findCourier: boolean;
        readOnly: boolean;
        /** "After pickup, call the courier." (A38.4). */
        afterPickup: boolean;
      };
      masked: boolean;
    };

/** A37.2: one row of the assign dialog, in dispatch order. */
export interface AssignableCourier {
  partnerId: string;
  /** "Grace Okafor · Bicycle · 1.4 km from the kitchen · waiting 10 min". */
  words: string;
  name: string;
  tags: {
    declinedAt: string | null;
    gaveBackAt: string | null;
    staleMinutes: number | null;
    outOfRangeKm: number | null;
  };
  /** "On order 1039", "Has another offer open"; the row is disabled. */
  disabledReason: string | null;
  masked: boolean;
}

export interface AssignableCouriers {
  deliveryVersion: number;
  rows: AssignableCourier[];
  /** "3 approved couriers are offline and can't be assigned." */
  offlineCount: number;
}

export interface StaffDispatchResult {
  orderId: string;
  deliveryId: string;
  version: number;
  at: string;
  replayed: boolean;
}

// ------------------------------------------------------------------ the customer

/** F7 S1 to S4: the line under the h1 and the courier card (B5, design 3). */
export interface CustomerDispatchView {
  state: 'searching' | 'slow' | 'assigned' | 'pickedUp' | 'delivered' | 'none';
  courier: {
    firstName: string;
    photoUrl: string | null;
    photoExpiresAt: string | null;
    vehicle: VehicleType;
    /** "Scooter · 7KT 342", "Bicycle". */
    vehicleWords: string;
    plate: string | null;
    rating: { average: number; count: number } | null;
  } | null;
  /** True when the courier changed while this order was assigned before (S4.2). */
  changed: boolean;
}

// ------------------------------------------------------------------ refusals

/** `details` per refusal code (server/errors.ts). */
export interface DispatchRefusalDetails {
  OFFER_GONE: { why: OfferGoneWhy };
  NOT_OFFERABLE: { why: 'offline' | 'stale' | 'busy' | 'out-of-range' };
  PARTNER_BUSY: { orderNumber: string };
  DELIVERY_CHANGED: {
    orderId: string;
    current: { status: DeliveryStatus; version: number };
    how:
      | 'offered'
      | 'accepted'
      | 'gave-back'
      | 'taken-off'
      | 'escalated'
      | 'stopped'
      | 'restarted'
      | 'other';
    by:
      | { kind: 'staff'; name: string | null; role: 'support' | 'admin' }
      | { kind: 'partner'; shortName: string | null }
      | { kind: 'system' };
    at: string;
  };
  COURIER_UNAVAILABLE: {
    why: 'offline' | 'busy' | 'has-offer';
    name: string | null;
    orderNumber?: string;
  };
  NOT_ASSIGNED: { deliveryId: string };
  GIVE_BACK_CLOSED: { status: DeliveryStatus };
  DEMO_POOL: { pool: DeliveryPool };
  PRACTICE_OPEN: { offerId: string };
}
