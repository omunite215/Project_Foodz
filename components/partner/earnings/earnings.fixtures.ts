import type {
  CashCard,
  EarningsDeliveryDetail,
  EarningsRow,
  EarningsSummary,
  EarningsWeek,
  EarningsWeekBlock,
} from '@/server/modules/earnings/schema';
import type { PartnerRatingsSummary } from '@/server/modules/ratings/schema';
import { DIEGO_HOME } from '../partner.fixtures';

/*
 * The story's fixtures for the Earnings tab (F9 design "Examples"): T = Fri, Nov 20, 2026,
 * 7:46 pm in Boston. Luis after order 1042, Diego owing cash, Lena with nothing, Riley's practice
 * week, Victor suspended.
 */

export const TZ = 'America/New_York';
export const LUIS_ID = '01937c4a-0000-7000-8000-00000000c010';
export const LUIS_USER = '01937c4a-0000-7000-8000-00000000a010';

export const LUIS_HOME = {
  ...DIEGO_HOME,
  today: { earnedCents: 1957, deliveries: 3 },
  partner: {
    ...DIEGO_HOME.partner,
    id: LUIS_ID,
    name: 'Luis Moreno',
    firstName: 'Luis',
    vehicleWords: 'Bicycle',
  },
};

/** Boston is five hours behind UTC in November. */
const at = (date: string, time: string) => {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  const utc = Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)),
    hours + 5,
    minutes,
  );
  return new Date(utc).toISOString();
};

let rowId = 0;
function row(date: string, time: string, overrides: Partial<EarningsRow>): EarningsRow {
  rowId += 1;
  return {
    id: `row-${rowId}`,
    kind: 'delivery',
    at: at(date, time),
    deliveryId: `delivery-${rowId}`,
    orderNumber: null,
    areaWords: 'Boston 02109',
    amountCents: 0,
    tipCents: null,
    cashCents: null,
    message: null,
    method: null,
    reference: null,
    ...overrides,
  };
}

const deliveries = (date: string, start: number, numbers: string[], amounts: number[]) =>
  numbers.map((number, index) =>
    row(date, `${start + index}:15`, { orderNumber: number, amountCents: amounts[index] ?? 700 }),
  );

export const LUIS_WEEK_BLOCK: EarningsWeekBlock = {
  start: '2026-11-16',
  end: '2026-11-22',
  isCurrent: true,
  isFirstWeek: false,
  earnedCents: 12_602,
  deliveries: 18,
  tipsCents: 3950,
  onlineSeconds: 13 * 3600 + 6 * 60,
  days: [
    { date: '2026-11-16', earnedCents: 2840, deliveries: 4, state: 'past' },
    { date: '2026-11-17', earnedCents: 0, deliveries: 0, state: 'past' },
    { date: '2026-11-18', earnedCents: 4185, deliveries: 6, state: 'past' },
    { date: '2026-11-19', earnedCents: 3620, deliveries: 5, state: 'past' },
    { date: '2026-11-20', earnedCents: 1957, deliveries: 3, state: 'today' },
    { date: '2026-11-21', earnedCents: 0, deliveries: 0, state: 'future' },
    { date: '2026-11-22', earnedCents: 0, deliveries: 0, state: 'future' },
  ],
  previousWeekEarnedCents: 9640,
};

