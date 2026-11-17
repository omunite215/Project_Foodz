import { describe, expect, it } from 'vitest';
import { authPageHref, returnPathFor, returnRoute } from './auth-links';

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
