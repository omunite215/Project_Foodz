import { z } from 'zod';
import type { VehicleType } from '@/server/db/enums';
import { stepUpInput } from '@/server/modules/staff/schema';

/*
 * F9's earnings contract (docs contract §1–§5): the ledger's kinds and limits, the staff money
 * inputs, the partner routes' inputs, and every answer the screens read. Shared with the
 * browser, so nothing here touches the server. Money is integer cents everywhere.
 */

export type IsoDate = string;

export const EARNING_KINDS = [
  'DELIVERY_FEE',
  'TIP',
  'BONUS',
  'ADJUSTMENT',
  'CASH_COLLECTED',
  'CASH_HANDED_IN',
  'PAYOUT',
] as const;
export type EarningKind = (typeof EARNING_KINDS)[number];

/** Written by the system when a delivery ends; the rest are staff entries. */
export const AUTOMATIC_KINDS = ['DELIVERY_FEE', 'TIP', 'CASH_COLLECTED'] as const;
/** What counts toward "earned" (P52.5); cash and payouts change only the balance. */
export const EARNED_KINDS: readonly EarningKind[] = ['DELIVERY_FEE', 'TIP', 'BONUS', 'ADJUSTMENT'];

export const ENTRY_REASONS = [
  'cancelled-after-pickup',
  'bonus',
  'cancelled-order-pay',
  'correction',
  'other',
] as const;
export type EntryReason = (typeof ENTRY_REASONS)[number];

export const ADJUST_REASONS = ['bonus', 'cancelled-order-pay', 'correction', 'other'] as const;
export type AdjustReason = (typeof ADJUST_REASONS)[number];

export const PAYOUT_METHODS = ['bank-transfer', 'cash-at-kitchen', 'other'] as const;
export type PayoutMethod = (typeof PAYOUT_METHODS)[number];
export const isPayoutMethod = (value: unknown): value is PayoutMethod =>
  typeof value === 'string' && (PAYOUT_METHODS as readonly string[]).includes(value);

export const EARNINGS_LIMITS = {
  adjustMaxCents: 50_000,
  partnerMessageMax: 200,
  cashNoteMax: 200,
  staffNoteMax: 500,
  referenceMax: 60,
  goalMinCents: 1_000,
  goalMaxCents: 100_000,
  cashAmberCents: 15_000,
  cashAmberHours: 48,
  rangeMaxDays: 366,
  payoutBackdateDays: 366,
  pageSize: 50,
} as const;

/** P56.1, U4: a constant until F18's settings. */
export const PAYOUT_DAY_WORDS = 'Foodz pays on Mondays for the week before.';

export const EARNINGS_FIELD_ERRORS = {
  amount: 'Enter an amount like 12.50.',
  amountMin: 'Enter at least $0.01.',
  adjustCap: 'Adjustments are limited to $500 each.',
  reason: 'Choose a reason.',
  method: 'Choose how you paid.',
  futureDate: "The date can't be in the future.",
  date: 'Enter a date.',
  rangeOrder: "The end date can't be before the start.",
  rangeLength: "The range can't be longer than 366 days.",
  rangeFuture: "Dates can't be after today.",
  goal: 'Enter whole dollars from $10 to $1,000.',
  week: 'Choose a week that starts on a Monday.',
} as const;

// ------------------------------------------------------------------ text inputs

const AMOUNT_PATTERN = /^\$?\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/;

/**
 * A67.3: "$1,234.50", "1234.5" and "0.29" give 123450, 123450 and 29 cents. Parsed as text, never
 * through a float; more than two decimals, a sign, an exponent or anything else gives null.
 */
export function parseAmountText(text: string): number | null {
  const match = AMOUNT_PATTERN.exec(text.trim());
  if (!match) return null;
  const dollars = (match[1] ?? '').replaceAll(',', '');
  if (dollars.length > 7) return null;
  const cents = (match[2] ?? '').padEnd(2, '0');
  return Number(dollars) * 100 + Number(cents);
}