export const LUIS_WEEK: EarningsWeek = {
  ...LUIS_WEEK_BLOCK,
  practice: false,
  groups: [
    {
      date: '2026-11-20',
      earnedCents: 1957,
      rows: [
        row('2026-11-20', '19:46', {
          orderNumber: '1042',
          amountCents: 764,
          tipCents: 500,
          cashCents: 5897,
        }),
        row('2026-11-20', '19:05', { orderNumber: '1041', amountCents: 593, tipCents: 300 }),
        row('2026-11-20', '14:10', {
          kind: 'cashHandedIn',
          deliveryId: null,
          areaWords: null,
          amountCents: 8495,
        }),
        row('2026-11-20', '12:20', { orderNumber: '1040', amountCents: 600 }),
      ],
    },
    {
      date: '2026-11-19',
      earnedCents: 3620,
      rows: [
        row('2026-11-19', '20:31', {
          kind: 'cancelledAfterPickup',
          orderNumber: '1043',
          amountCents: 264,
        }),
        ...deliveries('2026-11-19', 18, ['1036', '1035', '1034'], [1052, 1052, 952]),
        row('2026-11-19', '10:15', {
          kind: 'takenOff',
          deliveryId: null,
          areaWords: null,
          amountCents: -200,
          message: 'Wrong tip entered on order 1046.',
        }),
        row('2026-11-19', '10:12', {
          kind: 'added',
          deliveryId: null,
          areaWords: null,
          amountCents: 300,
          message: 'Waited 20 min at the kitchen for order 1050.',
        }),
      ],
    },
    {
      date: '2026-11-18',
      earnedCents: 4185,
      rows: [
        row('2026-11-18', '22:40', {
          orderNumber: '1031',
          amountCents: 700,
          tipCents: 200,
          cashCents: 4620,
        }),
        row('2026-11-18', '21:40', {
          orderNumber: '1030',
          amountCents: 700,
          cashCents: 3875,
        }),
        ...deliveries('2026-11-18', 17, ['1029', '1028', '1027', '1026'], [700, 695, 695, 695]),
      ],
    },
    {
      date: '2026-11-16',
      earnedCents: 2840,
      rows: [
        ...deliveries('2026-11-16', 12, ['1015', '1014', '1013', '1012'], [710, 710, 710, 710]),
        row('2026-11-16', '10:05', {
          kind: 'payout',
          deliveryId: null,
          areaWords: null,
          amountCents: 9640,
          method: 'bank-transfer',
          reference: 'Week of Nov 9',
        }),
      ],
    },
  ],
};

/** 60 rows in one week: the list is virtualized from 40 (P55.3). */
export const BUSY_WEEK: EarningsWeek = {
  ...LUIS_WEEK,
  groups: LUIS_WEEK_BLOCK.days
    .filter((day) => day.state !== 'future')
    .toReversed()
    .map((day, dayIndex) => ({
      date: day.date,
      earnedCents: 12 * 650,
      rows: Array.from({ length: 12 }, (_, index) =>
        row(day.date, `${21 - index}:${String(10 + dayIndex).padStart(2, '0')}`, {
          orderNumber: String(1100 - dayIndex * 12 - index),
          amountCents: 650,
          tipCents: index % 3 === 0 ? 200 : null,
        }),
      ),
    })),
};

export const LUIS_CASH: CashCard = {
  state: 'owesYou',
  balanceCents: 6705,
  holdingCents: 5897,
  hasEntries: true,
  breakdown: {
    from: 'payout',
    fromAt: at('2026-11-16', '10:05'),
    payoutCents: 9640,
    carriedCents: 0,
    earnedCents: 12_602,
    cashCollectedCents: 14_392,
    cashHandedInCents: 8495,
    resultCents: 6705,
  },
};

export const DIEGO_CASH: CashCard = {
  state: 'handIn',
  balanceCents: -14_270,
  holdingCents: 16_480,
  hasEntries: true,
  breakdown: {
    from: 'firstDelivery',
    fromAt: at('2026-11-09', '17:00'),
    payoutCents: null,
    carriedCents: 0,
    earnedCents: 2210,
    cashCollectedCents: 16_480,
    cashHandedInCents: 0,
    resultCents: -14_270,
  },
};

export const CARRIED_CASH: CashCard = {
  ...LUIS_CASH,
  balanceCents: 7905,
  breakdown: { ...LUIS_CASH.breakdown, carriedCents: 1200, resultCents: 7905 },
};

export const SQUARE_CASH: CashCard = {
  state: 'square',
  balanceCents: 0,
  holdingCents: 0,
  hasEntries: false,
  breakdown: {
    from: 'none',
    fromAt: null,
    payoutCents: null,
    carriedCents: 0,
    earnedCents: 0,
    cashCollectedCents: 0,
    cashHandedInCents: 0,
    resultCents: 0,
  },
};

