import type {
  IsoDate,
  ReportFilter,
  ReportPreset,
  ReportSort,
  ReportTotals,
} from '@/server/modules/earnings/schema';
import { formatPrice } from '@/lib/format';

/*
 * The payouts report's words (F9 design 3.12 to 3.15, Copy): ranges, the caption, balances,
 * totals, counts and the CSV's name. Dates are store dates in ISO form, so they're read as
 * calendar days (UTC noon) and never shifted by the browser's zone.
 */

const day = (date: IsoDate) => new Date(`${date}T12:00:00Z`);
const format = (date: IsoDate, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...options }).format(day(date));

const monthDay = (date: IsoDate) => format(date, { month: 'short', day: 'numeric' });
const weekdayMonthDay = (date: IsoDate) =>
  format(date, { weekday: 'short', month: 'short', day: 'numeric' });
const yearOf = (date: IsoDate) => date.slice(0, 4);
const dayOf = (date: IsoDate) => String(Number(date.slice(8, 10)));

export const PRESET_LABELS: Record<ReportPreset, string> = {
  'this-week': 'This week',
  'last-week': 'Last week',
  'this-month': 'This month',
  'last-month': 'Last month',
  custom: 'Custom',
};

export const FILTER_LABELS: Record<ReportFilter, string> = {
  all: 'All',
  'foodz-owes': 'Foodz owes',
  'owes-foodz': 'Owes Foodz',
};

export const COLUMN_LABELS: Record<ReportSort, string> = {
  partner: 'Partner',
  deliveries: 'Deliveries',
  deliveryPay: 'Delivery pay',
  tips: 'Tips',
  adjustments: 'Bonuses and adjustments',
  earned: 'Earned',
  cashCollected: 'Cash collected',
  cashHandedIn: 'Cash handed in',
  paidOut: 'Paid out',
  opening: 'Opening balance',
  closing: 'Closing balance',
};

export const REPORT_COPY = {
  title: 'Earnings and payouts',
  range: 'Range',
  show: 'Show',
  search: 'Search partners',
  searchHint: 'Type at least 2 characters.',
  apply: 'Apply',
  cancel: 'Cancel',
  from: 'From',
  to: 'To',
  dateRange: 'Date range',
  owedToPartners: 'Foodz owes partners',
  owedByPartners: 'Partners owe Foodz',
  csv: 'Download CSV',
  hidden: 'Hidden for demo staff',
  demoTotals: 'Totals cover demo partners only.',
  closingBalance: 'Closing balance',
  emptyTitle: 'No earnings in this range',
  showLastMonth: 'Show last month',
  noMatchTitle: 'No matching partners',
  noMatch: 'No partners match this search or filter.',
  clearFilters: 'Clear filters',
  failed: "We couldn't load the report. Try again.",
  tryAgain: 'Try again',
  noAccess: "You don't have access to earnings and payouts. Ask an admin if you need it.",
} as const;

/**
 * The short range: "Nov 9 – 15", "Nov 30 – Dec 6", "Dec 28, 2026 – Jan 3, 2027"; one day
 * reads "Nov 20".
 */
export function shortRange(from: IsoDate, to: IsoDate): string {
  if (from === to) return monthDay(from);
  if (yearOf(from) !== yearOf(to)) {
    return `${monthDay(from)}, ${yearOf(from)} – ${monthDay(to)}, ${yearOf(to)}`;
  }
  if (from.slice(0, 7) === to.slice(0, 7)) return `${monthDay(from)} – ${dayOf(to)}`;
  return `${monthDay(from)} – ${monthDay(to)}`;
}

/** The range as it's read aloud: "Nov 9 to Nov 15" (A68.2). */
export function spokenRange(from: IsoDate, to: IsoDate): string {
  if (from === to) return monthDay(from);
  if (yearOf(from) !== yearOf(to)) {
    return `${monthDay(from)}, ${yearOf(from)} to ${monthDay(to)}, ${yearOf(to)}`;
  }
  return `${monthDay(from)} to ${monthDay(to)}`;
}

/** "Nov 9 to Nov 15, 2026": the spoken range with its year, for captions. */
export function spokenRangeWithYear(from: IsoDate, to: IsoDate): string {
  if (yearOf(from) !== yearOf(to)) return spokenRange(from, to);
  return `${spokenRange(from, to)}, ${yearOf(to)}`;
}

