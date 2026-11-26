import { formatPrice } from '@/lib/format';
import type { VehicleType } from '@/server/db/enums';
import type { CourierState, CourierTone, OfferEnding, OfferKind } from './schema';
import { AT_KITCHEN_M } from './schema';

/*
 * Ready-made words for the offer card, the pick-up screen, the staff courier line and offers
 * list, and the customer's line (F7 design "[BE] needs"). US spelling; kilometers to one
 * decimal; times in the store's zone are formatted by the caller.
 */

const VEHICLE: Record<VehicleType, string> = {
  BICYCLE: 'Bicycle',
  SCOOTER: 'Scooter',
  MOTORBIKE: 'Motorbike',
  CAR: 'Car',
};

/** "Grace O." (cards, A34.1). */
export function shortName(name: string): string {
  const [first = name, ...rest] = name.trim().split(/\s+/);
  const last = rest.at(-1);
  return last ? `${first} ${last[0]?.toUpperCase() ?? ''}.` : first;
}

export const firstNameOf = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/** "Scooter · 7KT 342", "Bicycle" (S2.1, A34.1). */
export const courierVehicle = (vehicle: VehicleType, plate: string | null) =>
  plate ? `${VEHICLE[vehicle]} · ${plate}` : VEHICLE[vehicle];

/** "1.3 km", one decimal. */
export const km = (meters: number) => `${(Math.round(meters / 100) / 10).toFixed(1)} km`;

/** "1.4 km from the kitchen", or "at the kitchen" within 100 m (design 2.1, 2.7). */
export const fromKitchenWords = (meters: number) =>
  meters <= AT_KITCHEN_M ? 'at the kitchen' : `${km(meters)} from the kitchen`;

/** "waiting 10 min", or "waiting under 1 min" (design 2.7). */
export function waitingWords(waitedMs: number): string {
  const minutes = Math.floor(Math.max(0, waitedMs) / 60_000);
  return minutes < 1 ? 'waiting under 1 min' : `waiting ${minutes} min`;
}

/**
 * "Boston 02109" from the order's city line (`address_city`, "Boston, MA 02109"), the only part
 * of the address a partner sees before accepting (U11). Never derived from the full address.
 */
export function cityAndZip(cityLine: string | null): string {
  if (!cityLine) return 'Drop-off';
  const zip = /\b(\d{5})(?:-\d{4})?\b/.exec(cityLine)?.[1] ?? null;
  const city =
    cityLine
      .split(',')[0]
      ?.replace(/\b\d{5}(?:-\d{4})?\b/, '')
      .trim() || null;
  return [city, zip].filter(Boolean).join(' ') || 'Drop-off';
}

// ------------------------------------------------------------------ the offer card (P20)

export const OFFER_HEADINGS: Record<OfferKind | 'practice', string> = {
  auto: 'New order',
  staff: 'Foodz support picked you for this order.',
  practice: 'Practice offer',
};

export function offerWords(offer: {
  kind: OfferKind | 'practice';
  payCents: number;
  tipCents: number;
  pickupM: number;
  /** The order's city line, never the street (U11). */
  dropoffCity: string | null;
  dropoffM: number;
  items: number;
  cashTotalCents: number | null;
}) {
  const payText = formatPrice(offer.payCents);
  const tipText = offer.tipCents > 0 ? `includes ${formatPrice(offer.tipCents)} tip` : null;
  const pickupText =
    offer.pickupM <= AT_KITCHEN_M
      ? "Foodz Kitchen · you're at the kitchen"
      : `Foodz Kitchen · ${km(offer.pickupM)} from you`;
  const dropoffText = `${cityAndZip(offer.dropoffCity)} · ${km(offer.dropoffM)} from the kitchen`;
  const itemsText = `${offer.items} ${offer.items === 1 ? 'item' : 'items'}`;
  const payment =
    offer.cashTotalCents === null
      ? { kind: 'card' as const, text: 'Paid by card' }
      : {
          kind: 'cash' as const,
          text: `Cash order · collect ${formatPrice(offer.cashTotalCents)}`,
        };
  const earn = offer.kind === 'practice' ? "You'd earn" : 'You earn';
  return {
    heading: OFFER_HEADINGS[offer.kind],
    payText,
    tipText,
    pickupText,
    dropoffText,
    itemsText,
    payment,
    // Read with labels and commas, not the card's dots (design 1.2): "… Pickup: Foodz Kitchen,
    // 0.2 km from you. Drop-off: Boston 02109, 1.3 km from the kitchen. 3 items. …"
    summary: `${[
      `${earn} ${payText}${tipText ? `, ${tipText}` : ''}`,
      `Pickup: ${pickupText.replaceAll(' · ', ', ')}`,
      `Drop-off: ${dropoffText.replaceAll(' · ', ', ')}`,
      itemsText,
      payment.text.replaceAll(' · ', ', '),
    ].join('. ')}.`,
  };
}

