import {
  type BalanceState,
  type CashBreakdown,
  type CashCard,
  EARNED_KINDS,
  EARNINGS_LIMITS,
  type EarningKind,
  type EarningsDayGroup,
  type EarningsRow,
  type EntryReason,
  type IsoDate,
  type PayoutMethod,
  type ReportFigures,
  type ReportPreset,
} from './schema';

/*
 * The ledger's rules as pure functions (contract §1, §4, §5). Store days arrive as ISO dates and
 * UTC instants computed by the database; nothing here reads a clock or a time zone offset.
 */

// ------------------------------------------------------------------ E2: what an ending writes

export interface DeliveryEnding {
  status: string;
  endedPartnerId: string | null;
  pickedUpAt: Date | string | null;
  partnerFeeCents: number;
  tipCents: number;
  pool: 'REAL' | 'DEMO';
  paymentMethod: 'CASH' | 'CARD';
  totalCents: number;
}

export interface ExpectedEntry {
  kind: Extract<EarningKind, 'DELIVERY_FEE' | 'TIP' | 'CASH_COLLECTED'>;
  amountCents: number;
  reason: 'cancelled-after-pickup' | null;
}

/**
 * The entries an ended delivery owes its courier. The migration's `ledger_expected_entries`
 * view is the same rule in SQL; a suite compares the two over every fixture.
 */
export function expectedEntries(delivery: DeliveryEnding): ExpectedEntry[] {
  if (!delivery.endedPartnerId) return [];
  const fee = delivery.partnerFeeCents - delivery.tipCents;
  if (delivery.status === 'DELIVERED') {
    const entries: ExpectedEntry[] = [{ kind: 'DELIVERY_FEE', amountCents: fee, reason: null }];
    if (delivery.tipCents > 0) {
      entries.push({ kind: 'TIP', amountCents: delivery.tipCents, reason: null });
    }
    if (delivery.paymentMethod === 'CASH' && delivery.pool === 'REAL' && delivery.totalCents > 0) {
      entries.push({ kind: 'CASH_COLLECTED', amountCents: -delivery.totalCents, reason: null });
    }
    return entries;
  }
  if (delivery.status === 'CANCELLED' && delivery.pickedUpAt) {
    return [{ kind: 'DELIVERY_FEE', amountCents: fee, reason: 'cancelled-after-pickup' }];
  }
  return [];
}

// ------------------------------------------------------------------ balance and cash (P56, A57)

export const isEarned = (kind: EarningKind) => EARNED_KINDS.includes(kind);

export function cashState(balanceCents: number): CashCard['state'] {
  if (balanceCents > 0) return 'owesYou';
  if (balanceCents < 0) return 'handIn';
  return 'square';
}

export function balanceState(balanceCents: number): BalanceState {
  if (balanceCents > 0) return 'foodzOwes';
  if (balanceCents < 0) return 'partnerOwes';
  return 'square';
}

/** A57.1: amber when he owes more than $150 or has owed anything for over 48 hours. */
export function owedAmber(
  owedCents: number,
  owedSince: Date | string | null,
  now: Date,
): { amber: boolean; why: ('age' | 'amount')[] } {
  if (owedCents <= 0) return { amber: false, why: [] };
  const why: ('age' | 'amount')[] = [];
  if (
    owedSince &&
    now.getTime() - new Date(owedSince).getTime() > EARNINGS_LIMITS.cashAmberHours * 3_600_000
  ) {
    why.push('age');
  }
  if (owedCents > EARNINGS_LIMITS.cashAmberCents) why.push('amount');
  return { amber: why.length > 0, why };
}

/** A60.1–A60.2: what he owes, capped at what he holds; nothing when he owes nothing. */
export function defaultCashAmount(balanceCents: number, holdingCents: number): number | null {
  const owed = Math.max(0, -balanceCents);
  if (owed === 0 || holdingCents <= 0) return null;
  return Math.min(owed, holdingCents);
}

export interface LedgerFact {
  id: string;
  kind: EarningKind;
  amountCents: number;
  reason: EntryReason | null;
  at: string;
  balanceAfterCents: number;
}

/**
 * P56.2: "Last payout … Since then: you earned, cash you collected, cash you handed in = …",
 * from the server's entries. `entries` is every entry in recording order.
 */
