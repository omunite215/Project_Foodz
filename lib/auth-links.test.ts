import { describe, expect, it } from 'vitest';
import {
  authPageHref,
  confirmedContinue,
  isAuthPage,
  returnPathFor,
  returnRoute,
  sessionEndedHref,
} from './auth-links';

describe('returnPathFor', () => {
  it('returns to the page the person is on, query included', () => {
    expect(returnPathFor('/menu/bulgogi', '')).toBe('/menu/bulgogi');
    expect(returnPathFor('/menu', 'cuisine=thai')).toBe('/menu?cuisine=thai');
    expect(returnPathFor('/', '')).toBe('/');
  });

  it('keeps the return path already carried by a sign-in page', () => {
    expect(returnPathFor('/sign-in', 'callbackUrl=%2Faccount%2Faddresses')).toBe(
      '/account/addresses',
    );
    expect(returnPathFor('/sign-up', 'callbackUrl=%2F%2Fevil.example')).toBe('/');
    expect(returnPathFor('/sign-in/two-factor', 'callbackUrl=%2Fmenu')).toBe('/menu');
    // An auth page never becomes its own return path.
    expect(returnPathFor('/forgot-password', '')).toBe('/');
  });
});

describe('confirmedContinue (S3.2, F6 P1.3)', () => {
  it('sends someone applying to deliver on with their application, in its own words', () => {
    const apply = {
      href: '/partner/apply',
      label: 'Continue',
      line: 'Carry on with your application.',
    };
    expect(confirmedContinue('/partner/apply')).toEqual(apply);
    expect(confirmedContinue('/partner/apply?step=1')).toEqual(apply);
    expect(confirmedContinue('/partnership')).not.toEqual(apply);
  });

  it('continues where the person was going', () => {
    expect(confirmedContinue('/menu/bulgogi')).toEqual({
      href: '/menu/bulgogi',
      label: 'Continue',
      line: "You're ready to order.",
    });
  });

  it('offers the menu when they were going nowhere in particular, or somewhere unsafe', () => {
    const menu = { href: '/menu', label: 'Continue to the menu', line: "You're ready to order." };
    expect(confirmedContinue('/')).toEqual(menu);
    expect(confirmedContinue('/menu')).toEqual(menu);
    expect(confirmedContinue(undefined)).toEqual(menu);
    expect(confirmedContinue('//evil.example')).toEqual(menu);
  });
});

describe('authPageHref', () => {
  it('carries a clean return path', () => {
    expect(authPageHref('/sign-in', '/menu?cuisine=thai')).toBe(
      '/sign-in?callbackUrl=%2Fmenu%3Fcuisine%3Dthai',
    );
    expect(authPageHref('/sign-up', '/')).toBe('/sign-up');
  });

  it.each([
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    '%2F%2Fevil.example',
    'javascript:alert(1)',
    'http://localhost:3456/menu',
    '/sign-in',
    '/api/auth/get-session',
  ])('drops an unsafe return path: %s', (unsafe) => {
    expect(authPageHref('/sign-in', unsafe)).toBe('/sign-in');
  });

  it('types a cleaned path for the router', () => {
    expect(returnRoute('//evil.example')).toBe('/');
    expect(returnRoute('/account?resend=1')).toBe('/account?resend=1');
  });
});

describe('sessionEndedHref', () => {
  it('signs in again with the reason, and comes back to the form (S2.12)', () => {
    expect(sessionEndedHref('/account')).toBe(
      '/sign-in?callbackUrl=%2Faccount&notice=session-ended',
    );
    expect(sessionEndedHref('/account/addresses/new')).toBe(
      '/sign-in?callbackUrl=%2Faccount%2Faddresses%2Fnew&notice=session-ended',
    );
  });

  it('cleans the return path like every other sign-in link', () => {
    expect(sessionEndedHref('//evil.example')).toBe('/sign-in?notice=session-ended');
    expect(sessionEndedHref('/')).toBe('/sign-in?notice=session-ended');
  });
});

describe('isAuthPage', () => {
  it('knows the sign-in pages and the steps under them', () => {
    for (const page of ['/sign-in', '/sign-in/two-factor', '/reset-password', '/Sign-Up']) {
      expect(isAuthPage(page)).toBe(true);
    }
    for (const page of ['/', '/account', '/sign-inside', '/menu']) {
      expect(isAuthPage(page)).toBe(false);
    }
  });
});
