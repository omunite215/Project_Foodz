import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashKeyDistinct } from './key-checks';
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

  it('refuses the encryption key used as the hash key', () => {
    const same = randomBytes(32).toString('base64');
    expect(hashKeyDistinct({ ID_NUMBER_HASH_KEY: same, FIELD_ENCRYPTION_KEY: same })).toBe(false);
    expect(
      hashKeyDistinct({
        ID_NUMBER_HASH_KEY: same,
        FIELD_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
      }),
    ).toBe(true);
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