/** The caption under the range: "Mon, Nov 9 – Sun, Nov 15, 2026 · Dates and times are Boston time." */
export function rangeCaption(from: IsoDate, to: IsoDate): string {
  const zone = 'Dates and times are Boston time.';
  if (from === to) return `${weekdayMonthDay(from)}, ${yearOf(from)} · ${zone}`;
  const start =
    yearOf(from) === yearOf(to)
      ? weekdayMonthDay(from)
      : `${weekdayMonthDay(from)}, ${yearOf(from)}`;
  return `${start} – ${weekdayMonthDay(to)}, ${yearOf(to)} · ${zone}`;
}

/** The phone's range button: "Last week · Nov 9 – 15". */
export const rangeButtonText = (preset: ReportPreset, from: IsoDate, to: IsoDate) =>
  `${PRESET_LABELS[preset]} · ${shortRange(from, to)}`;

/** "Custom" names its dates once they're the range shown: "Custom · Nov 3 – 12". */
export const customLinkText = (current: boolean, from: IsoDate, to: IsoDate) =>
  current ? `${PRESET_LABELS.custom} · ${shortRange(from, to)}` : PRESET_LABELS.custom;

/** A closing or opening balance in parts, so it wraps before the amount (design 3.13). */
export function balanceParts(cents: number): { lead: string | null; amount: string } {
  if (cents > 0) return { lead: 'Foodz owes', amount: formatPrice(cents) };
  if (cents < 0) return { lead: 'Owes', amount: formatPrice(-cents) };
  return { lead: null, amount: formatPrice(0) };
}

/** "Foodz owes $67.05" / "Owes $142.70" / "$0.00". */
export function balanceText(cents: number): string {
  const parts = balanceParts(cents);
  return parts.lead ? `${parts.lead} ${parts.amount}` : parts.amount;
}

/** Bonuses and adjustments: signed only when negative ("−$2.00", U+2212). */
export const adjustmentText = (cents: number) =>
  cents < 0 ? `−${formatPrice(-cents)}` : formatPrice(cents);

/** "1 partner" / "2 partners" / "0 partners". */
export const partnerCount = (count: number) => `${count} ${count === 1 ? 'partner' : 'partners'}`;

/** The result count announced after a change: "2 partners", "1 partner", "No partners". */
export const resultCountWords = (count: number) =>
  count === 0 ? 'No partners' : partnerCount(count);

/** "Totals · 2 partners". */
export const totalsLabel = (count: number) => `Totals · ${partnerCount(count)}`;

/** The split balance totals, never netted (conflict 8): two lines each. */
export function totalsBalanceLines(split: ReportTotals['closing']): [string, string] {
  return [
    `Foodz owes ${formatPrice(split.foodzOwesCents)}`,
    `Owed to Foodz ${formatPrice(split.owedToFoodzCents)}`,
  ];
}

/** The order words for the caption: "partner A to Z", "closing balance, highest first". */
export function sortWords(sort: ReportSort, dir: 'asc' | 'desc'): string {
  if (sort === 'partner') return dir === 'asc' ? 'partner A to Z' : 'partner Z to A';
  return `${COLUMN_LABELS[sort].toLowerCase()}, ${dir === 'asc' ? 'lowest' : 'highest'} first`;
}

/** "Partner earnings, Nov 9 to Nov 15, 2026, partner A to Z, 2 partners". */
export function tableCaption(
  range: { from: IsoDate; to: IsoDate },
  sort: ReportSort,
  dir: 'asc' | 'desc',
  total: number,
): string {
  return `Partner earnings, ${spokenRangeWithYear(range.from, range.to)}, ${sortWords(sort, dir)}, ${partnerCount(total)}`;
}

/** The rest of "Download CSV"'s name: "for Nov 9 to Nov 15". */
export const csvNameSuffix = (from: IsoDate, to: IsoDate) => `for ${spokenRange(from, to)}`;

/** A64.1: no person's name in the file name. */
export const reportFileName = (from: IsoDate, to: IsoDate) =>
  `foodz-partner-earnings-${from}-to-${to}.csv`;

/** "No partner had entries or a balance between Nov 9 and Nov 15." */
export function emptyRangeText(from: IsoDate, to: IsoDate): string {
  if (from === to) return `No partner had entries or a balance on ${monthDay(from)}.`;
  const spoken = spokenRange(from, to).replace(' to ', ' and ');
  return `No partner had entries or a balance between ${spoken}.`;
}
