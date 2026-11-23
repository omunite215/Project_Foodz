import { describe, expect, it } from 'vitest';
import { listQueryFromSearch } from '@/server/modules/partners/review-schema';
import { hasFilters, listHref, withFilters, withPage, withSort, withTab } from './url';

const base = listQueryFromSearch({});

describe('the list address', () => {
  it('keeps defaults out', () => {
    expect(listHref(base)).toBe('/admin/partners?tab=review');
  });

  it('round-trips search, filters, sort and page', () => {
    const query = withPage(
      withSort(withFilters(base, { q: '6vh', vehicle: 'CAR', flags: true }), 'name'),
      2,
    );
    const href = listHref(query);
    expect(href).toBe(
      '/admin/partners?tab=review&q=6vh&vehicle=car&flags=1&sort=name&dir=asc&page=2',
    );
    const parsed = listQueryFromSearch(
      Object.fromEntries(new URL(href, 'http://localhost').searchParams),
    );
    expect(parsed).toEqual(query);
  });

  it('keeps search and filters on another tab, with its own sort and page 1', () => {
    const query = withTab(withPage(withFilters(base, { flags: true }), 3), 'approved');
    expect(query).toMatchObject({
      tab: 'approved',
      flags: true,
      page: 1,
      sort: 'decided',
      dir: 'desc',
    });
  });

  it('flips the direction of the current sort', () => {
    expect(withSort(base, 'sent').dir).toBe('desc');
    expect(withSort(base, 'name').dir).toBe('asc');
  });

  it('knows when anything filters the list', () => {
    expect(hasFilters(base)).toBe(false);
    expect(hasFilters(withFilters(base, { vehicle: 'BICYCLE' }))).toBe(true);
  });
});
