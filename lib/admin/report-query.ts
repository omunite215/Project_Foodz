import type { Route } from 'next';
import { daysBetween, latestReportDay, presetRange } from '@/server/modules/earnings/rules';
import {
  EARNINGS_FIELD_ERRORS,
  EARNINGS_LIMITS,
  type EarningsReportQuery,
  type IsoDate,
  REPORT_FILTERS,
  REPORT_PRESETS,
  REPORT_SORTS,
  type ReportFilter,
  type ReportPreset,
  type ReportSort,
} from '@/server/modules/earnings/schema';
import { isSitePath } from '@/lib/navigation';
import { firstParam } from '@/lib/search-params';

/*
 * The payouts report lives in its address (F9 design 3.12): range, filter, search, sort and
 * page, so a reload, Back and a shared link show the same report. An edited address never
 * breaks the page: a bad range falls back to last week, other bad values to their defaults.
 */

export const REPORT_PATH: Route = '/admin/partners/earnings';

/** Search needs this many characters, like the Partners list (F6 7.4). */
export const MIN_REPORT_SEARCH = 2;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar date in ISO form ("2026-02-30" is not one). */
export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

const pick = <T extends string>(list: readonly T[], value: unknown, fallback: T): T =>
  list.find((item) => item === value) ?? fallback;

/** Whether a range is one the report accepts today (A63.2, the server's own checks). */
export function rangeAllowed(from: IsoDate, to: IsoDate, today: IsoDate): boolean {
  const days = daysBetween(from, to);
  return (
    days >= 0 &&
    days + 1 <= EARNINGS_LIMITS.rangeMaxDays &&
    from <= today &&
    to <= latestReportDay(today)
  );
}

/** The report's query from the address, leniently. */
export function reportQueryFromSearch(
  search: Record<string, string | string[] | undefined>,
  today: IsoDate,
): EarningsReportQuery {
  const from = firstParam(search.from);
  const to = firstParam(search.to);
  const range =
    isIsoDate(from) && isIsoDate(to) && rangeAllowed(from, to, today)
      ? { from, to }
      : presetRange('last-week', today);
  const q = (firstParam(search.q) ?? '').trim().slice(0, 100);
  const page = Number(firstParam(search.page));
  const sort = pick(REPORT_SORTS, firstParam(search.sort), 'partner');
  return {
    ...range,
    filter: pick(REPORT_FILTERS, firstParam(search.filter), 'all'),
    q: q.length >= MIN_REPORT_SEARCH ? q : '',
    sort,
    dir: pick(['asc', 'desc'] as const, firstParam(search.dir), 'asc'),
    page: Number.isInteger(page) && page >= 1 && page <= 10_000 ? page : 1,
  };
}

/** The address of `query`; the range always, everything else only when it isn't the default. */
export function reportHref(query: EarningsReportQuery): Route {
  const params = new URLSearchParams();
  params.set('from', query.from);
  params.set('to', query.to);
  if (query.filter !== 'all') params.set('filter', query.filter);
  if (query.q) params.set('q', query.q);
  if (query.sort !== 'partner' || query.dir !== 'asc') {
    params.set('sort', query.sort);
    params.set('dir', query.dir);
  }
  if (query.page > 1) params.set('page', String(query.page));
  const href = `${REPORT_PATH}?${params.toString()}`;
  return isSitePath(href) ? href : REPORT_PATH;
}

/** Which preset the range is, or "custom". */
export function presetOf(range: { from: IsoDate; to: IsoDate }, today: IsoDate): ReportPreset {
  for (const preset of REPORT_PRESETS) {
    if (preset === 'custom') continue;
    const candidate = presetRange(preset, today);
    if (candidate.from === range.from && candidate.to === range.to) return preset;
  }
  return 'custom';
}

/** A change of range, filter or search goes back to page 1 (design 3.12). */
export const withRange = (
  query: EarningsReportQuery,
  range: { from: IsoDate; to: IsoDate },
): EarningsReportQuery => ({ ...query, ...range, page: 1 });

export const withPreset = (
  query: EarningsReportQuery,
  preset: Exclude<ReportPreset, 'custom'>,
  today: IsoDate,
): EarningsReportQuery => withRange(query, presetRange(preset, today));

export const withFilter = (query: EarningsReportQuery, filter: ReportFilter) => ({
  ...query,
  filter,
  page: 1,
});

export function withSearch(query: EarningsReportQuery, text: string): EarningsReportQuery {
  const q = text.trim().slice(0, 100);
  return { ...query, q: q.length >= MIN_REPORT_SEARCH ? q : '', page: 1 };
}

export const withoutFilters = (query: EarningsReportQuery): EarningsReportQuery => ({
  ...query,
  filter: 'all',
  q: '',
  page: 1,
});

/** Partner reads A to Z first; money columns read the largest first. Again flips it. */
export function withSort(query: EarningsReportQuery, sort: ReportSort): EarningsReportQuery {
  if (query.sort === sort) return { ...query, dir: query.dir === 'asc' ? 'desc' : 'asc', page: 1 };
  return { ...query, sort, dir: sort === 'partner' ? 'asc' : 'desc', page: 1 };
}

export const withReportPage = (query: EarningsReportQuery, page: number): EarningsReportQuery => ({
  ...query,
  page,
});

export const hasReportFilters = (query: Pick<EarningsReportQuery, 'filter' | 'q'>) =>
  query.filter !== 'all' || query.q !== '';

/** What the CSV route reads: every row for the range and filter, so no page (A64.1). */
export function exportBody(query: EarningsReportQuery) {
  return {
    from: query.from,
    to: query.to,
    filter: query.filter,
    q: query.q,
    sort: query.sort,
    dir: query.dir,
  };
}

export interface CustomRangeErrors {
  from?: string;
  to?: string;
}

/** The custom dates' errors (design 3.12), checked when "Apply" is pressed. */
export function customRangeErrors(from: string, to: string, today: IsoDate): CustomRangeErrors {
  const errors: CustomRangeErrors = {};
  if (!isIsoDate(from)) errors.from = EARNINGS_FIELD_ERRORS.date;
  else if (from > today) errors.from = EARNINGS_FIELD_ERRORS.rangeFuture;
  if (!isIsoDate(to)) errors.to = EARNINGS_FIELD_ERRORS.date;
  else if (to > today) errors.to = EARNINGS_FIELD_ERRORS.rangeFuture;
  if (errors.from || errors.to || !isIsoDate(from) || !isIsoDate(to)) return errors;
  const days = daysBetween(from, to);
  if (days < 0) errors.to = EARNINGS_FIELD_ERRORS.rangeOrder;
  else if (days + 1 > EARNINGS_LIMITS.rangeMaxDays) errors.to = EARNINGS_FIELD_ERRORS.rangeLength;
  return errors;
}
