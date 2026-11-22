import { describe, expect, it } from 'vitest';
import {
  cartReopenStep,
  parsePendingFavorite,
  parsePendingPromo,
  PENDING_FAVORITE_MS,
  PENDING_PROMO_MS,
  pendingFavoriteStep,
  reasonNoticeText,
  signInFor,
} from './sign-in-reason';

const DISH = '0196a1b2-0000-7000-8000-000000000004';
const NOW = 1_800_000_000_000;
const pending = { dishId: DISH, title: 'Bulgogi', path: '/menu?cuisine=korean', at: NOW };

describe('sign-in links with a reason (B13)', () => {
  it('adds the reason from the fixed list to the return path', () => {
    expect(signInFor('/sign-in', '/checkout', 'checkout')).toBe(
      '/sign-in?callbackUrl=%2Fcheckout&reason=checkout',
    );
    expect(signInFor('/sign-up', '/menu', 'favorite')).toBe(
      '/sign-up?callbackUrl=%2Fmenu&reason=favorite',
    );
    expect(signInFor('/sign-in', '/', 'promo')).toBe('/sign-in?reason=promo');
    expect(signInFor('/sign-in', 'https://evil.example', null)).toBe('/sign-in');
  });
});

describe('the cart opening again after signing in for a code (S4.8)', () => {
  it('waits on the sign-in pages, opens once signed in, and is dropped otherwise', () => {
    expect(cartReopenStep({ onAuthPage: true, signedIn: false })).toBe('keep');
    expect(cartReopenStep({ onAuthPage: true, signedIn: true })).toBe('keep');
    expect(cartReopenStep({ onAuthPage: false, signedIn: true })).toBe('open');
    expect(cartReopenStep({ onAuthPage: false, signedIn: false })).toBe('drop');
  });
});

describe('a heart tapped while signed out (design 3.2)', () => {
  it('reads only a well-formed record', () => {
    expect(parsePendingFavorite(JSON.stringify(pending))).toEqual(pending);
    expect(parsePendingFavorite(null)).toBeNull();
    expect(parsePendingFavorite('{')).toBeNull();
    expect(parsePendingFavorite(JSON.stringify({ ...pending, dishId: 'x' }))).toBeNull();
    expect(
      parsePendingFavorite(JSON.stringify({ ...pending, path: 'https://evil.example' })),
    ).toBeNull();
  });

  it('is saved once signed in, back on the same page within 15 minutes', () => {
    const at = (fields: Partial<Parameters<typeof pendingFavoriteStep>[1]>) =>
      pendingFavoriteStep(pending, {
        signedIn: true,
        path: pending.path,
        onAuthPage: false,
        now: NOW + 60_000,
        ...fields,
      });
    expect(at({})).toBe('save');
    expect(at({ onAuthPage: true, signedIn: false })).toBe('keep');
    expect(at({ signedIn: false })).toBe('drop');
    expect(at({ path: '/menu' })).toBe('drop');
    expect(at({ now: NOW + PENDING_FAVORITE_MS + 1 })).toBe('drop');
  });
});

const kept = (fields: Record<string, unknown>) =>
  JSON.stringify({ code: 'WELCOME10', at: NOW, ...fields });

describe('a code kept for the return from sign-in (S4.8)', () => {
  it('is used while it is up to 30 minutes old', () => {
    expect(parsePendingPromo(kept({}), NOW)).toBe('WELCOME10');
    expect(parsePendingPromo(kept({}), NOW + PENDING_PROMO_MS)).toBe('WELCOME10');
    // A minute of clock skew is allowed.
    expect(parsePendingPromo(kept({}), NOW - 60_000)).toBe('WELCOME10');
  });

  it('expires after 30 minutes, and from the future', () => {
    expect(parsePendingPromo(kept({}), NOW + PENDING_PROMO_MS + 1)).toBeNull();
    expect(parsePendingPromo(kept({}), NOW - 60_001)).toBeNull();
  });

  it('ignores anything malformed, and a bare code saved before it had a time', () => {
    expect(parsePendingPromo(null, NOW)).toBeNull();
    expect(parsePendingPromo('WELCOME10', NOW)).toBeNull();
    expect(parsePendingPromo('{', NOW)).toBeNull();
    expect(parsePendingPromo(kept({ code: '<b>X</b>' }), NOW)).toBeNull();
    expect(parsePendingPromo(kept({ code: 'A'.repeat(33) }), NOW)).toBeNull();
    expect(parsePendingPromo(kept({ at: 'now' }), NOW)).toBeNull();
  });
});

describe('the notice on the sign-in and sign-up forms (design 1.3)', () => {
  it('asks her to sign in on /sign-in', () => {
    expect(reasonNoticeText('promo', '/sign-in', 'WELCOME10')).toBe('Sign in to use WELCOME10.');
    expect(reasonNoticeText('promo', '/sign-in', null)).toBe('Sign in to use your promo code.');
    expect(reasonNoticeText('checkout', '/sign-in', null)).toBe(
      'Sign in to check out. Your cart is saved.',
    );
    expect(reasonNoticeText('favorite', '/sign-in', 'Bulgogi')).toBe(
      'Sign in to save Bulgogi to your favorites.',
    );
  });

  it('asks her to create an account on /sign-up', () => {
    expect(reasonNoticeText('promo', '/sign-up', 'WELCOME10')).toBe(
      'Create an account to use WELCOME10.',
    );
    expect(reasonNoticeText('checkout', '/sign-up', null)).toBe(
      'Create an account to check out. Your cart is saved.',
    );
    expect(reasonNoticeText('favorite', '/sign-up', null)).toBe(
      'Create an account to save this dish to your favorites.',
    );
  });
});
