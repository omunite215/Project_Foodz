import type {
  LedgerRow,
  MoneyDialogOpening,
  PartnerEarningsPage,
  PartnerListMoney,
} from '@/server/modules/earnings/schema';
import {
  listQueryFromSearch,
  type PartnerListResult,
  type PartnerListRow,
} from '@/server/modules/partners/review-schema';
import type {
  PartnerRatingsPage,
  StaffOrderFeedback,
  StaffRatingRow,
} from '@/server/modules/ratings/schema';

/*
 * F9's staff fixtures (story.md, T = Fri, Nov 20, 2026, 7:46 pm in Boston): Luis after order
 * 1042, Diego owing cash since Tuesday, Grace's eight ratings, Omar's sample baseline, Lena with
 * nothing, as Morgan (SUPPORT) and Daniel (ADMIN) see them. No real person.
 */

export const TZ = 'America/New_York';
export const AS_OF = '2026-11-21T00:46:00Z';

export const IDS = {
  luis: '01937c4a-0000-7000-8000-00000000e001',
  diego: '01937c4a-0000-7000-8000-00000000e002',
  grace: '01937c4a-0000-7000-8000-00000000e003',
  omar: '01937c4a-0000-7000-8000-00000000e004',
  lena: '01937c4a-0000-7000-8000-00000000e005',
  kai: '01937c4a-0000-7000-8000-00000000e006',
  riley: '01937c4a-0000-7000-8000-00000000e007',
  masked: '01937c4a-0000-7000-8000-00000000e008',
  order1042: '01937c4a-0000-7000-8000-0000000f1042',
  orderS2205: '01937c4a-0000-7000-8000-0000000f2205',
} as const;

// ------------------------------------------------------------------ the Partners list

const money = (patch: Partial<PartnerListMoney>): PartnerListMoney => ({
  hidden: false,
  rating: null,
  week: null,
  cash: null,
  holdingCents: 0,
  actions: { recordCash: false },
  ...patch,
});

function listRow(
  partnerId: string,
  name: string,
  patch: Partial<PartnerListRow> & { money: PartnerListMoney | null },
): PartnerListRow {
  return {
    partnerId,
    name,
    email: `${name.split(' ')[0]?.toLowerCase() ?? 'partner'}.partner@foodz.example`,
    status: 'APPROVED',
    tab: 'approved',
    statusWords: 'Approved',
    vehicle: 'CAR',
    vehicleWords: 'Car · 6VH 450',
    document: null,
    submittedAt: '2026-10-02T14:00:00Z',
    updatedAt: null,
    fixedAfterSendBack: false,
    waiting: null,
    sentBack: null,
    decided: { at: '2026-10-05T15:00:00Z', byName: 'Morgan Diaz' },
    online: { state: 'offline', words: 'Offline · last seen Fri, Nov 20 · 5:12 pm' },
    partnerSince: '2026-10-05T15:00:00Z',
    rejected: null,
    lastChangeAt: '2026-11-20T22:12:00Z',
    flags: [],
    banned: false,
    isDemoPartner: false,
    masked: false,
    ...patch,
  };
}

export const LIST_ROWS: PartnerListRow[] = [
  listRow(IDS.diego, 'Diego Alvarez', {
    vehicle: 'SCOOTER',
    vehicleWords: 'Scooter · 2KL 118',
    online: { state: 'online', words: 'Online since 6:00 pm · location shared 20 s ago' },
    money: money({
      week: { deliveries: 3, earnedCents: 2210 },
      cash: { owedCents: 14_270, since: '2026-11-18T01:40:00Z', amber: true, why: ['age'] },
      holdingCents: 16_480,
      actions: { recordCash: true },
    }),
  }),
  listRow(IDS.grace, 'Grace Okafor', {
    vehicle: 'BICYCLE',
    vehicleWords: 'Bicycle or e-bike',
    money: money({
      rating: { average: 4.5, count: 8, shownToCustomers: true },
      week: { deliveries: 3, earnedCents: 2025 },
      cash: { owedCents: 4200, since: '2026-11-20T15:00:00Z', amber: false, why: [] },
      holdingCents: 4200,
      actions: { recordCash: true },
    }),
  }),
  listRow(IDS.kai, 'Kai Nakamura', {
    money: money({
      rating: { average: 5, count: 1, shownToCustomers: false },
      week: { deliveries: 1, earnedCents: 764 },
    }),
  }),
  listRow(IDS.lena, 'Lena Fischer', { money: money({}) }),
  listRow(IDS.luis, 'Luis Moreno', {
    online: { state: 'online', words: 'Online since 6:00 pm · location shared 20 s ago' },
    money: money({
      week: { deliveries: 18, earnedCents: 12_602 },
      holdingCents: 5897,
      actions: { recordCash: true },
    }),
  }),
  listRow(IDS.omar, 'Omar Haddad', {
    money: money({
      rating: { average: 4.6, count: 31, shownToCustomers: true },
      week: { deliveries: 9, earnedCents: 6410 },
      cash: { owedCents: 16_480, since: '2026-11-20T21:00:00Z', amber: true, why: ['amount'] },
      holdingCents: 16_480,
      actions: { recordCash: true },
    }),
  }),
];

