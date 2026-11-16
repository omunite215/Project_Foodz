import { describe, expect, it } from 'vitest';
import { authRequestAllowed } from './guards';

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
    expect(authRequestAllowed({ method: 'POST', pathname: '/api/auth/admin/ban-user', user })).toBe(
      false,
    );
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

describe('demo accounts', () => {
  it.each(['/api/auth/sign-in/email', '/api/auth/sign-out'])('may POST %s', (pathname) => {
    expect(authRequestAllowed({ method: 'POST', pathname, user: demo })).toBe(true);
  });

  it.each([
    '/api/auth/change-password',
    '/api/auth/change-email',
    '/api/auth/update-user',
    '/api/auth/delete-user',
    '/api/auth/two-factor/enable',
    '/api/auth/revoke-sessions',
    '/api/auth/revoke-other-sessions',
    '/api/auth/link-social',
  ])('may not POST %s', (pathname) => {
    expect(authRequestAllowed({ method: 'POST', pathname, user: demo })).toBe(false);
    expect(authRequestAllowed({ method: 'post', pathname, user: demo })).toBe(false);
  });

  it('may read their session', () => {
    expect(
      authRequestAllowed({ method: 'GET', pathname: '/api/auth/get-session', user: demo }),
    ).toBe(true);
  });
});

describe('everyone else', () => {
  it('is not affected outside the admin endpoints', () => {
    expect(
      authRequestAllowed({ method: 'POST', pathname: '/api/auth/change-password', user: customer }),
    ).toBe(true);
    expect(
      authRequestAllowed({ method: 'POST', pathname: '/api/auth/sign-up/email', user: null }),
    ).toBe(true);
  });
});