/** Trimmed, control characters removed, runs of spaces kept; empty gives undefined. */
export function cleanPlainText(value: string): string | undefined {
  // oxlint-disable-next-line no-control-regex -- removing control characters is the point
  const cleaned = value.replaceAll(/[\u0000-\u001F\u007F]/g, ' ').trim();
  return cleaned === '' ? undefined : cleaned;
}

/**
 * Typed text from a dialog, or cents already parsed (the action's wrapper parses once and the
 * service checks again).
 */
const amount = z.union([z.string(), z.number()]).transform((value, ctx) => {
  let cents: number | null = null;
  if (typeof value === 'number') {
    cents = Number.isSafeInteger(value) && value <= 10_000_000 ? value : null;
  } else if (value.length <= 20) {
    cents = parseAmountText(value);
  }
  if (cents === null) {
    ctx.addIssue({ code: 'custom', message: EARNINGS_FIELD_ERRORS.amount });
    return z.NEVER;
  }
  if (cents < 1) {
    ctx.addIssue({ code: 'custom', message: EARNINGS_FIELD_ERRORS.amountMin });
    return z.NEVER;
  }
  return cents;
});

const plain = (max: number) =>
  z
    .string()
    .max(max * 4)
    .transform((value) => cleanPlainText(value))
    .pipe(z.string().max(max).optional());

const isoDate = z.iso.date();

const money = {
  partnerId: z.uuid(),
  expectedVersion: z.int().min(0),
  idempotencyKey: z.uuid(),
};

// ------------------------------------------------------------------ staff money inputs (A60–A62)

export const MONEY_DIALOG_KINDS = ['cash', 'adjust', 'payout'] as const;
export type MoneyDialogKind = (typeof MONEY_DIALOG_KINDS)[number];

export const openMoneyDialogInput = z
  .object({ partnerId: z.uuid(), kind: z.enum(MONEY_DIALOG_KINDS) })
  .strict();

export const recordCashInput = z
  .object({ ...money, amount, note: plain(EARNINGS_LIMITS.cashNoteMax).optional() })
  .strict();
export type RecordCashInput = z.input<typeof recordCashInput>;

export const adjustEarningsInput = z
  .object({
    ...money,
    direction: z.enum(['add', 'take-off']),
    amount,
    reason: z.enum(ADJUST_REASONS, { error: EARNINGS_FIELD_ERRORS.reason }),
    message: plain(EARNINGS_LIMITS.partnerMessageMax),
    orderNumber: z
      .string()
      .trim()
      .regex(/^[A-Z]?\d{1,12}$/)
      .optional(),
    note: plain(EARNINGS_LIMITS.staffNoteMax).optional(),
    stepUp: stepUpInput.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.reason === 'bonus' && value.direction !== 'add') {
      ctx.addIssue({ code: 'custom', path: ['reason'], message: EARNINGS_FIELD_ERRORS.reason });
    }
    if (value.amount > EARNINGS_LIMITS.adjustMaxCents) {
      ctx.addIssue({ code: 'custom', path: ['amount'], message: EARNINGS_FIELD_ERRORS.adjustCap });
    }
    if (!value.message) {
      ctx.addIssue({
        code: 'custom',
        path: ['message'],
        message: 'Write a message for the partner.',
      });
    }
  });
export type AdjustEarningsInput = z.input<typeof adjustEarningsInput>;

export const recordPayoutInput = z
  .object({
    ...money,
    amount,
    method: z.enum(PAYOUT_METHODS, { error: EARNINGS_FIELD_ERRORS.method }),
    reference: plain(EARNINGS_LIMITS.referenceMax).optional(),
    paidOn: isoDate,
    note: plain(EARNINGS_LIMITS.staffNoteMax).optional(),
    stepUp: stepUpInput.optional(),
  })
  .strict();
