import { describe, expect, it } from 'vitest';
import {
  landingFor,
  resetPasswordLanding,
  safeRedirectPath,
  signInPath,
  verifyEmailLanding,
} from './redirect';

describe('safeRedirectPath', () => {
  it.each([
    ['/menu/bulgogi', '/menu/bulgogi'],
    ['/menu?cuisine=thai', '/menu?cuisine=thai'],
    ['/account/addresses', '/account/addresses'],
    ['/', '/'],
    ['/menu#reviews', '/menu#reviews'],
    ['/blog/caf%C3%A9', '/blog/caf%C3%A9'],
  ])('keeps the site path %j', (raw, expected) => {
    expect(safeRedirectPath(raw)).toBe(expected);
  });

  it.each([
    undefined,
    null,
    '',
    42,
    ['/menu'],
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    '\\\\evil.example',
    '%2F%2Fevil.example',
    '/%2F%2Fevil.example',
    '/%5Cevil.example',
    '/%5cevil.example',
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'http://localhost:3456/menu',
    'menu',
    '/menu evil',
    '/menu\nLocation: https://evil.example',
    '/menu\t',
    `/${'a'.repeat(520)}`,
    '/%E0%A4%A',
  ])('sends %j home', (raw) => {
    expect(safeRedirectPath(raw)).toBe('/');
  });

  it.each([
    '/sign-in',
    '/sign-in/',
    '/sign-in?callbackUrl=/menu',
    '/sign-in/two-factor',
    '/sign-in/two-factor/',
    '/sign-in/two-factor?callbackUrl=%2Fmenu',
    '/Sign-In/Two-Factor',
    '/sign-in/%74wo-factor',
    '/sign-up/anything',
    '/verify-email/extra',
    '/sign-up',
    '/SIGN-UP',
    '/forgot-password',
    '/reset-password',
    '/reset-password?token=abc',
    '/verify-email',
    '/api',
    '/api/auth/sign-out',
    '/API/auth',
  ])('never returns to the auth page or API %j', (raw) => {
    expect(safeRedirectPath(raw)).toBe('/');
  });

  it('uses the fallback when given', () => {
    expect(safeRedirectPath('//evil.example', '/account')).toBe('/account');
  });

  it('accepts look-alike paths that are not auth pages', () => {
    expect(safeRedirectPath('/sign-in-help')).toBe('/sign-in-help');
    expect(safeRedirectPath('/apiary')).toBe('/apiary');
  });
});

describe('landing pages for email links', () => {
  it('carries a safe return path', () => {
    expect(verifyEmailLanding('/menu/bulgogi')).toBe('/verify-email?callbackUrl=%2Fmenu%2Fbulgogi');
    expect(resetPasswordLanding('/menu?cuisine=thai')).toBe(
      '/reset-password?callbackUrl=%2Fmenu%3Fcuisine%3Dthai',
    );
    expect(signInPath('/account/addresses')).toBe('/sign-in?callbackUrl=%2Faccount%2Faddresses');
  });

  it('drops an unsafe or missing return path', () => {
    expect(verifyEmailLanding('https://evil.example')).toBe('/verify-email');
    expect(resetPasswordLanding(undefined)).toBe('/reset-password');
    expect(signInPath('/')).toBe('/sign-in');
  });
});

describe('landingFor', () => {
  it('rebuilds a landing URL from its safe parts', () => {
    expect(landingFor('/verify-email', '/verify-email?callbackUrl=%2Fmenu&evil=1')).toBe(
      '/verify-email?callbackUrl=%2Fmenu',
    );
    expect(landingFor('/reset-password', '/reset-password')).toBe('/reset-password');
  });

  it.each([
    'https://evil.example/verify-email',
    '//evil.example/verify-email',
    '/menu',
    '/verify-email?callbackUrl=https%3A%2F%2Fevil.example',
    '/verify-email?callbackUrl=%2Fsign-in',
    undefined,
  ])('falls back to the bare page for %j', (raw) => {
    expect(landingFor('/verify-email', raw)).toBe('/verify-email');
  });
});