const COUNTS = { review: 2, waiting: 1, approved: 6, suspended: 1, rejected: 1, all: 11 };

export function listResult(
  search: Record<string, string>,
  rows: PartnerListRow[],
  caption = `Approved partners, latest first, ${rows.length} results`,
): PartnerListResult {
  return {
    asOf: AS_OF,
    query: listQueryFromSearch(search),
    counts: COUNTS,
    rows,
    total: rows.length,
    page: 1,
    pageCount: 1,
    pageSize: 25,
    caption,
  };
}

export const APPROVED_LIST = listResult({ tab: 'approved' }, LIST_ROWS);
export const OWES_LIST = listResult(
  { tab: 'approved', owes: '1' },
  LIST_ROWS.filter((row) => row.money?.cash),
);
export const EMPTY_OWES_LIST = listResult({ tab: 'suspended', owes: '1' }, [], 'No results');

/** The demo admin: real partners masked, their money one hidden cell; Riley in full. */
export const DEMO_LIST = listResult({ tab: 'approved' }, [
  listRow(IDS.masked, 'L•••', {
    email: 'l•••@•••',
    vehicleWords: 'Car · •••',
    masked: true,
    money: money({ hidden: true }),
  }),
  listRow(IDS.riley, 'Riley Park', {
    isDemoPartner: true,
    money: money({
      rating: { average: 4.8, count: 126, shownToCustomers: true },
      week: { deliveries: 23, earnedCents: 16_435 },
    }),
  }),
]);

// ------------------------------------------------------------------ the partner page: Earnings

const SYSTEM = { kind: 'system' } as const;
const MORGAN = { kind: 'staff', name: 'Morgan Diaz', role: 'support' } as const;
const ADMIN = { kind: 'staff', name: 'Foodz Admin', role: 'admin' } as const;

const ledger = (patch: Partial<LedgerRow> & Pick<LedgerRow, 'id' | 'at'>): LedgerRow => ({
  kind: 'DELIVERY_FEE',
  reason: null,
  message: null,
  staffNote: null,
  orderId: null,
  orderNumber: null,
  amountCents: 0,
  balanceAfterCents: 0,
  recordedBy: SYSTEM,
  method: null,
  reference: null,
  paidOn: null,
  ...patch,
});

const order1042 = { orderId: IDS.order1042, orderNumber: '1042' };

