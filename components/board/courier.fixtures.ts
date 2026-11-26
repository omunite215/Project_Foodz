import type {
  AssignableCouriers,
  BoardCourier,
  CourierState,
  OfferRow,
  StaffCourierSection,
} from '@/server/modules/delivery/schema';
import { NOW } from './board.fixtures';

/*
 * F7 staff fixtures from the story's line-up (design "Examples"): Grace, Diego and Luis within
 * 2 km, Omar within 4 km, Lena within 8 km; Morgan (Support) sends offers.
 */

const inSeconds = (seconds: number) => new Date(Date.parse(NOW) + seconds * 1000).toISOString();
const ago = (seconds: number) => inSeconds(-seconds);

const base: BoardCourier = {
  state: 'between',
  tone: 'neutral',
  words: '',
  expiresAt: null,
  offeredBy: null,
  shortName: null,
  vehicleWords: null,
  plate: null,
  distanceWords: null,
  deliveryVersion: 3,
};

/** One line per A34.1 state, as the server resolves it. */
export const COURIER_LINES: Record<CourierState, BoardCourier> = {
  starting: { ...base, state: 'starting', words: 'Finding a courier…', deliveryVersion: null },
  offered: {
    ...base,
    state: 'offered',
    words: 'Offered to Grace O.',
    shortName: 'Grace O.',
    expiresAt: inSeconds(24),
  },
  between: { ...base, state: 'between', words: 'Finding a courier · within 4 km' },
  staffOffered: {
    ...base,
    state: 'staffOffered',
    words: 'Morgan offered it to Grace O.',
    shortName: 'Grace O.',
    offeredBy: 'Morgan',
    expiresAt: inSeconds(48),
  },
  assigned: {
    ...base,
    state: 'assigned',
    tone: 'positive',
    words: 'Luis M. · Scooter 7KT 342 · 0.9 km away',
    shortName: 'Luis M.',
    vehicleWords: 'Scooter · 7KT 342',
    plate: '7KT 342',
    distanceWords: '0.9 km away',
    deliveryVersion: 5,
  },
  assignedStale: {
    ...base,
    state: 'assignedStale',
    tone: 'amber',
    words: 'Luis M. · no location for 12 min',
    shortName: 'Luis M.',
    vehicleWords: 'Scooter · 7KT 342',
    plate: '7KT 342',
    deliveryVersion: 5,
  },
  escalated: {
    ...base,
    state: 'escalated',
    tone: 'red',
    words: 'No courier after 5 min · still looking',
  },
  nobodyOnline: {
    ...base,
    state: 'nobodyOnline',
    tone: 'red',
    words: 'No couriers online · still looking',
  },
  notLooking: { ...base, state: 'notLooking', tone: 'red', words: 'Not looking for a courier' },
};

const offer = (patch: Partial<OfferRow>): OfferRow => ({
  offerId: 'o0',
  at: ago(300),
  partner: { id: '0193a000-0000-7000-8000-0000000000a1', name: 'Grace Okafor' },
  sentBy: 'Foodz (automatic)',
  reachWords: 'Within 2 km',
  distanceWords: '1.4 km from the kitchen',
  seenAt: ago(299),
  ending: 'declined',
  outcomeWords: 'Declined after 4 s',
  ...patch,
});

/** Every outcome the offers list words (A36.2). */
export const OFFERS: OfferRow[] = [
  offer({ offerId: 'o1', at: ago(420), outcomeWords: 'Declined after 4 s' }),
  offer({
    offerId: 'o2',
    at: ago(390),
    partner: { id: null, name: 'Diego Alvarez' },
    ending: 'expired',
    outcomeWords: 'Missed',
  }),
  offer({
    offerId: 'o3',
    at: ago(355),
    partner: { id: null, name: 'Omar Haddad' },
    reachWords: 'Within 4 km',
    distanceWords: '3.1 km from the kitchen',
    seenAt: null,
    ending: 'expired',
    outcomeWords: "Didn't reach the phone",
  }),
  offer({
    offerId: 'o4',
    at: ago(320),
    partner: { id: null, name: 'Lena Fischer' },
    ending: 'withdrawn-offline',
    outcomeWords: 'Withdrawn: went offline',
  }),
  offer({
    offerId: 'o5',
    at: ago(290),
    ending: 'withdrawn-order',
    outcomeWords: 'Withdrawn: order changed',
  }),
  offer({
    offerId: 'o6',
    at: ago(260),
    ending: 'withdrawn-staff',
    outcomeWords: 'Withdrawn: offered by staff instead',
  }),
  offer({ offerId: 'o7', at: ago(230), ending: 'too-late', outcomeWords: 'Answered too late' }),
  offer({
    offerId: 'o8',
    at: ago(200),
    partner: { id: null, name: 'Luis Moreno' },
    sentBy: 'Morgan Diaz (Support)',
    reachWords: null,
    distanceWords: '0.2 km from the kitchen',
    ending: 'accepted',
    outcomeWords: 'Accepted after 6 s',
  }),
  offer({
    offerId: 'o9',
    at: ago(6),
    seenAt: ago(5),
    ending: 'open',
    outcomeWords: 'Open',
  }),
];

