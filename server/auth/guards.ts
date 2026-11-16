/**
 * Extra rules for requests to the auth library's own endpoints (/api/auth/*), which only know
 * about roles.
 *
 * - Its admin endpoints (ban, set role, sessions) need a real staff account with two-factor on.
 *   A demo admin has the admin role but must stay read-only.
 * - Demo accounts are shared by everyone trying the site, so they may sign in and out but not
 *   change their password, email, two-factor settings or other sessions.
 */

const DEMO_ALLOWED_WRITES = new Set(['/sign-in/email', '/sign-out']);

export interface AuthRequest {
  method: string;
  /** Full request path, e.g. /api/auth/admin/ban-user */
  pathname: string;
  user?: { isDemo?: boolean | null; twoFactorEnabled?: boolean | null } | null;
}

export function authRequestAllowed({ method, pathname, user }: AuthRequest): boolean {
  const path = pathname
    .replace(/\/{2,}/g, '/')
    .replace(/^\/api\/auth(?=\/)/, '')
    .replace(/\/+$/, '');

  if (path === '/admin' || path.startsWith('/admin/')) {
    return Boolean(user && !user.isDemo && user.twoFactorEnabled);
  }
  if (user?.isDemo && method.toUpperCase() !== 'GET') {
    return DEMO_ALLOWED_WRITES.has(path);
  }
  return true;
}