export const LUIS_ROWS: LedgerRow[] = [
  ledger({
    id: 'l7',
    at: AS_OF,
    kind: 'CASH_COLLECTED',
    ...order1042,
    amountCents: -5897,
    balanceAfterCents: 6705,
  }),
  ledger({
    id: 'l6',
    at: AS_OF,
    kind: 'TIP',
    ...order1042,
    amountCents: 500,
    balanceAfterCents: 12_602,
  }),
  ledger({ id: 'l5', at: AS_OF, ...order1042, amountCents: 264, balanceAfterCents: 12_102 }),
  ledger({
    id: 'l4',
    at: '2026-11-20T19:10:00Z',
    kind: 'CASH_HANDED_IN',
    amountCents: 8495,
    balanceAfterCents: 11_838,
    recordedBy: MORGAN,
    staffNote: 'Counted with Luis at the counter.',
  }),
  ledger({
    id: 'l3',
    at: '2026-11-20T15:12:00Z',
    kind: 'ADJUSTMENT',
    reason: 'correction',
    message: 'Waited 20 min at the kitchen for order 1050.',
    amountCents: 300,
    balanceAfterCents: 3343,
    recordedBy: ADMIN,
  }),
  ledger({
    id: 'l2',
    at: '2026-11-19T01:31:00Z',
    reason: 'cancelled-after-pickup',
    orderId: '01937c4a-0000-7000-8000-0000000f1043',
    orderNumber: '1043',
    amountCents: 264,
    balanceAfterCents: 3043,
  }),
  ledger({
    id: 'l1',
    at: '2026-11-16T15:05:00Z',
    kind: 'PAYOUT',
    amountCents: -9640,
    balanceAfterCents: 0,
    recordedBy: ADMIN,
    method: 'bank-transfer',
    reference: 'Week of Nov 9',
    paidOn: '2026-11-16',
  }),
];

const WEEK = { start: '2026-11-16', end: '2026-11-22' };

const ADMIN_ACTIONS: PartnerEarningsPage['actions'] = {
  recordCash: true,
  adjust: true,
  payout: true,
  csv: true,
  stepUpRequired: true,
  readOnlyDemo: false,
  whyNot: { recordCash: null, payout: null },
};

export const LUIS_EARNINGS: PartnerEarningsPage = {
  partnerId: IDS.luis,
  name: 'Luis Moreno',
  masked: false,
  deleted: false,
  hiddenForDemo: false,
  version: 41,
  asOf: AS_OF,
  balance: {
    state: 'foodzOwes',
    balanceCents: 6705,
    holdingCents: 5897,
    owedSince: null,
    amber: false,
    why: [],
  },
  week: {
    ...WEEK,
    deliveries: 18,
    earnedCents: 12_602,
    tipsCents: 3950,
    cashCollectedCents: 14_392,
    cashHandedInCents: 8495,
  },
  lastPayout: {
    at: '2026-11-16T15:05:00Z',
    paidOn: '2026-11-16',
    amountCents: 9640,
    method: 'bank-transfer',
    reference: 'Week of Nov 9',
  },
  range: { from: WEEK.start, to: WEEK.end },
  entries: {
    rows: LUIS_ROWS,
    total: LUIS_ROWS.length,
    page: 1,
    pageCount: 1,
    pageSize: 50,
    dir: 'desc',
  },
  actions: ADMIN_ACTIONS,
};

/** Morgan (SUPPORT) on Diego: amber, owed since Tuesday; only "Record cash handed in". */
export const DIEGO_EARNINGS: PartnerEarningsPage = {
  ...LUIS_EARNINGS,
  partnerId: IDS.diego,
  name: 'Diego Alvarez',
  version: 7,
  balance: {
    state: 'partnerOwes',
    balanceCents: -14_270,
    holdingCents: 16_480,
    owedSince: '2026-11-18T01:40:00Z',
    amber: true,
    why: ['age'],
  },
  week: {
    ...WEEK,
    deliveries: 3,
    earnedCents: 2210,
    tipsCents: 400,
    cashCollectedCents: 16_480,
    cashHandedInCents: 0,
  },
  lastPayout: null,
  entries: {
    rows: [
      ledger({
        id: 'd3',
        at: '2026-11-18T01:40:00Z',
        kind: 'CASH_COLLECTED',
        orderId: '01937c4a-0000-7000-8000-0000000f1039',
        orderNumber: '1039',
        amountCents: -5480,
        balanceAfterCents: -14_270,
      }),
      ledger({
        id: 'd2',
        at: '2026-11-18T01:40:00Z',
        kind: 'TIP',
        orderId: '01937c4a-0000-7000-8000-0000000f1039',
        orderNumber: '1039',
        amountCents: 100,
        balanceAfterCents: -8790,
      }),
    ],
    total: 2,
    page: 1,
    pageCount: 1,
    pageSize: 50,
    dir: 'desc',
  },
  actions: {
    recordCash: true,
    adjust: false,
    payout: false,
    csv: false,
    stepUpRequired: false,
    readOnlyDemo: false,
    whyNot: { recordCash: null, payout: "Foodz doesn't owe Diego anything right now." },
  },
};

