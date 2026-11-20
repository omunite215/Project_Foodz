import type { Route } from 'next';
import { isSitePath } from './navigation';
import { AUTH_PAGES, safeRedirectPath } from './redirect';

/*
 * Links to the sign-in pages that bring the person back afterwards (S2.4). Every return path goes
 * through safeRedirectPath(), so these are always plain paths on this site.
 */

/** A sign-in, sign-up, reset or confirm page, or one under it (`/sign-in/two-factor`). */
export const isAuthPage = (pathname: string) => {
  const path = pathname.toLowerCase();
  return AUTH_PAGES.some((page) => path === page || path.startsWith(`${page}/`));
};

/** A cleaned return path, typed for the router. */
export function returnRoute(raw: unknown, fallback = '/'): Route {
  const path = safeRedirectPath(raw, fallback);
  return isSitePath(path) ? path : '/';
}

/** "/sign-in?callbackUrl=%2Fmenu" (or the bare page when the return path is Home). */
export function authPageHref(
  page: '/sign-in' | '/sign-in/two-factor' | '/sign-up' | '/forgot-password',
  returnPath: unknown,
): Route {
  const path = safeRedirectPath(returnPath);
  const href = path === '/' ? page : `${page}?callbackUrl=${encodeURIComponent(path)}`;
  return isSitePath(href) ? href : page;
}

/**
 * Sign in again after the session ended under a form (S2.12): the sign-in page says why
 * ("You've been signed out. Sign in again to save your changes.") and returns to the form.
 */
export function sessionEndedHref(returnPath: unknown): Route {
  const signIn = authPageHref('/sign-in', returnPath);
  const href = `${signIn}${signIn.includes('?') ? '&' : '?'}notice=session-ended`;
  return isSitePath(href) ? href : '/sign-in';
}

/**
 * Where "Sign in" (or "Create an account") should return to from the current page: the page
 * itself, or, on a sign-in page, the return path it already carries.
 */
export function returnPathFor(pathname: string, search: URLSearchParams | string): string {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  if (isAuthPage(pathname)) return safeRedirectPath(params.get('callbackUrl'));
  const query = params.toString();
  return safeRedirectPath(query ? `${pathname}?${query}` : pathname);
}