// ------------------------------------------------------------------ the staff courier line (A34.1)

export interface CourierLineFacts {
  state: CourierState;
  partnerShort: string | null;
  offeredBy: string | null;
  reachKm: number | null;
  vehicle: VehicleType | null;
  plate: string | null;
  distanceM: number | null;
  staleMinutes: number | null;
}

/** The words before any seconds; the board appends "· 24 s left" from `expiresAt`. */
export function courierLineWords(facts: CourierLineFacts): { words: string; tone: CourierTone } {
  const who = facts.partnerShort ?? 'a courier';
  switch (facts.state) {
    case 'starting':
      return { words: 'Finding a courier…', tone: 'neutral' };
    case 'offered':
      return { words: `Offered to ${who}`, tone: 'neutral' };
    case 'between':
      return {
        words: facts.reachKm
          ? `Finding a courier · within ${facts.reachKm} km`
          : 'Finding a courier…',
        tone: 'neutral',
      };
    case 'staffOffered':
      return { words: `${facts.offeredBy ?? 'Staff'} offered it to ${who}`, tone: 'neutral' };
    case 'assigned': {
      const vehicle = facts.vehicle
        ? ` · ${courierVehicle(facts.vehicle, facts.plate).replace(' · ', ' ')}`
        : '';
      const where =
        facts.distanceM === null
          ? ''
          : facts.distanceM <= AT_KITCHEN_M
            ? ' · at the kitchen'
            : ` · ${km(facts.distanceM)} away`;
      return { words: `${who}${vehicle}${where}`, tone: 'positive' };
    }
    case 'assignedStale':
      return { words: `${who} · no location for ${facts.staleMinutes ?? 10} min`, tone: 'amber' };
    case 'escalated':
      return { words: 'No courier after 5 min · still looking', tone: 'red' };
    case 'nobodyOnline':
      return { words: 'No couriers online · still looking', tone: 'red' };
    default:
      return { words: 'Not looking for a courier', tone: 'red' };
  }
}

// ------------------------------------------------------------------ the offers list (A36.2)

export function outcomeWords(
  ending: OfferEnding | 'open',
  facts: { seen: boolean; answeredAfterSeconds: number | null },
): string {
  const after = facts.answeredAfterSeconds === null ? '' : ` after ${facts.answeredAfterSeconds} s`;
  switch (ending) {
    case 'open':
      return 'Open';
    case 'accepted':
      return `Accepted${after}`;
    case 'declined':
      return `Declined${after}`;
    case 'expired':
      return facts.seen ? 'Missed' : "Didn't reach the phone";
    case 'withdrawn-offline':
      return 'Withdrawn: went offline';
    case 'withdrawn-order':
      return 'Withdrawn: order changed';
    case 'withdrawn-staff':
      return 'Withdrawn: offered by staff instead';
    case 'taken':
      return 'Withdrawn: another partner took it';
    default:
      return 'Answered too late';
  }
}

// ------------------------------------------------------------------ the staff timeline (design 2.5)

/** The courier milestones the staff timeline shows (A36.3): never one entry per offer. */
export const COURIER_MILESTONES = [
  'search-started',
  'assigned',
  'offered-by-staff',
  'gave-back',
  'unassigned',
  'escalated',
  'search-stopped',
  'search-restarted',
  // F8 (design 3.13, A53.2): written as `courier-<name>` by the location pipeline and steps.
  'at-kitchen',
  'almost-there',
  'no-answer',
  'problem',
] as const;

/**
 * F8's other timeline milestones: their own event types (`otp-wrong`, `asked-to-wait`, …), and
 * the courier's own pickup and code delivery (F5's `picked-up` and `delivered` with the courier
 * as the actor). Wrong tries never carry the digits.
 */
export const TRACKING_MILESTONES = [
  'picked-up',
  'otp-wrong',
  'otp-locked',
  'delivered-with-code',
  'handover-confirmed',
  'asked-to-wait',
] as const;
export type CourierMilestone =
  | (typeof COURIER_MILESTONES)[number]
  | (typeof TRACKING_MILESTONES)[number];

const PROBLEM_TIMELINE: Record<string, string> = {
  address: "can't find the address",
  refused: 'customer refused the order',
  'cant-finish': "can't finish the delivery",
  other: 'something else',
};

