import type { OfferDetail } from '@/server/modules/delivery/schema';
import type { PartnerDeliveryF8 } from '@/server/modules/tracking/schema';
import type { OfferCard } from '@/lib/partner/dispatch';

/*
 * F7 partner fixtures from the story (design "Examples"): order 1042, Priya's cash order of
 * $58.97 with a $5.00 tip, Luis's pay of $7.64, drop-off "Boston 02109 · 1.3 km".
 */

export const AUTO_OFFER: OfferDetail = {
  offerId: '0193a000-0000-7000-8000-0000000000f1',
  kind: 'auto',
  expiresAt: '2026-11-21T00:40:30.000Z',
  totalSeconds: 30,
  payText: '$7.64',
  payCents: 764,
  tipText: 'includes $5.00 tip',
  pickupText: 'Foodz Kitchen · 0.2 km from you',
  dropoffText: 'Boston 02109 · 1.3 km from the kitchen',
  itemsText: '3 items',
  payment: { kind: 'cash', text: 'Cash order · collect $58.97' },
  heading: 'New order',
  summary:
    'You earn $7.64, includes $5.00 tip. Pickup: Foodz Kitchen, 0.2 km from you. Drop-off: Boston 02109, 1.3 km from the kitchen. 3 items. Cash order, collect $58.97.',
  seen: true,
};

export const STAFF_OFFER: OfferDetail = {
  ...AUTO_OFFER,
  offerId: '0193a000-0000-7000-8000-0000000000f2',
  kind: 'staff',
  totalSeconds: 60,
  payment: { kind: 'card', text: 'Paid by card' },
  heading: 'Foodz support picked you for this order.',
  summary:
    'You earn $7.64, includes $5.00 tip. Pickup: Foodz Kitchen, 0.2 km from you. Drop-off: Boston 02109, 1.3 km from the kitchen. 3 items. Paid by card.',
};

export const PRACTICE_OFFER: OfferDetail = {
  ...AUTO_OFFER,
  offerId: '0193a000-0000-7000-8000-0000000000f3',
  kind: 'practice',
  payText: '$5.64',
  payCents: 564,
  tipText: 'includes $3.00 tip',
  pickupText: "Foodz Kitchen · you're at the kitchen",
  payment: { kind: 'card', text: 'Paid by card' },
  heading: 'Practice offer',
  summary:
    "You'd earn $5.64, includes $3.00 tip. Pickup: Foodz Kitchen, you're at the kitchen. Drop-off: Boston 02109, 1.3 km from the kitchen. 3 items. Paid by card.",
};

/** A card that ends `seconds` from now on the device's clock (stories count down live). */
export function cardFor(
  detail: OfferDetail | null,
  seconds: number,
  patch: Partial<OfferCard> = {},
): OfferCard {
  return {
    offerId: detail?.offerId ?? AUTO_OFFER.offerId,
    expiresAt: new Date(Date.now() + seconds * 1000).toISOString(),
    detail,
    detailFailed: false,
    phase: 'open',
    waitingForConnection: false,
    orderNumber: null,
    openedWith: seconds,
    ...patch,
  };
}

const ROUTE_TO_KITCHEN = {
  geojson: {
    type: 'LineString' as const,
    coordinates: [
      [-71.0532, 42.3554],
      [-71.0499, 42.3531],
      [-71.045, 42.3505],
    ] as [number, number][],
  },
  distanceM: 900,
  durationSec: 240,
  etaAt: '2026-11-21T00:44:00.000Z',
  estimated: false,
};

export const PICK_UP: PartnerDeliveryF8 = {
  deliveryId: '0193a000-0000-7000-8000-0000000000d1',
  status: 'ASSIGNED',
  version: 4,
  orderNumber: '1042',
  payText: '$7.64',
  tipText: 'includes $5.00 tip',
  payment: { kind: 'cash', text: 'Cash order · collect $58.97' },
  itemsText: '3 items',
  dropoffText: 'Then: Boston 02109 · 1.3 km from the kitchen',
  kitchen: {
    name: 'Foodz Kitchen',
    addressText: '88 Harbor Street',
    point: { lat: 42.3505, lng: -71.045 },
    phone: '+16175550142',
  },
  canGiveBack: true,
  stage: 'toKitchen',
  orderReady: true,
  route: ROUTE_TO_KITCHEN,
  dropoff: null,
  noAnswer: null,
  problem: null,
  otp: { locked: false, triesLeft: 5 },
  notice: null,
};

export const AT_KITCHEN: PartnerDeliveryF8 = {
  ...PICK_UP,
  status: 'AT_RESTAURANT',
  version: 5,
  stage: 'atKitchen',
  canGiveBack: true,
};

export const DELIVERING: PartnerDeliveryF8 = {
  ...PICK_UP,
  status: 'PICKED_UP',
  version: 6,
  stage: 'delivering',
  route: {
    geojson: {
      type: 'LineString',
      coordinates: [
        [-71.045, 42.3505],
        [-71.0502, 42.3561],
        [-71.0547, 42.36],
      ],
    },
    distanceM: 1400,
    durationSec: 240,
    etaAt: '2026-11-21T00:46:00.000Z',
    estimated: false,
  },
  dropoff: {
    firstName: 'Priya',
    addressText: '1 Faneuil Hall Square, Boston, MA 02109',
    apt: 'Apt 3',
    instructions: 'Ring twice.\nThird floor, the blue door.',
    point: { lat: 42.36, lng: -71.0547 },
    phone: '+16175550123',
  },
  canGiveBack: false,
};
