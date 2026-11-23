import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { idNumberHash } from './keyed-hash';

describe('idNumberHash', () => {
  const key = randomBytes(32);

  it('gives the same number the same value and different numbers different ones', () => {
    expect(idNumberHash('S48204821', key)).toBe(idNumberHash('S48204821', key));
    expect(idNumberHash('S48204821', key)).not.toBe(idNumberHash('S48204822', key));
  });

  it('depends on the key and never contains the number', () => {
    expect(idNumberHash('S48204821', key)).not.toBe(idNumberHash('S48204821', randomBytes(32)));
    expect(idNumberHash('S48204821', key)).not.toContain('4821');
  });

  it('refuses to run without its key', () => {
    const saved = process.env.ID_NUMBER_HASH_KEY;
    delete process.env.ID_NUMBER_HASH_KEY;
    try {
      expect(() => idNumberHash('S48204821')).toThrow(/ID_NUMBER_HASH_KEY/);
    } finally {
      if (saved !== undefined) process.env.ID_NUMBER_HASH_KEY = saved;
    }
  });
});