export const SUPPORT_SECTION: StaffCourierSection = {
  view: 'full',
  courier: COURIER_LINES.assigned,
  deliveryId: '0193a000-0000-7000-8000-0000000000d1',
  deliveryVersion: 5,
  assigned: {
    partnerId: '0193a000-0000-7000-8000-0000000000a3',
    name: 'Luis Moreno',
    vehicleWords: 'Scooter · 7KT 342',
    plate: '7KT 342',
    acceptedFromWords: '0.2 km from the kitchen',
    phone: { e164: '+16175550177', display: '(617) 555-0177' },
  },
  offers: OFFERS.filter((row) => row.ending !== 'open'),
  actions: {
    assign: false,
    takeOff: true,
    findCourier: false,
    readOnly: false,
    afterPickup: false,
  },
  masked: false,
};

export const SEARCHING_SECTION: StaffCourierSection = {
  ...SUPPORT_SECTION,
  courier: { ...COURIER_LINES.offered },
  assigned: null,
  offers: OFFERS.filter((row) => row.ending !== 'accepted'),
  actions: {
    assign: true,
    takeOff: false,
    findCourier: false,
    readOnly: false,
    afterPickup: false,
  },
};

export const DEMO_SECTION: StaffCourierSection = {
  ...SUPPORT_SECTION,
  assigned: SUPPORT_SECTION.assigned
    ? { ...SUPPORT_SECTION.assigned, partnerId: null, name: 'L•••', plate: null, phone: null }
    : null,
  offers: SUPPORT_SECTION.offers.map((row) => ({
    ...row,
    partner: { id: null, name: `${row.partner.name?.charAt(0) ?? ''}•••` },
  })),
  actions: {
    assign: false,
    takeOff: false,
    findCourier: false,
    readOnly: true,
    afterPickup: false,
  },
  masked: true,
};

export const PICKED_UP_SECTION: StaffCourierSection = {
  ...SUPPORT_SECTION,
  actions: {
    assign: false,
    takeOff: false,
    findCourier: false,
    readOnly: false,
    afterPickup: true,
  },
};

export const KITCHEN_SECTION: StaffCourierSection = {
  view: 'kitchen',
  courier: COURIER_LINES.assigned,
};

export const ASSIGNABLE: AssignableCouriers = {
  deliveryVersion: 3,
  offlineCount: 3,
  rows: [
    {
      partnerId: '0193a000-0000-7000-8000-0000000000a1',
      name: 'Grace Okafor',
      words: 'Grace Okafor · Bicycle · 1.4 km from the kitchen · waiting 10 min',
      tags: { declinedAt: ago(240), gaveBackAt: null, staleMinutes: null, outOfRangeKm: null },
      disabledReason: null,
      masked: false,
    },
    {
      partnerId: '0193a000-0000-7000-8000-0000000000a4',
      name: 'Omar Haddad',
      words: 'Omar Haddad · Car · 3.1 km from the kitchen · waiting 4 min',
      tags: { declinedAt: null, gaveBackAt: null, staleMinutes: 3, outOfRangeKm: null },
      disabledReason: null,
      masked: false,
    },
    {
      partnerId: '0193a000-0000-7000-8000-0000000000a5',
      name: 'Lena Fischer',
      words: 'Lena Fischer · Bicycle · 8.4 km from the kitchen · waiting 1 min',
      tags: { declinedAt: null, gaveBackAt: null, staleMinutes: null, outOfRangeKm: 8.4 },
      disabledReason: null,
      masked: false,
    },
    {
      partnerId: '0193a000-0000-7000-8000-0000000000a2',
      name: 'Diego Alvarez',
      words: 'Diego Alvarez · Scooter · 0.6 km from the kitchen · waiting 0 min',
      tags: { declinedAt: null, gaveBackAt: null, staleMinutes: null, outOfRangeKm: null },
      disabledReason: 'On order 1039',
      masked: false,
    },
  ],
};
