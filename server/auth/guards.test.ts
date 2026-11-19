import { describe, expect, it } from 'vitest';
import { authPath, authRequestAllowed, authRequestDecision } from './guards';

const admin = { isDemo: false, twoFactorEnabled: true };
const adminWithoutTwoFactor = { isDemo: false, twoFactorEnabled: false };
const demo = { isDemo: true, twoFactorEnabled: false };
const customer = { isDemo: false, twoFactorEnabled: false };

describe('auth admin endpoints', () => {
  it.each([
    ['POST', '/api/auth/admin/ban-user'],
    ['POST', '/api/auth/admin/set-role'],
    ['GET', '/api/auth/admin/list-users'],
    ['POST', '/api/auth/admin/revoke-user-sessions/'],
  ])('allow %s %s for an admin with two-factor', (method, pathname) => {
    expect(authRequestAllowed({ method, pathname, user: admin })).toBe(true);
  });

  it.each([
    ['a demo admin', demo],
    ['an admin without two-factor', adminWithoutTwoFactor],
    ['a customer', customer],
    ['nobody signed in', null],
  ])('refuse %s', (_who, user) => {
    expect(
      authRequestDecision({ method: 'POST', pathname: '/api/auth/admin/ban-user', user }),
    ).toBe('forbidden');
    expect(
      authRequestAllowed({ method: 'GET', pathname: '/api/auth/admin/list-users', user }),
    ).toBe(false);
  });

  it('cannot be reached with doubled or trailing slashes', () => {
    expect(
      authRequestAllowed({ method: 'POST', pathname: '/api/auth//admin/ban-user', user: demo }),
    ).toBe(false);
    expect(
      authRequestAllowed({
        method: 'POST',
        pathname: '/api//auth/admin//set-role',
        user: adminWithoutTwoFactor,
      }),
    ).toBe(false);
    expect(authRequestAllowed({ method: 'POST', pathname: '/api/auth/admin/', user: demo })).toBe(
      false,
    );
    expect(authRequestAllowed({ method: 'POST', pathname: '/api/auth/admin', user: demo })).toBe(
      false,
    );
  });
});

describe('endpoints open over HTTP', () => {
  it.each([
    ['GET', '/api/auth/verify-email'],
    ['GET', '/api/auth/reset-password/abc123'],
    ['GET', '/api/auth/callback/google'],
    ['POST', '/api/auth/callback/google'],
    ['POST', '/api/auth/sign-out'],
    ['POST', '/api/auth/sign-in/social'],
    ['GET', '/api/auth/ok'],
  ])('allow %s %s for anyone', (method, pathname) => {
    expect(authRequestDecision({ method, pathname, user: null })).toBe('allow');
    expect(authRequestDecision({ method, pathname, user: demo })).toBe('allow');
  });

  it.each([
    // Served by Server Actions with rate limits, Turnstile and audit.
    ['POST', '/api/auth/sign-in/email'],
    ['POST', '/api/auth/sign-up/email'],
    ['POST', '/api/auth/request-password-reset'],
    ['POST', '/api/auth/reset-password'],
    ['POST', '/api/auth/send-verification-email'],
    ['POST', '/api/auth/change-email'],
    ['POST', '/api/auth/change-password'],
    ['POST', '/api/auth/two-factor/verify-totp'],
    ['POST', '/api/auth/two-factor/verify-backup-code'],
    // Replaced by the account actions.
    ['POST', '/api/auth/update-user'],
    ['POST', '/api/auth/delete-user'],
    ['GET', '/api/auth/delete-user/callback'],
    ['GET', '/api/auth/list-sessions'],
    ['POST', '/api/auth/revoke-session'],
    ['POST', '/api/auth/revoke-sessions'],
    ['POST', '/api/auth/revoke-other-sessions'],
    // Two-factor enrolment arrives in F11.
    ['POST', '/api/auth/two-factor/enable'],
    // The session (with its token) is read on the server only.
    ['GET', '/api/auth/get-session'],
    ['POST', '/api/auth/get-session'],
    // Wrong method on an open endpoint.
    ['GET', '/api/auth/sign-out'],
    ['GET', '/api/auth/nothing-here'],
  ])('refuse %s %s for everyone', (method, pathname) => {
    for (const user of [null, customer, admin, demo]) {
      expect(authRequestDecision({ method, pathname, user })).toBe('not-found');
    }
  });
});

describe('demo accounts', () => {
  it('may sign out, never read other sessions or linked accounts', () => {
    expect(
      authRequestDecision({ method: 'POST', pathname: '/api/auth/sign-out', user: demo }),
    ).toBe('allow');
    expect(
      authRequestDecision({ method: 'GET', pathname: '/api/auth/list-sessions', user: demo }),
    ).toBe('not-found');
    for (const [method, pathname] of [
      ['GET', '/api/auth/list-accounts'],
      ['POST', '/api/auth/link-social'],
      ['POST', '/api/auth/unlink-account'],
    ] as const) {
      expect(authRequestDecision({ method, pathname, user: demo })).toBe('demo-read-only');
      expect(authRequestDecision({ method, pathname, user: customer })).toBe('allow');
    }
  });

  it('treats the method case-insensitively', () => {
    expect(
      authRequestDecision({ method: 'post', pathname: '/api/auth/link-social', user: demo }),
    ).toBe('demo-read-only');
  });
});

describe('authPath', () => {
  it('normalises the path inside /api/auth', () => {
    expect(authPath('/api/auth/sign-out/')).toBe('/sign-out');
    expect(authPath('/api//auth//get-session')).toBe('/get-session');
    expect(authPath('/api/auth')).toBe('/');
  });
});
