import { describe, expect, it } from 'vitest';
import type { EarningsReportQuery } from '@/server/modules/earnings/schema';
import {
  customRangeErrors,
  exportBody,
  hasReportFilters,
  isIsoDate,
  partnerEarningsHref,
  presetOf,
  reportHref,
  reportQueryFromSearch,
  withFilter,
  withoutFilters,
  withPreset,
  withReportPage,
  withSearch,
  withSort,
} from './report-query';

// T = Fri, Nov 20, 2026 (the story's fixtures).
const TODAY = '2026-11-20';

const LAST_WEEK: EarningsReportQuery = {
  from: '2026-11-09',
  to: '2026-11-15',
  filter: 'all',
  q: '',
  sort: 'partner',
  dir: 'asc',
  page: 1,
};

/** The range the parser settles on for an address's dates. */
function range(from: string, to: string) {
  const query = reportQueryFromSearch({ from, to }, TODAY);
  return { from: query.from, to: query.to };
}

describe('reportQueryFromSearch', () => {
  it('opens on last week, partner A to Z', () => {
    expect(reportQueryFromSearch({}, TODAY)).toEqual(LAST_WEEK);
  });

  it('reads every part of the address', () => {
    expect(
      reportQueryFromSearch(
        {
          from: '2026-11-16',
          to: '2026-11-22',
          filter: 'owes-foodz',
          q: 'lu',
          sort: 'closing',
          dir: 'desc',
          page: '2',
        },
        TODAY,
      ),
    ).toEqual({
      from: '2026-11-16',
      to: '2026-11-22',
      filter: 'owes-foodz',
      q: 'lu',
      sort: 'closing',
      dir: 'desc',
      page: 2,
    });
  });

  it('falls back to last week for a range it would refuse', () => {
    const fallback = { from: LAST_WEEK.from, to: LAST_WEEK.to };
    expect(range('2026-11-15', '2026-11-09')).toEqual(fallback);
    expect(range('2025-01-01', '2026-11-15')).toEqual(fallback);
    expect(range('2026-11-21', '2026-11-22')).toEqual(fallback);
    expect(range('2026-02-30', '2026-03-02')).toEqual(fallback);
    expect(range('nov', '2026-11-15')).toEqual(fallback);
  });

  it('accepts a range ending later this week or month (the presets)', () => {
    const query = reportQueryFromSearch({ from: '2026-11-01', to: '2026-11-30' }, TODAY);
    expect([query.from, query.to]).toEqual(['2026-11-01', '2026-11-30']);
  });

  it('drops bad values to their defaults', () => {
    const query = reportQueryFromSearch(
      { filter: 'nope', sort: 'name', dir: 'up', page: '0', q: 'l' },
      TODAY,
    );
    expect(query).toEqual(LAST_WEEK);
  });

  it('reads the first value of a repeated parameter', () => {
    expect(reportQueryFromSearch({ filter: ['foodz-owes', 'all'] }, TODAY).filter).toBe(
      'foodz-owes',
    );
  });
});

describe('reportHref', () => {
  it('always keeps the range and leaves defaults out', () => {
    expect(reportHref(LAST_WEEK)).toBe('/admin/partners/earnings?from=2026-11-09&to=2026-11-15');
  });

  it('writes what differs', () => {
    expect(
      reportHref({
        ...LAST_WEEK,
        filter: 'owes-foodz',
        q: 'lu',
        sort: 'closing',
        dir: 'desc',
        page: 3,
      }),
    ).toBe(
      '/admin/partners/earnings?from=2026-11-09&to=2026-11-15&filter=owes-foodz&q=lu&sort=closing&dir=desc&page=3',
    );
  });

  it("opens a partner's Earnings on the report's range", () => {
    expect(
      partnerEarningsHref('0193a000-0000-7000-8000-000000000001', {
        from: '2026-11-16',
        to: '2026-11-22',
      }),
    ).toBe(
      '/admin/partners/0193a000-0000-7000-8000-000000000001?view=earnings&from=2026-11-16&to=2026-11-22',
    );
  });

  it('round-trips through the parser', () => {
    const query = { ...LAST_WEEK, q: 'grace o', sort: 'earned' as const, dir: 'desc' as const };
    const href = reportHref(query);
    const search = Object.fromEntries(new URL(href, 'http://localhost').searchParams.entries());
    expect(reportQueryFromSearch(search, TODAY)).toEqual(query);
  });
});

