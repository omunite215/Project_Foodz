import { describe, expect, it } from 'vitest';
import {
  parsePendingFavorite,
  PENDING_FAVORITE_MS,
  pendingFavoriteStep,
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