/** Owing $42.00 since Thursday: under both limits, so no amber. */
export const DIEGO_UNDER_LIMITS: PartnerEarningsPage = {
  ...DIEGO_EARNINGS,
  balance: {
    state: 'partnerOwes',
    balanceCents: -4200,
    holdingCents: 4200,
    owedSince: '2026-11-19T22:00:00Z',
    amber: false,
    why: [],
  },
};

/** Lena, never delivered, as Daniel (ADMIN) sees her: the lines in place of the buttons. */
export const LENA_EARNINGS: PartnerEarningsPage = {
  ...LUIS_EARNINGS,
  partnerId: IDS.lena,
  name: 'Lena Fischer',
  version: 0,
  balance: {
    state: 'square',
    balanceCents: 0,
    holdingCents: 0,
    owedSince: null,
    amber: false,
    why: [],
  },
  week: {
    ...WEEK,
    deliveries: 0,
    earnedCents: 0,
    tipsCents: 0,
    cashCollectedCents: 0,
    cashHandedInCents: 0,
  },
  lastPayout: null,
  entries: { rows: [], total: 0, page: 1, pageCount: 1, pageSize: 50, dir: 'desc' },
  actions: {
    ...ADMIN_ACTIONS,
    recordCash: false,
    payout: false,
    whyNot: {
      recordCash: "Lena isn't holding any cash.",
      payout: "Foodz doesn't owe Lena anything right now.",
    },
  },
};

/** The demo admin on Riley: in full, every action disabled. */
export const RILEY_DEMO_EARNINGS: PartnerEarningsPage = {
  ...LUIS_EARNINGS,
  partnerId: IDS.riley,
  name: 'Riley Park',
  actions: {
    recordCash: false,
    adjust: false,
    payout: false,
    csv: true,
    stepUpRequired: false,
    readOnlyDemo: true,
    whyNot: { recordCash: null, payout: null },
  },
};

/** The demo admin on a real partner. */
export const HIDDEN_EARNINGS: PartnerEarningsPage = {
  ...LENA_EARNINGS,
  name: 'L•••',
  masked: true,
  hiddenForDemo: true,
};

// ------------------------------------------------------------------ money dialog openings

const opening = (patch: Partial<MoneyDialogOpening>): MoneyDialogOpening => ({
  partnerId: IDS.luis,
  kind: 'cash',
  idempotencyKey: '01937c4a-0000-7000-8000-0000000a0001',
  version: 41,
  balanceCents: 6705,
  holdingCents: 5897,
  owedCents: 0,
  defaultAmountCents: null,
  maxAmountCents: 5897,
  stepUpRequired: false,
  partnerName: 'Luis Moreno',
  partnerFirstName: 'Luis',
  applies: true,
  whyNot: null,
  ...patch,
});

export const OPENINGS = {
  cashDiego: opening({
    partnerId: IDS.diego,
    version: 7,
    balanceCents: -14_270,
    holdingCents: 16_480,
    owedCents: 14_270,
    defaultAmountCents: 14_270,
    maxAmountCents: 16_480,
    partnerName: 'Diego Alvarez',
    partnerFirstName: 'Diego',
  }),
  cashLuis: opening({}),
  adjustLuis: opening({ kind: 'adjust', maxAmountCents: 50_000, stepUpRequired: true }),
  payoutLuis: opening({
    kind: 'payout',
    defaultAmountCents: 6705,
    maxAmountCents: 6705,
    stepUpRequired: false,
  }),
  payoutDiego: opening({
    partnerId: IDS.diego,
    kind: 'payout',
    balanceCents: -14_270,
    holdingCents: 16_480,
    partnerName: 'Diego Alvarez',
    partnerFirstName: 'Diego',
    applies: false,
    whyNot: "Foodz doesn't owe Diego anything right now.",
  }),
} as const;

// ------------------------------------------------------------------ ratings