export function cashBreakdown(entries: readonly LedgerFact[]): CashBreakdown {
  const lastPayoutIndex = entries.findLastIndex((entry) => entry.kind === 'PAYOUT');
  const payout = lastPayoutIndex >= 0 ? entries[lastPayoutIndex] : undefined;
  const since = entries.slice(lastPayoutIndex + 1);
  const sum = (pick: (entry: LedgerFact) => boolean) =>
    since.filter(pick).reduce((total, entry) => total + entry.amountCents, 0);
  const carriedCents = payout ? payout.balanceAfterCents : 0;
  const earnedCents = sum((entry) => isEarned(entry.kind));
  const cashCollectedCents = -sum((entry) => entry.kind === 'CASH_COLLECTED');
  const cashHandedInCents = sum((entry) => entry.kind === 'CASH_HANDED_IN');
  let from: CashBreakdown['from'] = 'none';
  if (payout) from = 'payout';
  else if (entries.length > 0) from = 'firstDelivery';
  return {
    from,
    fromAt: payout?.at ?? entries[0]?.at ?? null,
    payoutCents: payout ? -payout.amountCents : null,
    carriedCents,
    earnedCents,
    cashCollectedCents,
    cashHandedInCents,
    resultCents: carriedCents + earnedCents - cashCollectedCents + cashHandedInCents,
  };
}

// ------------------------------------------------------------------ store dates (E5)

const DAY_MS = 86_400_000;
const parseDate = (date: IsoDate) => Date.parse(`${date}T00:00:00Z`);
const formatDate = (ms: number): IsoDate => new Date(ms).toISOString().slice(0, 10);

export const addDays = (date: IsoDate, days: number): IsoDate =>
  formatDate(parseDate(date) + days * DAY_MS);

/** Monday 0 … Sunday 6. */
export const weekdayIndex = (date: IsoDate) => (new Date(parseDate(date)).getUTCDay() + 6) % 7;
export const isMonday = (date: IsoDate) => weekdayIndex(date) === 0;
export const mondayOf = (date: IsoDate): IsoDate => addDays(date, -weekdayIndex(date));
export const weekDates = (monday: IsoDate): IsoDate[] =>
  Array.from({ length: 7 }, (_, index) => addDays(monday, index));
export const daysBetween = (from: IsoDate, to: IsoDate) =>
  Math.round((parseDate(to) - parseDate(from)) / DAY_MS);

const firstOfMonth = (date: IsoDate): IsoDate => `${date.slice(0, 7)}-01`;
function lastOfMonth(date: IsoDate): IsoDate {
  const [year = 1970, month = 1] = date.split('-').map(Number);
  return formatDate(Date.UTC(year, month, 0));
}

/** A63.2's presets for a store date; "Custom" falls back to last week. */
export function presetRange(preset: ReportPreset, today: IsoDate): { from: IsoDate; to: IsoDate } {
  const monday = mondayOf(today);
  switch (preset) {
    case 'this-week':
      return { from: monday, to: addDays(monday, 6) };
    case 'this-month':
      return { from: firstOfMonth(today), to: lastOfMonth(today) };
    case 'last-month': {
      const end = addDays(firstOfMonth(today), -1);
      return { from: firstOfMonth(end), to: end };
    }
    default:
      return { from: addDays(monday, -7), to: addDays(monday, -1) };
  }
}

/** The latest `to` a report accepts: the end of this month, so the presets stay valid. */
export const latestReportDay = (today: IsoDate): IsoDate => lastOfMonth(today);

// ------------------------------------------------------------------ the goal (P52, P53)

/** Whole percent, half up, capped at 100 for the ring (design 1.4). */
export function goalPercent(earnedCents: number, goalCents: number | null): number {
  if (!goalCents || goalCents <= 0) return 0;
  return Math.min(100, Math.floor((earnedCents * 100) / goalCents + 0.5));
}

/** When today's running earned first reached the goal, from entries in recording order. */
export function goalReachedAt(
  entries: readonly { at: string; kind: EarningKind; amountCents: number }[],
  goalCents: number | null,
): string | null {
  if (!goalCents) return null;
  let running = 0;
  for (const entry of entries) {
    if (!isEarned(entry.kind)) continue;
    running += entry.amountCents;
    if (running >= goalCents) return entry.at;
  }
  return null;
}

// ------------------------------------------------------------------ the partner's list (P55)

