/**
 * The request header the proxy sets to the path and query a page was asked for. Read to build a
 * sign-in return path, which safeRedirectPath() cleans, and to leave the announcement bar off an
 * order's page; a forged value can do no harm (at worst a banner hides).
 */
export const REQUEST_PATH_HEADER = 'x-foodz-path';

/** `/orders/<id>`, with or without a query; the orders list keeps the bar. */
export function isOrderPage(path: string | null): boolean {
  const pathname = (path ?? '').split('?')[0] ?? '';
  return /^\/orders\/[^/]+\/?$/.test(pathname);
}