const rating = (patch: Partial<StaffRatingRow> & Pick<StaffRatingRow, 'id'>): StaffRatingRow => ({
  kind: 'courier',
  at: '2026-11-18T00:20:00Z',
  editedAt: null,
  orderId: IDS.orderS2205,
  orderNumber: 'S2205',
  customerShort: 'Hana K.',
  subject: 'Grace Okafor',
  stars: 5,
  tags: [],
  comment: null,
  excluded: null,
  actions: { exclude: true, include: false, readOnlyDemo: false },
  ...patch,
});

export const GRACE_ROWS: StaffRatingRow[] = [
  rating({
    id: 'g8',
    at: '2026-11-20T23:30:00Z',
    orderNumber: 'S2208',
    tags: ['friendly'],
    comment: 'Lovely and quick.\nThank you!',
  }),
  rating({
    id: 'g7',
    at: '2026-11-20T18:05:00Z',
    orderNumber: 'S2207',
    stars: 4,
    tags: ['on-time', 'careful-with-food'],
  }),
  rating({
    id: 'g6',
    at: '2026-11-19T23:40:00Z',
    orderNumber: 'S2206',
    tags: ['friendly'],
    editedAt: '2026-11-20T01:00:00Z',
  }),
  rating({
    id: 'g5',
    orderNumber: 'S2205',
    stars: 3,
    tags: ['late'],
    comment: 'The noodles were cold, but that was the kitchen, not the courier.',
    excluded: {
      reason: 'wrong-subject',
      note: 'The customer meant the Pad Thai.',
      byName: 'Morgan Diaz',
      at: '2026-11-18T10:00:00Z',
    },
    actions: { exclude: false, include: true, readOnlyDemo: false },
  }),
  rating({
    id: 'g4',
    at: '2026-11-17T22:10:00Z',
    orderNumber: 'S2204',
    tags: ['friendly', 'on-time', 'careful-with-food'],
  }),
  rating({
    id: 'g3',
    at: '2026-11-16T23:00:00Z',
    orderNumber: 'S2203',
    stars: 4,
    tags: ['on-time'],
  }),
  rating({
    id: 'g2',
    at: '2026-11-15T21:00:00Z',
    orderNumber: 'S2202',
    tags: ['friendly', 'careful-with-food'],
  }),
  rating({
    id: 'g1',
    at: '2026-11-15T19:00:00Z',
    orderNumber: 'S2201',
    tags: ['friendly', 'on-time'],
    customerShort: 'Deleted customer',
  }),
];

export const GRACE_RATINGS: PartnerRatingsPage = {
  partnerId: IDS.grace,
  hiddenForDemo: false,
  summary: { average: 4.5, count: 8, shownToCustomers: true, baselineCount: 0 },
  spread: [
    { stars: 5, count: 5 },
    { stars: 4, count: 2 },
    { stars: 3, count: 1 },
    { stars: 2, count: 0 },
    { stars: 1, count: 0 },
  ],
  tags30d: {
    liked: [
      { tag: 'friendly', count: 5 },
      { tag: 'on-time', count: 4 },
      { tag: 'careful-with-food', count: 3 },
    ],
    mentioned: [{ tag: 'late', count: 1 }],
  },
  rows: GRACE_ROWS,
  total: 8,
  nextCursor: null,
};

/** Omar: 31 sample ratings without details, nothing rated through Foodz yet. */
export const OMAR_RATINGS: PartnerRatingsPage = {
  partnerId: IDS.omar,
  hiddenForDemo: false,
  summary: { average: 4.6, count: 31, shownToCustomers: true, baselineCount: 31 },
  spread: GRACE_RATINGS.spread.map((entry) => ({ ...entry, count: 0 })),
  tags30d: { liked: [], mentioned: [] },
  rows: [],
  total: 0,
  nextCursor: null,
};

export const KAI_RATINGS: PartnerRatingsPage = {
  ...OMAR_RATINGS,
  partnerId: IDS.kai,
  summary: { average: 5, count: 1, shownToCustomers: false, baselineCount: 0 },
  spread: [{ stars: 5, count: 1 }, ...OMAR_RATINGS.spread.slice(1)],
  rows: [rating({ id: 'k1', subject: 'Kai Nakamura', orderNumber: 'S2301', tags: ['on-time'] })],
  total: 1,
  nextCursor: 'more',
};

