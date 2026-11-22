import type {
  BoardAbilities,
  BoardCard,
  BoardCardLine,
  BoardDish,
  BoardSnapshot,
  FullBoardCard,
  FullCancelPreview,
  FullOrderDetail,
  KitchenBoardCard,
  KitchenCancelPreview,
  StaffTimelineEntry,
} from '@/server/modules/board/schema';
import { LATENESS } from '@/server/modules/board/schema';

/*
 * The story's board fixtures S1101 to S1108 at T = Friday 7:30 pm, Boston time (F5 story,
 * "Seed data and fixtures"), for stories and unit tests. Times are UTC: 7:30 pm EST is 00:30Z.
 */

export const NOW = '2026-11-21T00:30:00.000Z';
export const TZ = 'America/New_York';

/** 7:29 pm on the fixture evening, as UTC ("19:29" → "2026-11-21T00:29:00.000Z"). */
export function at(clock: string): string {
  const [hour = 0, minute = 0] = clock.split(':').map(Number);
  const utc = Date.UTC(2026, 10, 20, hour + 5, minute);
  return new Date(utc).toISOString();
}

const id = (n: number) => `0196a1b2-0000-7000-8000-${String(n).padStart(12, '0')}`;
export const ORDER_ID = (number: number) => id(1100 + number);
export const LINE_ID = (n: number) => id(5000 + n);
export const DISH_ID = (n: number) => id(9000 + n);

function line(
  n: number,
  title: string,
  quantity: number,
  extra: Partial<BoardCardLine> = {},
): BoardCardLine {
  return {
    id: LINE_ID(n),
    dishId: DISH_ID(n),
    title,
    quantity,
    flavors: [],
    note: null,
    soldOut: false,
    ...extra,
  };
}

const base = {
  acceptedAt: null,
  preparingAt: null,
  readyAt: null,
  pickedUpAt: null,
  kitchenNote: null,
  undo: null,
  masked: { firstName: false, kitchenNote: false },
};

type CardSeed = Omit<BoardCard, 'view' | 'payment' | 'itemCount' | keyof typeof base> &
  Partial<typeof base> & {
    method: 'cash' | 'card';
    totalCents: number;
  };

const SEEDS: CardSeed[] = [
  {
    id: ORDER_ID(1),
    number: 'S1101',
    status: 'PLACED',
    version: 3,
    placedAt: at('19:29'),
    readyBy: at('19:53'),
    firstName: 'Priya',
    lines: [line(1, 'Gimbap', 2, { flavors: ['Gochujang'] }), line(2, 'Pad Thai', 1)],
    kitchenNote: 'More spicy, more sauce',
    method: 'card',
    totalCents: 5397,
  },
  {
    id: ORDER_ID(2),
    number: 'S1102',
    status: 'PLACED',
    version: 2,
    placedAt: at('19:24'),
    readyBy: at('19:44'),
    firstName: 'Dana',
    lines: [line(3, 'Bulgogi', 1)],
    method: 'cash',
    totalCents: 2346,
  },
  {
    id: ORDER_ID(3),
    number: 'S1103',
    status: 'ACCEPTED',
    version: 4,
    placedAt: at('19:26'),
    acceptedAt: at('19:27'),
    readyBy: at('19:46'),
    firstName: 'Priya',
    lines: [line(4, 'Kimchi', 5, { note: 'No sesame please' })],
    method: 'cash',
    totalCents: 3995,
  },
  {
    id: ORDER_ID(4),
    number: 'S1104',
    status: 'PREPARING',
    version: 5,
    placedAt: at('19:13'),
    acceptedAt: at('19:14'),
    preparingAt: at('19:15'),
    readyBy: at('19:33'),
    firstName: 'Dana',
    lines: [line(5, 'Phở Bò', 1), line(6, 'Chả Giò', 2)],
    method: 'cash',
    totalCents: 3412,
  },
  {
    id: ORDER_ID(5),
    number: 'S1105',
    status: 'PREPARING',
    version: 5,
    placedAt: at('19:00'),
    acceptedAt: at('19:02'),
    preparingAt: at('19:05'),
    readyBy: at('19:20'),
    firstName: 'Priya',
    lines: [line(7, 'Green Curry', 1)],
    kitchenNote: '<b>extra rice</b>',
    method: 'card',
    totalCents: 2189,
  },
  {
    id: ORDER_ID(6),
    number: 'S1106',
    status: 'READY',
    version: 6,
    placedAt: at('19:08'),
    acceptedAt: at('19:09'),
    preparingAt: at('19:10'),
    readyAt: at('19:26'),
    readyBy: at('19:20'),
    firstName: 'Dana',
    lines: [line(8, 'Fried Thai Rice', 1)],
    method: 'cash',
    totalCents: 1724,
  },
  {
    id: ORDER_ID(7),
    number: 'S1107',
    status: 'READY',
    version: 6,
    placedAt: at('18:50'),
    acceptedAt: at('18:51'),
    preparingAt: at('18:52'),
    readyAt: at('19:14'),
    readyBy: at('19:02'),
    firstName: 'Priya',
    lines: [line(9, 'Samgyeopsal', 2)],
    method: 'card',
    totalCents: 4630,
  },
];

