import { describe, expect, it } from 'vitest';
import { deliveryCodeContext, deliveryCodeHash } from './code-hash';

const KEY = Buffer.alloc(32, 7).toString('base64');

describe('the delivery code hash (F8 §4)', () => {
  it('is 64 hex characters, the same for the same delivery and code, different elsewhere', () => {
    const hash = deliveryCodeHash('d1', '4071', KEY);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(deliveryCodeHash('d1', '4071', KEY)).toBe(hash);
    expect(deliveryCodeHash('d2', '4071', KEY)).not.toBe(hash);
    expect(deliveryCodeHash('d1', '4072', KEY)).not.toBe(hash);
    expect(deliveryCodeHash('d1', '4071', Buffer.alloc(32, 8).toString('base64'))).not.toBe(hash);
  });

  it('refuses a missing or short key and binds encryption to the delivery', () => {
    expect(() => deliveryCodeHash('d1', '4071', '')).toThrow(/32 bytes/);
    expect(deliveryCodeContext('d1')).toBe('deliveries.otp:d1');
  });
});