export const NO_RATINGS: PartnerRatingsPage = {
  ...OMAR_RATINGS,
  partnerId: IDS.lena,
  summary: { average: null, count: 0, shownToCustomers: false, baselineCount: 0 },
};

/** Riley's rows as the demo admin sees them: no comments, every action disabled. */
function rileyRows(): StaffRatingRow[] {
  const rows: StaffRatingRow[] = [];
  for (const row of GRACE_ROWS.slice(0, 3)) {
    rows.push(
      Object.assign({}, row, {
        subject: 'Riley Park',
        customerShort: 'Dana D.',
        comment: null,
        actions: { exclude: false, include: false, readOnlyDemo: true },
      }),
    );
  }
  return rows;
}

export const RILEY_DEMO_RATINGS: PartnerRatingsPage = {
  ...GRACE_RATINGS,
  partnerId: IDS.riley,
  summary: { average: 4.8, count: 126, shownToCustomers: true, baselineCount: 126 },
  rows: rileyRows(),
  total: 3,
};

export const HIDDEN_RATINGS: PartnerRatingsPage = { ...NO_RATINGS, hiddenForDemo: true };

export const EXCLUDE_ROW = GRACE_ROWS[3] ?? GRACE_ROWS[0];
export const COUNTED_ROW = rating({
  id: 'g5b',
  stars: 3,
  tags: ['late'],
  comment: 'Arrived 20 minutes after the promised time.',
});
export const DISH_ROW = rating({
  id: 'r-dish',
  kind: 'dish',
  subject: 'Gimbap',
  orderNumber: '1042',
  orderId: IDS.order1042,
  at: '2026-11-21T01:05:00Z',
  customerShort: 'Priya S.',
  stars: 3,
  tags: ['cold'],
  comment: 'A bit cold by the time it came.',
});

// ------------------------------------------------------------------ the order's feedback

export const FEEDBACK_RATED: StaffOrderFeedback = {
  state: 'rated',
  closesAt: '2026-11-28T00:46:00Z',
  dishes: [
    { menuItemId: 'm-gimbap', title: 'Gimbap', quantity: 2, rating: DISH_ROW },
    {
      menuItemId: 'm-pad-thai',
      title: 'Pad Thai',
      quantity: 1,
      rating: {
        ...DISH_ROW,
        id: 'r-pad',
        subject: 'Pad Thai',
        stars: 5,
        tags: ['tasty'],
        comment: null,
        editedAt: '2026-11-21T02:00:00Z',
      },
    },
  ],
  courier: {
    partnerId: IDS.luis,
    name: 'Luis Moreno',
    rating: rating({
      id: 'r-courier',
      subject: 'Luis Moreno',
      orderNumber: '1042',
      orderId: IDS.order1042,
      at: '2026-11-21T01:05:00Z',
      customerShort: 'Priya S.',
      tags: ['friendly', 'on-time'],
    }),
  },
};

export const FEEDBACK_PARTLY: StaffOrderFeedback = {
  ...FEEDBACK_RATED,
  dishes: [
    FEEDBACK_RATED.dishes[0] ?? { menuItemId: 'm', title: 'Gimbap', quantity: 1, rating: null },
    { menuItemId: 'm-pad-thai', title: 'Pad Thai', quantity: 1, rating: null },
  ],
  courier: FEEDBACK_RATED.courier
    ? {
        ...FEEDBACK_RATED.courier,
        rating: FEEDBACK_RATED.courier.rating
          ? {
              ...FEEDBACK_RATED.courier.rating,
              stars: 2,
              tags: ['late'],
              excluded: {
                reason: 'wrong-subject',
                note: null,
                byName: 'Morgan Diaz',
                at: '2026-11-21T02:00:00Z',
              },
              actions: { exclude: false, include: true, readOnlyDemo: false },
            }
          : null,
      }
    : null,
};

export const FEEDBACK_STATES: StaffOrderFeedback[] = [
  { state: 'open', closesAt: '2026-11-28T00:46:00Z', dishes: [], courier: null },
  { state: 'skipped', closesAt: '2026-11-28T00:46:00Z', dishes: [], courier: null },
  { state: 'closed', closesAt: '2026-11-17T00:46:00Z', dishes: [], courier: null },
  { state: 'cancelled', closesAt: null, dishes: [], courier: null },
];
