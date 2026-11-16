/**
 * Which of the auth library's own endpoints (/api/auth/*) may be called over HTTP, and by whom.
 *
 * Sign-in, sign-up, password reset, email confirmation requests, email and password changes
 * and the two-factor step go through Server Actions (server/modules/auth), which add rate
 * limits, Turnstile and audit. Over HTTP only what the browser itself must reach stays open:
 * the session read, sign-out, Google sign-in and its callback, and the links in emails.
 *
 * - Admin endpoints need a real staff account with two-factor on; the demo admin is read-only.
 * - Demo accounts are shared by everyone trying the site, so they may only read their session,
 *   follow links and sign out.
 */

export type AuthDecision = 'allow' | 'not-found' | 'forbidden' | 'demo-read-only';

interface Endpoint {
  methods: readonly string[];
  path: RegExp;
  /** Whether the shared demo accounts may call it. */
  demo: boolean;
}

const ENDPOINTS: readonly Endpoint[] = [
  { methods: ['GET'], path: /^\/get-session$/, demo: true },
  { methods: ['GET'], path: /^\/ok$/, demo: true },
  { methods: ['GET'], path: /^\/error$/, demo: true },
  { methods: ['GET'], path: /^\/verify-email$/, demo: true },
  { methods: ['GET'], path: /^\/reset-password\/[^/]+$/, demo: true },
  { methods: ['GET', 'POST'], path: /^\/callback\/[^/]+$/, demo: true },
  { methods: ['POST'], path: /^\/sign-out$/, demo: true },
  { methods: ['POST'], path: /^\/sign-in\/social$/, demo: true },
  { methods: ['GET'], path: /^\/list-accounts$/, demo: false },
  { methods: ['POST'], path: /^\/link-social$/, demo: false },
  { methods: ['POST'], path: /^\/unlink-account$/, demo: false },
];

export interface AuthRequest {
  method: string;
  /** Full request path, e.g. /api/auth/admin/ban-user */
  pathname: string;
  user?: { isDemo?: boolean | null; twoFactorEnabled?: boolean | null } | null;
}

/** The endpoint path inside /api/auth, with doubled and trailing slashes removed. */
export function authPath(pathname: string) {
  return (
    pathname
      .replace(/\/{2,}/g, '/')
      .replace(/^\/api\/auth(?=\/|$)/, '')
      .replace(/\/+$/, '') || '/'
  );
}

export function authRequestDecision({ method, pathname, user }: AuthRequest): AuthDecision {
  const path = authPath(pathname);
  const verb = method.toUpperCase();

  if (path === '/admin' || path.startsWith('/admin/')) {
    return user && !user.isDemo && user.twoFactorEnabled ? 'allow' : 'forbidden';
  }
  const endpoint = ENDPOINTS.find((e) => e.path.test(path) && e.methods.includes(verb));
  if (!endpoint) return 'not-found';
  if (user?.isDemo && !endpoint.demo) return 'demo-read-only';
  return 'allow';
}

/** Kept for callers that only need yes or no. */
export function authRequestAllowed(request: AuthRequest): boolean {
  return authRequestDecision(request) === 'allow';
}