const itemCount = (lines: BoardCardLine[]) => lines.reduce((sum, item) => sum + item.quantity, 0);

export function kitchenCard(
  seed: CardSeed,
  extra: Partial<KitchenBoardCard> = {},
): KitchenBoardCard {
  const { method, totalCents: _total, ...rest } = seed;
  return {
    ...base,
    ...rest,
    view: 'kitchen',
    itemCount: itemCount(seed.lines),
    payment: { method, paid: method === 'card' },
    ...extra,
  };
}

export function fullCard(seed: CardSeed, extra: Partial<FullBoardCard> = {}): FullBoardCard {
  const { method, totalCents, ...rest } = seed;
  return {
    ...base,
    ...rest,
    view: 'full',
    itemCount: itemCount(seed.lines),
    payment: {
      method,
      status: method === 'card' ? 'PAID' : 'UNPAID',
      totalCents,
      refundedCents: 0,
      dispute: 'NONE',
      paidLate: false,
      flags: [],
    },
    ...extra,
  };
}

export const SEED_BY_NUMBER = Object.fromEntries(SEEDS.map((seed) => [seed.number, seed]));
export const seed = (number: string): CardSeed => {
  const found = SEED_BY_NUMBER[number];
  if (!found) throw new Error(`No fixture ${number}`);
  return found;
};

export const kitchenCards = (): KitchenBoardCard[] => SEEDS.map((item) => kitchenCard(item));
export const fullCards = (): FullBoardCard[] => SEEDS.map((item) => fullCard(item));

/** S1101 picked up by hand, for the admin's "Out for delivery" column. */
export const outForDeliveryCard = (): FullBoardCard =>
  fullCard(seed('S1106'), {
    id: ORDER_ID(9),
    number: 'S1109',
    status: 'PICKED_UP',
    version: 8,
    pickedUpAt: at('19:18'),
  });

export const ABILITIES: Record<'kitchen' | 'support' | 'admin' | 'demo', BoardAbilities> = {
  kitchen: {
    move: true,
    undo: true,
    moveBack: false,
    refuse: true,
    cancel: false,
    handOver: false,
    setAvailability: true,
    readOnly: false,
  },
  support: {
    move: false,
    undo: false,
    moveBack: false,
    refuse: false,
    cancel: true,
    handOver: false,
    setAvailability: false,
    readOnly: false,
  },
  admin: {
    move: true,
    undo: true,
    moveBack: true,
    refuse: false,
    cancel: true,
    handOver: true,
    setAvailability: true,
    readOnly: false,
  },
  demo: {
    move: true,
    undo: true,
    moveBack: true,
    refuse: false,
    cancel: true,
    handOver: true,
    setAvailability: true,
    readOnly: true,
  },
};