export interface PartnerEntry {
  id: string;
  kind: EarningKind;
  reason: EntryReason | null;
  amountCents: number;
  at: string;
  date: IsoDate;
  deliveryId: string | null;
  message: string | null;
  method: PayoutMethod | null;
  reference: string | null;
}

export interface DeliveryWords {
  orderNumber: string;
  areaWords: string | null;
}

/**
 * The partner's rows: one per delivery (fee, tip and cash folded together), one per staff entry.
 * Newest first, grouped by store day with the day's earned total (design 1.7).
 */
export function partnerRows(
  entries: readonly PartnerEntry[],
  deliveries: ReadonlyMap<string, DeliveryWords>,
): EarningsDayGroup[] {
  const rows = new Map<string, EarningsRow & { date: IsoDate }>();
  const earnedByDay = new Map<IsoDate, number>();
  for (const entry of entries) {
    if (isEarned(entry.kind)) {
      earnedByDay.set(entry.date, (earnedByDay.get(entry.date) ?? 0) + entry.amountCents);
    }
    const words = entry.deliveryId ? deliveries.get(entry.deliveryId) : undefined;
    const base = {
      at: entry.at,
      date: entry.date,
      deliveryId: entry.deliveryId,
      orderNumber: words?.orderNumber ?? null,
      areaWords: words?.areaWords ?? null,
      tipCents: null,
      cashCents: null,
      message: null,
      method: null,
      reference: null,
    };
    if (entry.deliveryId && ['DELIVERY_FEE', 'TIP', 'CASH_COLLECTED'].includes(entry.kind)) {
      const key = `delivery:${entry.deliveryId}`;
      const row = rows.get(key) ?? {
        ...base,
        id: entry.id,
        kind: entry.reason === 'cancelled-after-pickup' ? 'cancelledAfterPickup' : 'delivery',
        amountCents: 0,
      };
      if (entry.kind === 'DELIVERY_FEE') {
        row.amountCents += entry.amountCents;
        row.at = entry.at;
        row.date = entry.date;
        row.id = entry.id;
        if (entry.reason === 'cancelled-after-pickup') row.kind = 'cancelledAfterPickup';
      } else if (entry.kind === 'TIP') {
        row.amountCents += entry.amountCents;
        row.tipCents = entry.amountCents;
      } else {
        row.cashCents = -entry.amountCents;
      }
      rows.set(key, row);
      continue;
    }
    let kind: EarningsRow['kind'] = 'payout';
    if (entry.kind === 'CASH_HANDED_IN') kind = 'cashHandedIn';
    else if (entry.kind === 'BONUS' || (entry.kind === 'ADJUSTMENT' && entry.amountCents > 0)) {
      kind = 'added';
    } else if (entry.kind === 'ADJUSTMENT') kind = 'takenOff';
    rows.set(entry.id, {
      ...base,
      id: entry.id,
      kind,
      amountCents: entry.kind === 'PAYOUT' ? -entry.amountCents : entry.amountCents,
      message: entry.message,
      method: entry.method,
      reference: entry.reference,
    });
  }
  const groups = new Map<IsoDate, EarningsRow[]>();
  for (const { date, ...row } of [...rows.values()].toSorted((a, b) => b.at.localeCompare(a.at))) {
    groups.set(date, [...(groups.get(date) ?? []), row]);
  }
  return [...groups.entries()]
    .toSorted(([a], [b]) => b.localeCompare(a))
    .map(([date, list]) => ({ date, earnedCents: earnedByDay.get(date) ?? 0, rows: list }));
}

// ------------------------------------------------------------------ online time (E6)

/** Seconds online inside [from, to), an open session counting up to `now`. */
export function onlineSecondsWithin(
  sessions: readonly { startedAt: Date; endedAt: Date | null }[],
  from: Date,
  to: Date,
  now: Date,
): number {
  let total = 0;
  for (const session of sessions) {
    const start = Math.max(session.startedAt.getTime(), from.getTime());
    const end = Math.min((session.endedAt ?? now).getTime(), to.getTime(), now.getTime());
    if (end > start) total += end - start;
  }
  return Math.floor(total / 1000);
}

// ------------------------------------------------------------------ the report (A63)

export interface DaySums {
  deliveries: number;
  deliveryPayCents: number;
  tipsCents: number;
  adjustmentsCents: number;
  cashCollectedCents: number;
  cashHandedInCents: number;
  paidOutCents: number;
}