describe('presets and changes', () => {
  it('knows which preset a range is', () => {
    expect(presetOf(LAST_WEEK, TODAY)).toBe('last-week');
    expect(presetOf({ from: '2026-11-16', to: '2026-11-22' }, TODAY)).toBe('this-week');
    expect(presetOf({ from: '2026-11-01', to: '2026-11-30' }, TODAY)).toBe('this-month');
    expect(presetOf({ from: '2026-10-01', to: '2026-10-31' }, TODAY)).toBe('last-month');
    expect(presetOf({ from: '2026-11-03', to: '2026-11-12' }, TODAY)).toBe('custom');
  });

  it('goes back to page 1 on a change of range, filter or search', () => {
    const onPage3 = { ...LAST_WEEK, page: 3 };
    expect(withPreset(onPage3, 'this-week', TODAY)).toMatchObject({
      from: '2026-11-16',
      to: '2026-11-22',
      page: 1,
    });
    expect(withFilter(onPage3, 'foodz-owes')).toMatchObject({ filter: 'foodz-owes', page: 1 });
    expect(withSearch(onPage3, '  lu ')).toMatchObject({ q: 'lu', page: 1 });
    expect(withSearch(onPage3, 'l')).toMatchObject({ q: '', page: 1 });
    expect(withReportPage(LAST_WEEK, 2).page).toBe(2);
  });

  it('sorts partner A to Z first and money largest first, then flips', () => {
    expect(withSort(LAST_WEEK, 'partner')).toMatchObject({ sort: 'partner', dir: 'desc' });
    expect(withSort(LAST_WEEK, 'closing')).toMatchObject({ sort: 'closing', dir: 'desc' });
    const byClosing = withSort(LAST_WEEK, 'closing');
    expect(withSort(byClosing, 'closing')).toMatchObject({ dir: 'asc' });
    expect(withSort(byClosing, 'partner')).toMatchObject({ sort: 'partner', dir: 'asc' });
  });

  it('clears search and filter together', () => {
    const filtered = { ...LAST_WEEK, filter: 'owes-foodz' as const, q: 'di' };
    expect(hasReportFilters(filtered)).toBe(true);
    expect(hasReportFilters(withoutFilters(filtered))).toBe(false);
  });

  it('exports every row: the query without its page (A64.1)', () => {
    expect(exportBody({ ...LAST_WEEK, page: 4 })).toEqual({
      from: '2026-11-09',
      to: '2026-11-15',
      filter: 'all',
      q: '',
      sort: 'partner',
      dir: 'asc',
    });
  });
});

describe('customRangeErrors', () => {
  it('asks for both dates', () => {
    expect(customRangeErrors('', '', TODAY)).toEqual({
      from: 'Enter a date.',
      to: 'Enter a date.',
    });
  });

  it('refuses an end before the start', () => {
    expect(customRangeErrors('2026-11-15', '2026-11-09', TODAY)).toEqual({
      to: "The end date can't be before the start.",
    });
  });

  it('refuses more than 366 days', () => {
    expect(customRangeErrors('2025-11-19', '2026-11-20', TODAY)).toEqual({
      to: "The range can't be longer than 366 days.",
    });
    expect(customRangeErrors('2025-11-20', '2026-11-20', TODAY)).toEqual({});
  });

  it('refuses dates after today', () => {
    expect(customRangeErrors('2026-11-21', '2026-11-22', TODAY)).toEqual({
      from: "Dates can't be after today.",
      to: "Dates can't be after today.",
    });
    expect(customRangeErrors('2026-11-16', '2026-11-21', TODAY)).toEqual({
      to: "Dates can't be after today.",
    });
  });

  it('accepts a good range', () => {
    expect(customRangeErrors('2026-11-03', '2026-11-12', TODAY)).toEqual({});
  });

  it('knows real dates', () => {
    expect(isIsoDate('2026-11-20')).toBe(true);
    expect(isIsoDate('2026-02-29')).toBe(false);
    expect(isIsoDate('2028-02-29')).toBe(true);
    expect(isIsoDate('20261120')).toBe(false);
  });
});