export function snapshot(
  role: 'kitchen' | 'support' | 'admin' | 'demo',
  extra: Partial<BoardSnapshot> = {},
): BoardSnapshot {
  const kitchen = role === 'kitchen';
  return {
    asOf: NOW,
    view: kitchen ? 'kitchen' : 'full',
    columns: kitchen
      ? ['new', 'accepted', 'preparing', 'ready']
      : ['new', 'accepted', 'preparing', 'ready', 'outForDelivery'],
    cards: kitchen ? kitchenCards() : fullCards(),
    store: {
      isOpen: true,
      label: 'Open · closes 11 pm',
      closesAt: null,
      opensAt: null,
      timeZone: TZ,
    },
    thresholds: LATENESS,
    soldOut: [],
    can: ABILITIES[role],
    realtime: { configured: true },
    ...extra,
  };
}

export const DISHES: BoardDish[] = [
  {
    dishId: DISH_ID(1),
    title: 'Gimbap',
    cuisine: 'KOREAN',
    available: true,
    soldOutSince: null,
    soldOutByName: null,
  },
  {
    dishId: DISH_ID(3),
    title: 'Bulgogi',
    cuisine: 'KOREAN',
    available: true,
    soldOutSince: null,
    soldOutByName: null,
  },
  {
    dishId: DISH_ID(10),
    title: 'Naengmyeon',
    cuisine: 'KOREAN',
    available: false,
    soldOutSince: at('19:12'),
    soldOutByName: 'Alex Kim',
  },
  {
    dishId: DISH_ID(2),
    title: 'Pad Thai',
    cuisine: 'THAI',
    available: false,
    soldOutSince: at('19:42'),
    soldOutByName: 'Alex Kim',
  },
  {
    dishId: DISH_ID(7),
    title: 'Green Curry',
    cuisine: 'THAI',
    available: true,
    soldOutSince: null,
    soldOutByName: null,
  },
  {
    dishId: DISH_ID(5),
    title: 'Phở Bò',
    cuisine: 'VIETNAMESE',
    available: true,
    soldOutSince: null,
    soldOutByName: null,
  },
  {
    dishId: DISH_ID(6),
    title: 'Chả Giò',
    cuisine: 'VIETNAMESE',
    available: true,
    soldOutSince: null,
    soldOutByName: null,
  },
];

export const kitchenPreview = (
  extra: Partial<KitchenCancelPreview> = {},
): KitchenCancelPreview => ({
  view: 'kitchen',
  orderId: ORDER_ID(1),
  number: 'S1101',
  status: 'PLACED',
  version: 3,
  possible: true,
  kitchenStarted: false,
  lines: seed('S1101').lines,
  refund: 'card',
  ...extra,
});

export const fullPreview = (extra: Partial<FullCancelPreview> = {}): FullCancelPreview => ({
  view: 'full',
  orderId: ORDER_ID(1),
  number: '1050',
  status: 'ACCEPTED',
  version: 4,
  possible: true,
  kitchenStarted: false,
  lines: seed('S1101').lines,
  refund: { kind: 'card', amountCents: 5903, cardLabel: 'Visa •••• 4242', tipIncluded: true },
  codeToRelease: 'LASTONE',
  stepUpRequired: false,
  ...extra,
});

const alex = { kind: 'staff', name: 'Alex Kim', role: 'kitchen' } as const;
const admin = { kind: 'staff', name: 'Foodz Admin', role: 'admin' } as const;
const morgan = { kind: 'staff', name: 'Morgan Diaz', role: 'support' } as const;

/** One timeline entry; the type-specific fields come with `value`. */
const entry = (n: number, clock: string, value: Partial<StaffTimelineEntry>): StaffTimelineEntry =>
  // A fixture: the union can't be narrowed from a partial, and the tests read every field.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  ({
    id: id(7000 + n),
    at: at(clock),
    by: alex,
    fromStatus: null,
    toStatus: null,
    ...value,
  }) as StaffTimelineEntry;