export const LUIS_SUMMARY: EarningsSummary = {
  asOf: at('2026-11-20', '19:52'),
  storeTimeZone: TZ,
  practice: false,
  readOnly: false,
  version: 41,
  hasEntries: true,
  firstWeekStart: '2026-11-09',
  today: {
    date: '2026-11-20',
    earnedCents: 1957,
    deliveries: 3,
    tipsCents: 800,
    onlineSeconds: 2 * 3600 + 11 * 60,
    goalCents: 4000,
    goalReachedAt: null,
    nextDayAt: '2026-11-21T05:00:00.000Z',
  },
  week: LUIS_WEEK_BLOCK,
  cash: LUIS_CASH,
};

export const GOAL_REACHED_SUMMARY: EarningsSummary = {
  ...LUIS_SUMMARY,
  today: { ...LUIS_SUMMARY.today, earnedCents: 4120, goalReachedAt: at('2026-11-20', '21:02') },
};

export const BIG_DAY_SUMMARY: EarningsSummary = {
  ...LUIS_SUMMARY,
  today: { ...LUIS_SUMMARY.today, earnedCents: 104_250, goalCents: 100_000 },
};

export const NO_GOAL_SUMMARY: EarningsSummary = {
  ...LUIS_SUMMARY,
  today: { ...LUIS_SUMMARY.today, goalCents: null },
};

const EMPTY_DAYS = LUIS_WEEK_BLOCK.days.map((day) => ({ ...day, earnedCents: 0, deliveries: 0 }));

export const EMPTY_WEEK_BLOCK: EarningsWeekBlock = {
  ...LUIS_WEEK_BLOCK,
  earnedCents: 0,
  deliveries: 0,
  tipsCents: 0,
  onlineSeconds: 0,
  days: EMPTY_DAYS,
};

export const LENA_SUMMARY: EarningsSummary = {
  ...LUIS_SUMMARY,
  hasEntries: false,
  firstWeekStart: null,
  today: {
    ...LUIS_SUMMARY.today,
    earnedCents: 0,
    deliveries: 0,
    tipsCents: 0,
    onlineSeconds: 0,
    goalCents: null,
  },
  week: { ...EMPTY_WEEK_BLOCK, isFirstWeek: true, previousWeekEarnedCents: null },
  cash: SQUARE_CASH,
};

export const QUIET_TODAY_SUMMARY: EarningsSummary = {
  ...LUIS_SUMMARY,
  today: { ...LUIS_SUMMARY.today, earnedCents: 0, deliveries: 0, tipsCents: 0 },
};

export const LAST_WEEK_BLOCK: EarningsWeekBlock = {
  start: '2026-11-09',
  end: '2026-11-15',
  isCurrent: false,
  isFirstWeek: true,
  earnedCents: 9640,
  deliveries: 14,
  tipsCents: 2200,
  onlineSeconds: 10 * 3600 + 40 * 60,
  days: [
    { date: '2026-11-09', earnedCents: 2760, deliveries: 4, state: 'past' },
    { date: '2026-11-10', earnedCents: 0, deliveries: 0, state: 'past' },
    { date: '2026-11-11', earnedCents: 3440, deliveries: 5, state: 'past' },
    { date: '2026-11-12', earnedCents: 0, deliveries: 0, state: 'past' },
    { date: '2026-11-13', earnedCents: 3440, deliveries: 5, state: 'past' },
    { date: '2026-11-14', earnedCents: 0, deliveries: 0, state: 'past' },
    { date: '2026-11-15', earnedCents: 0, deliveries: 0, state: 'past' },
  ],
  previousWeekEarnedCents: null,
};

export const EARLIER_WEEK_BLOCK: EarningsWeekBlock = {
  ...LAST_WEEK_BLOCK,
  start: '2026-11-02',
  end: '2026-11-08',
  isFirstWeek: false,
  previousWeekEarnedCents: 0,
};

