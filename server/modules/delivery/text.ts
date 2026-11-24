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

/** "Boston 02109" from a stored address line ("1 Faneuil Hall Square, Boston, MA 02109"). */
export function cityAndZip(addressText: string): string {
  const zip = /\b(\d{5})(?:-\d{4})?\b(?!.*\b\d{5}\b)/.exec(addressText)?.[1] ?? null;
  const parts = addressText
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  const city = parts.length >= 3 ? parts[parts.length - 2] : parts[1];
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
  dropoffAddress: string;
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
  const dropoffText = `${cityAndZip(offer.dropoffAddress)} · ${km(offer.dropoffM)} from the kitchen`;
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
    summary: [
      `${earn} ${payText}${tipText ? `, ${tipText}` : ''}`,
      pickupText,
      dropoffText,
      itemsText,
      payment.text,
    ].join('. '),
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