/** Every kind of timeline event, oldest first (design 5.3). */
export const TIMELINE: StaffTimelineEntry[] = [
  entry(1, '19:28', { type: 'created', by: { kind: 'customer' } }),
  entry(2, '19:29', {
    type: 'placed',
    by: { kind: 'stripe' },
    method: 'card',
    cardLabel: 'Visa •••• 4242',
  }),
  entry(3, '19:31', { type: 'accepted', toStatus: 'ACCEPTED' }),
  entry(4, '19:32', { type: 'preparing', toStatus: 'PREPARING' }),
  entry(5, '19:50', { type: 'ready', toStatus: 'READY', lateMinutes: 3 }),
  entry(6, '19:50', { type: 'undone', undid: 'READY', toStatus: 'PREPARING' }),
  entry(7, '19:52', { type: 'ready', toStatus: 'READY', lateMinutes: 0 }),
  entry(8, '19:53', {
    type: 'moved-back',
    by: admin,
    toStatus: 'PREPARING',
    reason: 'marked-ready-by-mistake',
    note: null,
  }),
  entry(9, '19:55', {
    type: 'refused',
    toStatus: 'CANCELLED',
    reason: 'dish-unavailable',
    dishes: ['Pad Thai'],
    note: 'Fryer broke, ask Alex',
  }),
  entry(10, '19:55', { type: 'sold-out', dishes: ['Pad Thai'] }),
  entry(11, '19:56', {
    type: 'cancelled',
    by: morgan,
    reason: 'staff',
    code: 'customer-asked',
    dishes: [],
    note: 'Called back to confirm',
  }),
  entry(12, '19:58', {
    type: 'refunded',
    by: { kind: 'stripe' },
    amountCents: 5903,
    cardLabel: 'Visa •••• 4242',
  }),
  entry(13, '20:10', { type: 'picked-up', by: admin, reason: 'own-driver', note: null }),
  entry(14, '20:24', {
    type: 'delivered',
    by: admin,
    reason: 'own-driver',
    note: null,
    cashCollectedCents: 5397,
  }),
];

export function fullDetail(extra: Partial<FullOrderDetail> = {}): FullOrderDetail {
  const card = fullCard(seed('S1101'));
  return {
    view: 'full',
    asOf: NOW,
    id: card.id,
    number: card.number,
    status: 'PLACED',
    version: card.version,
    onBoard: true,
    createdAt: at('19:28'),
    placedAt: at('19:29'),
    acceptedAt: null,
    preparingAt: null,
    readyAt: null,
    pickedUpAt: null,
    deliveredAt: null,
    cancelledAt: null,
    readyBy: at('19:53'),
    promised: { from: at('20:09'), to: at('20:19') },
    howItWent: { acceptedAfterMinutes: null, cookedInMinutes: null, readyLateMinutes: null },
    kitchenNote: card.kitchenNote,
    cancellation: null,
    timeline: TIMELINE.slice(0, 2),
    actions: {
      next: 'ACCEPTED',
      undo: null,
      moveBack: null,
      refuse: false,
      cancel: { stepUp: false },
      pickUp: false,
      deliver: null,
      readOnly: false,
    },
    masked: { customer: false, kitchenNote: false },
    lines: card.lines.map((item, index) =>
      Object.assign(structuredClone(item), {
        unitPriceCents: index === 0 ? 1299 : 1599,
        lineTotalCents: index === 0 ? 2598 : 1599,
      }),
    ),
    customer: {
      name: 'Priya Shah',
      firstName: 'Priya',
      phone: '+16175550123',
      phoneDisplay: '(617) 555-0123',
      address: { label: 'Home', line1: '12 Beacon St', line2: 'Apt 4', city: 'Boston' },
      instructions: 'Ring twice',
      distanceKm: 1.3,
    },
    money: {
      subtotalCents: 4197,
      promo: null,
      deliveryFeeCents: 499,
      deliveryDiscountCents: 0,
      taxCents: 294,
      taxRateBps: 700,
      tipCents: 407,
      totalCents: 5397,
      method: 'card',
      cardLabel: 'Visa •••• 4242',
      paymentStatus: 'PAID',
      refundedCents: 0,
      refund: { state: 'none', amountCents: null, since: null },
      dispute: { status: 'NONE', openedAt: null, closedAt: null },
      decline: null,
      paidLate: false,
    },
    ...extra,
  };
}