export type RecordPayoutInput = z.input<typeof recordPayoutInput>;

// ------------------------------------------------------------------ partner route inputs (B3)

export const earningsWeekQuery = z.object({ weekStart: isoDate }).strict();
export const earningsDeliveryParams = z.object({ deliveryId: z.uuid() }).strict();
export const goalInput = z
  .object({
    cents: z
      .int()
      .min(EARNINGS_LIMITS.goalMinCents, EARNINGS_FIELD_ERRORS.goal)
      .max(EARNINGS_LIMITS.goalMaxCents, EARNINGS_FIELD_ERRORS.goal)
      .multipleOf(100, EARNINGS_FIELD_ERRORS.goal)
      .nullable(),
  })
  .strict();

// ------------------------------------------------------------------ staff read inputs

/** "10 days" between two ISO dates, inclusive count minus one. */
function dayDistance(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function checkRange(value: { from: string; to: string }, ctx: z.RefinementCtx) {
  const days = dayDistance(value.from, value.to);
  if (days < 0) {
    ctx.addIssue({ code: 'custom', path: ['to'], message: EARNINGS_FIELD_ERRORS.rangeOrder });
  } else if (days + 1 > EARNINGS_LIMITS.rangeMaxDays) {
    ctx.addIssue({ code: 'custom', path: ['to'], message: EARNINGS_FIELD_ERRORS.rangeLength });
  }
}

export const partnerEarningsInput = z
  .object({
    partnerId: z.uuid(),
    from: isoDate.nullable().catch(null),
    to: isoDate.nullable().catch(null),
    page: z.int().min(1).max(10_000).catch(1),
    dir: z.enum(['desc', 'asc']).catch('desc'),
  })
  .strict();
export type PartnerEarningsInput = z.input<typeof partnerEarningsInput>;

export const REPORT_SORTS = [
  'partner',
  'deliveries',
  'deliveryPay',
  'tips',
  'adjustments',
  'earned',
  'cashCollected',
  'cashHandedIn',
  'paidOut',
  'opening',
  'closing',
] as const;
export type ReportSort = (typeof REPORT_SORTS)[number];

export const REPORT_FILTERS = ['all', 'foodz-owes', 'owes-foodz'] as const;
export type ReportFilter = (typeof REPORT_FILTERS)[number];

export const REPORT_PRESETS = [
  'this-week',
  'last-week',
  'this-month',
  'last-month',
  'custom',
] as const;
export type ReportPreset = (typeof REPORT_PRESETS)[number];

const reportFields = {
  from: isoDate,
  to: isoDate,
  filter: z.enum(REPORT_FILTERS).catch('all'),
  q: z
    .string()
    .catch('')
    .transform((value) => value.trim().slice(0, 100))
    .transform((value) => (value.length >= 2 ? value : '')),
  sort: z.enum(REPORT_SORTS).catch('partner'),
  dir: z.enum(['asc', 'desc']).catch('asc'),
};

export const earningsReportInput = z
  .object({ ...reportFields, page: z.int().min(1).max(10_000).catch(1) })
  .strict()
  .superRefine(checkRange);
export type EarningsReportInput = z.input<typeof earningsReportInput>;
export type EarningsReportQuery = z.output<typeof earningsReportInput>;

export const reportExportInput = z.object(reportFields).strict().superRefine(checkRange);
export const entriesExportInput = z
  .object({ from: isoDate, to: isoDate })
  .strict()
  .superRefine(checkRange);

// ------------------------------------------------------------------ partner answers (B3)

export interface EarningsToday {
  date: IsoDate;
  earnedCents: number;
  deliveries: number;
  tipsCents: number;
  onlineSeconds: number;
  goalCents: number | null;
  goalReachedAt: string | null;
  /** The next store midnight: the app refetches then (P52.4). */
  nextDayAt: string;
}

export interface EarningsWeekDay {
  date: IsoDate;
  earnedCents: number;
  deliveries: number;
  state: 'past' | 'today' | 'future';
}

export interface EarningsWeekBlock {
  start: IsoDate;
  end: IsoDate;
  isCurrent: boolean;
  isFirstWeek: boolean;
  earnedCents: number;
  deliveries: number;
  tipsCents: number;
  onlineSeconds: number;
  days: EarningsWeekDay[];
  /** Null on his first week. */
  previousWeekEarnedCents: number | null;
}

export interface CashBreakdown {
  from: 'payout' | 'firstDelivery' | 'none';
  fromAt: string | null;
  payoutCents: number | null;
  carriedCents: number;
  earnedCents: number;
  cashCollectedCents: number;
  cashHandedInCents: number;
  resultCents: number;
}

export interface CashCard {
  state: 'owesYou' | 'handIn' | 'square';
  balanceCents: number;
  holdingCents: number;
  hasEntries: boolean;
  breakdown: CashBreakdown;
}

export interface EarningsSummary {
  asOf: string;
  storeTimeZone: string;
  practice: boolean;
  readOnly: boolean;
  version: number;
  hasEntries: boolean;
  firstWeekStart: IsoDate | null;
  today: EarningsToday;
  week: EarningsWeekBlock;
  cash: CashCard;
}

export type EarningsRowKind =
  | 'delivery'
  | 'cancelledAfterPickup'
  | 'cashHandedIn'
  | 'added'
  | 'takenOff'
  | 'payout';

export interface EarningsRow {
  id: string;
  kind: EarningsRowKind;
  at: string;
  deliveryId: string | null;
  orderNumber: string | null;
  /** "Boston 02109". */
  areaWords: string | null;
  amountCents: number;
  tipCents: number | null;
  cashCents: number | null;
  message: string | null;
  method: PayoutMethod | null;
  reference: string | null;
}

export interface EarningsDayGroup {
  date: IsoDate;
  earnedCents: number;
  rows: EarningsRow[];
}

export interface EarningsWeek extends EarningsWeekBlock {
  practice: boolean;
  /** Newest first; Today's list is the current week filtered to today. */
  groups: EarningsDayGroup[];
}

export type DeliveryHow =
  | 'code'
  | 'staff-confirmed'
  | 'admin-override'
  | 'demo'
  | 'cancelled-after-pickup';

export interface EarningsDeliveryDetail {
  deliveryId: string;
  orderNumber: string;
  date: IsoDate;
  areaWords: string | null;
  distanceKm: number | null;
  steps: { kind: 'accepted' | 'pickedUp' | 'delivered' | 'cancelled'; at: string }[];
  feeCents: number;
  tipCents: number;
  tipPaid: boolean;
  totalCents: number;
  cashCents: number | null;
  how: DeliveryHow;
}

/** What the F6 home and the F8 hand-over answer gain (P51.3, P57.1). */
export interface TodayLine {
  earnedCents: number;
  deliveries: number;
}

// ------------------------------------------------------------------ staff answers

export interface MoneyDialogOpening {
  partnerId: string;
  kind: MoneyDialogKind;
  idempotencyKey: string;
  version: number;
  balanceCents: number;
  holdingCents: number;
  owedCents: number;
  defaultAmountCents: number | null;
  maxAmountCents: number | null;
  stepUpRequired: boolean;
  partnerName: string;
  partnerFirstName: string;
  applies: boolean;
  whyNot: string | null;
}

export interface MoneyActionResult {
  entryId: string;
  kind: EarningKind;
  amountCents: number;
  version: number;
  balanceCents: number;
  holdingCents: number;
  replayed: boolean;
  /** "Recorded $142.70 in cash from Diego A." */
  boardNotice: string;
}

export interface LedgerChangedDetails {
  partnerId: string;
  version: number;
  balanceCents: number;
  holdingCents: number;
  closeOnly: boolean;
  words: string;
  latest: {
    kind: EarningKind;
    amountCents: number;
    at: string;
    byWords: string;
    orderNumber: string | null;
  } | null;
}

export type BalanceState = 'foodzOwes' | 'partnerOwes' | 'square';

export interface PartnerBalance {
  state: BalanceState;
  balanceCents: number;
  holdingCents: number;
  owedSince: string | null;
  amber: boolean;
  why: ('age' | 'amount')[];
}

export interface LedgerRow {
  id: string;
  at: string;
  kind: EarningKind;
  reason: EntryReason | null;
  message: string | null;
  staffNote: string | null;
  orderId: string | null;
  orderNumber: string | null;
  amountCents: number;
  balanceAfterCents: number;
  recordedBy: { kind: 'system' } | { kind: 'staff'; name: string; role: 'support' | 'admin' };
  method: PayoutMethod | null;
  reference: string | null;
  paidOn: IsoDate | null;
}

export interface PartnerEarningsPage {
  partnerId: string;
  name: string;
  masked: boolean;
  deleted: boolean;
  hiddenForDemo: boolean;
  version: number;
  asOf: string;
  balance: PartnerBalance;
  week: {
    start: IsoDate;
    end: IsoDate;
    deliveries: number;
    earnedCents: number;
    tipsCents: number;
    cashCollectedCents: number;
    cashHandedInCents: number;
  };
  lastPayout: {
    at: string;
    paidOn: IsoDate;
    amountCents: number;
    method: PayoutMethod;
    reference: string | null;
  } | null;
  range: { from: IsoDate; to: IsoDate };
  entries: {
    rows: LedgerRow[];
    total: number;
    page: number;
    pageCount: number;
    pageSize: number;
    dir: 'desc' | 'asc';
  };
  actions: {
    recordCash: boolean;
    adjust: boolean;
    payout: boolean;
    csv: boolean;
    stepUpRequired: boolean;
    readOnlyDemo: boolean;
    whyNot: { recordCash: string | null; payout: string | null };
  };
}

export interface ReportFigures {
  deliveries: number;
  deliveryPayCents: number;
  tipsCents: number;
  adjustmentsCents: number;
  earnedCents: number;
  cashCollectedCents: number;
  cashHandedInCents: number;
  paidOutCents: number;
  openingCents: number;
  closingCents: number;
}

export interface ReportRow {
  partnerId: string;
  name: string;
  deleted: boolean;
  masked: boolean;
  hidden: boolean;
  vehicle: VehicleType;
  figures: ReportFigures | null;
}

export interface ReportTotals {
  partners: number;
  deliveries: number;
  deliveryPayCents: number;
  tipsCents: number;
  adjustmentsCents: number;
  earnedCents: number;
  cashCollectedCents: number;
  cashHandedInCents: number;
  paidOutCents: number;
  opening: { foodzOwesCents: number; owedToFoodzCents: number };
  closing: { foodzOwesCents: number; owedToFoodzCents: number };
}

export interface EarningsReport {
  asOf: string;
  query: EarningsReportQuery;
  range: { from: IsoDate; to: IsoDate };
  summary: {
    owedToPartnersCents: number;
    owedToPartnersCount: number;
    owedByPartnersCents: number;
    owedByPartnersCount: number;
  };
  rows: ReportRow[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
  totals: ReportTotals;
  totalsCoverDemoOnly: boolean;
}

/** F6 partners list (A57): one row's money columns; null on the applicant tabs. */
export interface PartnerListMoney {
  hidden: boolean;
  rating: { average: number; count: number; shownToCustomers: boolean } | null;
  week: { deliveries: number; earnedCents: number } | null;
  cash: { owedCents: number; since: string; amber: boolean; why: ('age' | 'amount')[] } | null;
  holdingCents: number;
  actions: { recordCash: boolean };
}
