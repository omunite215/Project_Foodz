import type { Route } from 'next';
import { isSitePath } from '@/lib/navigation';
import {
  defaultDir,
  type PartnerListQuery,
  type PartnerSort,
  type PartnerTab,
  TAB_SORTS,
} from '@/server/modules/partners/review-schema';

/*
 * The Partners list lives in its address (F6 A19.6): tab, search, filters, sort and page, so a
 * reload, Back and a shared link show the same list. Defaults are left out to keep it short.
 */

export const LIST_PATH: Route = '/admin/partners';

/** The address of `query`, with only what differs from the tab's defaults. */
export function listHref(query: PartnerListQuery): Route {
  const params = new URLSearchParams();
  params.set('tab', query.tab);
  if (query.q) params.set('q', query.q);
  if (query.vehicle) params.set('vehicle', query.vehicle.toLowerCase());
  if (query.flags) params.set('flags', '1');
  const defaultSort = TAB_SORTS[query.tab][0];
  if (query.sort !== defaultSort || query.dir !== defaultDir(query.tab)) {
    params.set('sort', query.sort);
    params.set('dir', query.dir);
  }
  if (query.page > 1) params.set('page', String(query.page));
  const href = `${LIST_PATH}?${params.toString()}`;
  return isSitePath(href) ? href : LIST_PATH;
}

/**
 * Another tab: search and filters stay, the page goes back to 1 and the tab keeps its own sort
 * (A19.7).
 */
export const withTab = (query: PartnerListQuery, tab: PartnerTab): PartnerListQuery => ({
  ...query,
  tab,
  page: 1,
  sort: TAB_SORTS[tab][0],
  dir: defaultDir(tab),
});

/** A filter or search changed: back to page 1. */
export const withFilters = (
  query: PartnerListQuery,
  patch: Partial<Pick<PartnerListQuery, 'q' | 'vehicle' | 'flags'>>,
): PartnerListQuery => ({ ...query, ...patch, page: 1 });

/** A sort header pressed: the same column flips its direction; another starts at its default. */
export function withSort(query: PartnerListQuery, sort: PartnerSort): PartnerListQuery {
  if (query.sort === sort) return { ...query, dir: query.dir === 'asc' ? 'desc' : 'asc', page: 1 };
  const dir =
    sort === 'name' ? 'asc' : sort === TAB_SORTS[query.tab][0] ? defaultDir(query.tab) : 'desc';
  return { ...query, sort, dir, page: 1 };
}

export const withPage = (query: PartnerListQuery, page: number): PartnerListQuery => ({
  ...query,
  page,
});

export const hasFilters = (query: PartnerListQuery) =>
  Boolean(query.q) || query.vehicle !== null || query.flags;

/** A search shorter than this isn't sent (A19.6). */
export const MIN_SEARCH = 2;

/**
 * One application's staff address, by its id (never a plate or a name). Opened from the list,
 * it carries the list's query (tab, search, filters, sort, page), so "Back to partners" returns
 * to the same list (A20.1); the application page reads it back with `listQueryFromSearch`.
 */
export function applicationHref(partnerId: string, list?: PartnerListQuery | null): Route {
  const search = list ? (listHref(list).split('?')[1] ?? '') : '';
  const href = `${LIST_PATH}/${partnerId}${search ? `?${search}` : ''}`;
  return isSitePath(href) ? href : LIST_PATH;
}
