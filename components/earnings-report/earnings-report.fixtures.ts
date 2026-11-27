import type {
  EarningsReport,
  EarningsReportQuery,
  ReportRow,
} from '@/server/modules/earnings/schema';

/*
 * The story's report at T = Fri, Nov 20, 2026, 7:46 pm (A63.4): Luis and Diego this week, as
 * Daniel (ADMIN) reads it, and the demo admin's masked view. No real person.
 */

export const TODAY = '2026-11-20';

export const THIS_WEEK: EarningsReportQuery = {
  from: '2026-11-16',
  to: '2026-11-22',
  filter: 'all',
  q: '',
  sort: 'partner',
  dir: 'asc',
  page: 1,
};

const DIEGO: ReportRow = {
  partnerId: '0193a000-0000-7000-8000-0000000000d1',
  name: 'Diego Alvarez',
  deleted: false,
  masked: false,
  hidden: false,
  vehicle: 'BICYCLE',
  figures: {
    deliveries: 3,
    deliveryPayCents: 1_810,
    tipsCents: 400,
    adjustmentsCents: 0,
    earnedCents: 2_210,
    cashCollectedCents: 16_480,
    cashHandedInCents: 0,
    paidOutCents: 0,
    openingCents: 0,
    closingCents: -14_270,
  },
};

const LUIS: ReportRow = {
  partnerId: '0193a000-0000-7000-8000-0000000000a1',
  name: 'Luis Moreno',
  deleted: false,
  masked: false,
  hidden: false,
  vehicle: 'SCOOTER',
  figures: {
    deliveries: 18,
    deliveryPayCents: 8_652,
    tipsCents: 3_950,
    adjustmentsCents: 0,
    earnedCents: 12_602,
    cashCollectedCents: 14_392,
    cashHandedInCents: 8_495,
    paidOutCents: 9_640,
    openingCents: 9_640,
    closingCents: 6_705,
  },
};

export const REPORT: EarningsReport = {
  asOf: '2026-11-21T00:46:00.000Z',
  query: THIS_WEEK,
  range: { from: THIS_WEEK.from, to: THIS_WEEK.to },
  summary: {
    owedToPartnersCents: 6_705,
    owedToPartnersCount: 1,
    owedByPartnersCents: 14_270,
    owedByPartnersCount: 1,
  },
  rows: [DIEGO, LUIS],
  total: 2,
  page: 1,
  pageCount: 1,
  pageSize: 50,
  totals: {
    partners: 2,
    deliveries: 21,
    deliveryPayCents: 10_462,
    tipsCents: 4_350,
    adjustmentsCents: 0,
    earnedCents: 14_812,
    cashCollectedCents: 30_872,
    cashHandedInCents: 8_495,
    paidOutCents: 9_640,
    opening: { foodzOwesCents: 9_640, owedToFoodzCents: 0 },
    closing: { foodzOwesCents: 6_705, owedToFoodzCents: 14_270 },
  },
  totalsCoverDemoOnly: false,
};

/** A deleted partner keeps his rows, without a link (E10). */
export const WITH_DELETED: EarningsReport = {
  ...REPORT,
  rows: [
    ...REPORT.rows,
    {
      partnerId: '1a2b0000-0000-7000-8000-000000000099',
      name: 'Deleted partner · 1a2b',
      deleted: true,
      masked: false,
      hidden: false,
      vehicle: 'CAR',
      figures: {
        deliveries: 0,
        deliveryPayCents: 0,
        tipsCents: 0,
        adjustmentsCents: -200,
        earnedCents: -200,
        cashCollectedCents: 0,
        cashHandedInCents: 0,
        paidOutCents: 0,
        openingCents: 200,
        closingCents: 0,
      },
    },
  ],
  total: 3,
  totals: { ...REPORT.totals, partners: 3, adjustmentsCents: -200, earnedCents: 14_612 },
};

export const EMPTY_RANGE: EarningsReport = {
  ...REPORT,
  query: { ...THIS_WEEK, from: '2026-08-03', to: '2026-08-09' },
  range: { from: '2026-08-03', to: '2026-08-09' },
  summary: {
    owedToPartnersCents: 0,
    owedToPartnersCount: 0,
    owedByPartnersCents: 0,
    owedByPartnersCount: 0,
  },
  rows: [],
  total: 0,
  totals: {
    partners: 0,
    deliveries: 0,
    deliveryPayCents: 0,
    tipsCents: 0,
    adjustmentsCents: 0,
    earnedCents: 0,
    cashCollectedCents: 0,
    cashHandedInCents: 0,
    paidOutCents: 0,
    opening: { foodzOwesCents: 0, owedToFoodzCents: 0 },
    closing: { foodzOwesCents: 0, owedToFoodzCents: 0 },
  },
};

export const FILTERED_EMPTY: EarningsReport = {
  ...EMPTY_RANGE,
  query: { ...THIS_WEEK, q: 'zz' },
  range: REPORT.range,
  summary: REPORT.summary,
};

/** The demo admin (A66): Riley and Jamie in full, real partners masked with money hidden. */
export const DEMO_REPORT: EarningsReport = {
  ...REPORT,
  summary: {
    owedToPartnersCents: 16_435,
    owedToPartnersCount: 1,
    owedByPartnersCents: 0,
    owedByPartnersCount: 0,
  },
  rows: [
    {
      partnerId: '0193a000-0000-7000-8000-0000000000e1',
      name: 'Jamie Demo',
      deleted: false,
      masked: false,
      hidden: false,
      vehicle: 'BICYCLE',
      figures: {
        deliveries: 0,
        deliveryPayCents: 0,
        tipsCents: 0,
        adjustmentsCents: 0,
        earnedCents: 0,
        cashCollectedCents: 0,
        cashHandedInCents: 0,
        paidOutCents: 0,
        openingCents: 0,
        closingCents: 0,
      },
    },
    {
      partnerId: '0193a000-0000-7000-8000-0000000000e2',
      name: 'Riley Demo',
      deleted: false,
      masked: false,
      hidden: false,
      vehicle: 'SCOOTER',
      figures: {
        deliveries: 23,
        deliveryPayCents: 12_335,
        tipsCents: 4_100,
        adjustmentsCents: 0,
        earnedCents: 16_435,
        cashCollectedCents: 0,
        cashHandedInCents: 0,
        paidOutCents: 0,
        openingCents: 0,
        closingCents: 16_435,
      },
    },
    { ...DIEGO, name: 'D•••', masked: true, hidden: true, figures: null },
    { ...LUIS, name: 'L•••', masked: true, hidden: true, figures: null },
  ],
  total: 4,
  totals: {
    partners: 4,
    deliveries: 23,
    deliveryPayCents: 12_335,
    tipsCents: 4_100,
    adjustmentsCents: 0,
    earnedCents: 16_435,
    cashCollectedCents: 0,
    cashHandedInCents: 0,
    paidOutCents: 0,
    opening: { foodzOwesCents: 0, owedToFoodzCents: 0 },
    closing: { foodzOwesCents: 16_435, owedToFoodzCents: 0 },
  },
  totalsCoverDemoOnly: true,
};

/** Page 2 of 3 (A63.6: 50 rows a page from the server). */
export const PAGED: EarningsReport = {
  ...REPORT,
  query: { ...THIS_WEEK, page: 2 },
  total: 120,
  page: 2,
  pageCount: 3,
};