const CONFIRM_WORDS: Record<string, string> = {
  'customer-confirmed': 'Customer confirmed by phone',
  'left-as-asked': 'Left as the customer asked',
  'code-checked': 'Code checked another way',
  other: 'Other',
};

const GIVE_BACK_WORDS: Record<string, string> = {
  vehicle: 'Vehicle problem',
  emergency: 'Accident or emergency',
  'too-far': 'Too far for me',
  other: 'Other',
};

const TAKE_OFF_WORDS: Record<string, string> = {
  'courier-asked': 'Courier asked to give it back',
  'not-responding': "Courier isn't responding",
  'too-far': 'Courier is too far away',
  other: 'Other',
  suspended: 'Courier suspended',
};

const ROLE_WORDS: Record<string, string> = {
  support: 'Support',
  admin: 'Admin',
  kitchen: 'Kitchen',
};

/** "Luis Moreno accepted · 0.2 km from the kitchen", one sentence per milestone. */
export function courierTimelineWords(facts: {
  event: CourierMilestone;
  courierName: string | null;
  staff: { name: string | null; role: string } | null;
  reason: string | null;
  pickupM: number | null;
  /** F8: the wrong try's number (1 to 5); the cash taken at a code delivery. */
  tryNumber?: number | null;
  cashCents?: number | null;
}): string {
  const courier = facts.courierName ?? 'A courier';
  const staff = facts.staff
    ? `${facts.staff.name ?? 'A staff member'} (${ROLE_WORDS[facts.staff.role] ?? 'Staff'})`
    : 'Foodz';
  const reason = (words: Record<string, string>) =>
    facts.reason && words[facts.reason] ? ` · ${words[facts.reason]}` : '';
  switch (facts.event) {
    case 'search-started':
      return 'Looking for a courier · Foodz (automatic)';
    case 'assigned': {
      if (facts.pickupM === null) return `${courier} accepted`;
      const where =
        facts.pickupM <= AT_KITCHEN_M ? 'at the kitchen' : `${km(facts.pickupM)} from the kitchen`;
      return `${courier} accepted · ${where}`;
    }
    case 'offered-by-staff':
      return `${staff} offered it to ${courier}`;
    case 'gave-back':
      return `${courier} gave it back${reason(GIVE_BACK_WORDS)}`;
    case 'unassigned':
      return `${staff} took it off ${courier}${reason(TAKE_OFF_WORDS)}`;
    case 'escalated':
      return 'No courier after 5 minutes · Foodz (automatic)';
    case 'search-stopped':
      return 'Stopped looking for a courier after 60 minutes · Foodz (automatic)';
    case 'at-kitchen':
      return `${courier} arrived at the kitchen`;
    case 'picked-up':
      return `${courier} picked it up`;
    case 'almost-there':
      return 'Almost there · Foodz (automatic)';
    case 'no-answer':
      return `${courier}: customer isn't answering`;
    case 'problem':
      return `${courier}: ${PROBLEM_TIMELINE[facts.reason ?? 'other'] ?? 'something else'}`;
    case 'asked-to-wait':
      return `${staff} asked ${courier} to wait 5 more minutes`;
    case 'otp-wrong':
      return facts.tryNumber
        ? `Delivery code: wrong try (${facts.tryNumber} of 5)`
        : 'Delivery code: wrong try';
    case 'otp-locked':
      return 'Delivery code locked';
    case 'delivered-with-code':
      return facts.cashCents
        ? `Delivered with the code by ${courier} · cash ${formatPrice(facts.cashCents)} collected`
        : `Delivered with the code by ${courier}`;
    case 'handover-confirmed':
      return `Hand-over confirmed by ${staff}: ${CONFIRM_WORDS[facts.reason ?? 'other'] ?? 'Other'}`;
    default:
      return `${staff} started looking for a courier again`;
  }
}

// ------------------------------------------------------------------ the customer (F7 S1 to S4)

export function customerLine(
  state: 'searching' | 'slow' | 'assigned' | 'pickedUp',
  firstName: string | null,
): string {
  switch (state) {
    case 'searching':
      return "It's packed. We're finding a courier to bring it to you.";
    case 'slow':
      return "It's packed, but finding a courier is taking longer than usual. We're on it and will update this page.";
    case 'assigned':
      return `It's packed. ${firstName ?? 'Your courier'} is on the way to pick it up.`;
    default:
      return `${firstName ?? 'Your courier'} is bringing your order.`;
  }
}
