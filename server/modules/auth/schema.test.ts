import { describe, expect, it } from 'vitest';
import { signInReason } from './schema';

describe('sign-in reasons (F3 B13)', () => {
  it('honours only the fixed reasons, never text from the address', () => {
    expect(signInReason('checkout')).toBe('checkout');
    expect(signInReason('promo')).toBe('promo');
    expect(signInReason('favorite')).toBe('favorite');
    for (const raw of [
      'Your account is locked',
      'CHECKOUT',
      ' promo',
      '',
      undefined,
      ['promo'],
      1,
    ]) {
      expect(signInReason(raw)).toBeNull();
    }
  });
});