/** A row's figures from its in-range sums and its opening balance (A63.3, E1.3). */
export function reportFigures(sums: DaySums, openingCents: number): ReportFigures {
  const earnedCents = sums.deliveryPayCents + sums.tipsCents + sums.adjustmentsCents;
  return {
    deliveries: sums.deliveries,
    deliveryPayCents: sums.deliveryPayCents,
    tipsCents: sums.tipsCents,
    adjustmentsCents: sums.adjustmentsCents,
    earnedCents,
    cashCollectedCents: sums.cashCollectedCents,
    cashHandedInCents: sums.cashHandedInCents,
    paidOutCents: sums.paidOutCents,
    openingCents,
    closingCents:
      openingCents +
      earnedCents -
      sums.cashCollectedCents +
      sums.cashHandedInCents -
      sums.paidOutCents,
  };
}

/** Balance totals are never netted (design conflict 8). */
export function splitBalances(values: readonly number[]) {
  let foodzOwesCents = 0;
  let owedToFoodzCents = 0;
  for (const value of values) {
    if (value > 0) foodzOwesCents += value;
    else owedToFoodzCents -= value;
  }
  return { foodzOwesCents, owedToFoodzCents };
}

// ------------------------------------------------------------------ the demo partner (P62)

interface PracticeDay {
  deliveries: number;
  earnedCents: number;
  tipsCents: number;
}

/** Monday to Sunday; today always reads 4 · $27.80 and Friday's week 23 · $164.35. */
const PRACTICE_TEMPLATE: readonly PracticeDay[] = [
  { deliveries: 5, earnedCents: 3640, tipsCents: 900 },
  { deliveries: 4, earnedCents: 2815, tipsCents: 600 },
  { deliveries: 6, earnedCents: 4200, tipsCents: 1000 },
  { deliveries: 4, earnedCents: 3000, tipsCents: 800 },
  { deliveries: 4, earnedCents: 2780, tipsCents: 800 },
  { deliveries: 5, earnedCents: 3310, tipsCents: 700 },
  { deliveries: 3, earnedCents: 2160, tipsCents: 500 },
];
export const PRACTICE_TODAY: PracticeDay = { deliveries: 4, earnedCents: 2780, tipsCents: 800 };
export const PRACTICE_AREA = 'Boston 02116';

/** The practice week up to `today`: fixed figures, redrawn from the date (P62.1). */
export function practiceDays(today: IsoDate): (PracticeDay & { date: IsoDate })[] {
  const monday = mondayOf(today);
  const todayIndex = weekdayIndex(today);
  return weekDates(monday)
    .slice(0, todayIndex + 1)
    .map((date, index) => {
      const day = index === todayIndex ? PRACTICE_TODAY : PRACTICE_TEMPLATE[index];
      return Object.assign({ date }, day ?? PRACTICE_TODAY);
    });
}

/** One day's practice rows: "Order D-204 · Boston 02116", amounts that add up to the day. */
export function practiceRows(
  day: PracticeDay & { date: IsoDate },
  dayStart: Date,
  offset: number,
): EarningsRow[] {
  const each = Math.floor(day.earnedCents / day.deliveries);
  const tipEach = Math.floor(day.tipsCents / day.deliveries);
  return Array.from({ length: day.deliveries }, (_, index) => {
    const first = index === 0;
    const amount = first ? day.earnedCents - each * (day.deliveries - 1) : each;
    const tip = first ? day.tipsCents - tipEach * (day.deliveries - 1) : tipEach;
    const at = new Date(dayStart.getTime() + (11.5 * 60 + index * 55) * 60_000).toISOString();
    return {
      id: `practice-${day.date}-${index}`,
      kind: 'delivery' as const,
      at,
      deliveryId: null,
      orderNumber: `D-${200 + offset + index}`,
      areaWords: PRACTICE_AREA,
      amountCents: amount,
      tipCents: tip > 0 ? tip : null,
      cashCents: null,
      message: null,
      method: null,
      reference: null,
    };
  }).toReversed();
}

/** Fixed compliments for the demo partner's ratings page (design 1.12). */
export const PRACTICE_RATINGS = {
  average: 4.8,
  count: 126,
  liked: [
    { tag: 'friendly', count: 48 },
    { tag: 'on-time', count: 39 },
    { tag: 'careful-with-food', count: 21 },
    { tag: 'followed-instructions', count: 12 },
  ],
  mentioned: [{ tag: 'late', count: 2 }],
} as const;
