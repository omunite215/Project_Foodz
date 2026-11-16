import { hasControlCharacters } from './text';

/**
 * Where to send someone after signing in, signing up, confirming an email or resetting a
 * password. Only plain paths on this site are accepted; anything else goes to the fallback.
 * Shared by the browser and the server, so both apply exactly the same rule.
 */

const MAX_LENGTH = 512;
const BASE = 'http://site.invalid';

/** Pages a return path must never point at (they would loop or re-run an auth step). */
export const AUTH_PAGES = [
  '/sign-in',
  '/sign-up',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
] as const;

/** An auth page or anything under it (`/sign-in/two-factor`), or the API. */
const isAuthOrApi = (pathname: string) => {
  const path = pathname.toLowerCase().replace(/\/+$/, '') || '/';
  return ['/api', ...AUTH_PAGES].some((page) => path === page || path.startsWith(`${page}/`));
};

// No whitespace, control characters or backslashes anywhere.
const hasForbiddenCharacters = (value: string) =>
  /[\s\\]/.test(value) || hasControlCharacters(value);

export function safeRedirectPath(raw: unknown, fallback = '/'): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_LENGTH) return fallback;
  if (!raw.startsWith('/') || raw.startsWith('//') || hasForbiddenCharacters(raw)) {
    return fallback;
  }

  // Percent-encoded slashes or backslashes could become "//host" or "/\host" once a browser or
  // framework decodes the path.
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return fallback;
  }
  if (decoded.startsWith('//') || hasForbiddenCharacters(decoded)) return fallback;

  let url: URL;
  try {
    url = new URL(raw, BASE);
  } catch {
    return fallback;
  }
  if (url.origin !== BASE || isAuthOrApi(url.pathname) || isAuthOrApi(decoded.split(/[?#]/)[0]!)) {
    return fallback;
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

function withReturnPath(page: string, returnPath: unknown) {
  const path = safeRedirectPath(returnPath);
  return path === '/' ? page : `${page}?callbackUrl=${encodeURIComponent(path)}`;
}

/** Where a confirm-email link lands: send it as `callbackURL` on sign-up, resend and change. */
export const verifyEmailLanding = (returnPath: unknown) =>
  withReturnPath('/verify-email', returnPath);

/** Where a reset link lands: send it as `redirectTo` on a reset request. */
export const resetPasswordLanding = (returnPath: unknown) =>
  withReturnPath('/reset-password', returnPath);

/** The sign-in page, coming back to `returnPath` afterwards. */
export const signInPath = (returnPath: unknown) => withReturnPath('/sign-in', returnPath);

/**
 * Checks a landing URL for an email link (`/verify-email?callbackUrl=…`) and rebuilds it from
 * its safe parts, so nothing else can ride along in the link.
 */
export function landingFor(page: '/verify-email' | '/reset-password', raw: unknown): string {
  if (typeof raw !== 'string' || raw.length > MAX_LENGTH) return page;
  let url: URL;
  try {
    url = new URL(raw, BASE);
  } catch {
    return page;
  }
  if (url.origin !== BASE || url.pathname !== page) return page;
  return withReturnPath(page, url.searchParams.get('callbackUrl'));
}