export const RILEY_SUMMARY: EarningsSummary = {
  ...LUIS_SUMMARY,
  practice: true,
  version: 0,
  today: {
    ...LUIS_SUMMARY.today,
    earnedCents: 2780,
    deliveries: 4,
    tipsCents: 800,
    goalCents: null,
  },
  week: {
    ...LUIS_WEEK_BLOCK,
    earnedCents: 16_435,
    deliveries: 23,
    tipsCents: 4100,
    previousWeekEarnedCents: null,
    isFirstWeek: true,
  },
  cash: {
    state: 'owesYou',
    balanceCents: 16_435,
    holdingCents: 0,
    hasEntries: true,
    breakdown: {
      from: 'firstDelivery',
      fromAt: at('2026-11-16', '11:30'),
      payoutCents: null,
      carriedCents: 0,
      earnedCents: 16_435,
      cashCollectedCents: 0,
      cashHandedInCents: 0,
      resultCents: 16_435,
    },
  },
};

export const VICTOR_SUMMARY: EarningsSummary = {
  ...LUIS_SUMMARY,
  readOnly: true,
  today: { ...LUIS_SUMMARY.today, earnedCents: 0, deliveries: 0, tipsCents: 0, goalCents: null },
  cash: { ...LUIS_CASH, balanceCents: 9640, holdingCents: 0 },
};

const detail = (overrides: Partial<EarningsDeliveryDetail>): EarningsDeliveryDetail => ({
  deliveryId: 'delivery-1',
  orderNumber: '1042',
  date: '2026-11-20',
  areaWords: 'Boston 02109',
  distanceKm: 1.3,
  steps: [
    { kind: 'accepted', at: at('2026-11-20', '19:40') },
    { kind: 'pickedUp', at: at('2026-11-20', '19:42') },
    { kind: 'delivered', at: at('2026-11-20', '19:46') },
  ],
  feeCents: 264,
  tipCents: 500,
  tipPaid: true,
  totalCents: 764,
  cashCents: 5897,
  how: 'code',
  orderTipCents: 500,
  ...overrides,
});

export const DETAILS = {
  code: detail({}),
  staff: detail({ orderNumber: '1044', how: 'staff-confirmed', cashCents: null }),
  override: detail({ orderNumber: '1045', how: 'admin-override', cashCents: null }),
  cancelled: detail({
    orderNumber: '1043',
    how: 'cancelled-after-pickup',
    tipCents: 0,
    tipPaid: false,
    totalCents: 264,
    cashCents: null,
    steps: [
      { kind: 'accepted', at: at('2026-11-19', '20:20') },
      { kind: 'pickedUp', at: at('2026-11-19', '20:24') },
      { kind: 'cancelled', at: at('2026-11-19', '20:31') },
    ],
  }),
};

/** S1105: cancelled after pickup on an order without a tip (review P12). */
export const CANCELLED_NO_TIP: EarningsDeliveryDetail = {
  ...DETAILS.cancelled,
  deliveryId: 'delivery-no-tip',
  orderNumber: '1105',
  orderTipCents: 0,
};

const ratings = (overrides: Partial<PartnerRatingsSummary>): PartnerRatingsSummary => ({
  asOf: at('2026-11-20', '19:52'),
  through: at('2026-11-20', '00:00'),
  practice: false,
  average: 4.5,
  count: 8,
  shownToCustomers: true,
  tagsShown: true,
  liked: [
    { tag: 'friendly', count: 5 },
    { tag: 'on-time', count: 4 },
    { tag: 'careful-with-food', count: 3 },
  ],
  mentioned: [{ tag: 'late', count: 1 }],
  ...overrides,
});

export const RATINGS = {
  grace: ratings({}),
  graceNothingMentioned: ratings({ mentioned: [] }),
  omar: ratings({ average: 4.6, count: 31, tagsShown: false, liked: [], mentioned: [] }),
  underFive: ratings({ average: 5, count: 3, shownToCustomers: false, tagsShown: false }),
  none: ratings({ average: null, count: 0, shownToCustomers: false, tagsShown: false }),
  riley: ratings({
    practice: true,
    average: 4.8,
    count: 126,
    liked: [
      { tag: 'friendly', count: 48 },
      { tag: 'on-time', count: 39 },
      { tag: 'careful-with-food', count: 21 },
      { tag: 'followed-instructions', count: 12 },
    ],
    mentioned: [{ tag: 'late', count: 2 }],
  }),
};
