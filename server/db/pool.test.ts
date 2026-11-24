import { describe, expect, it } from 'vitest';
import { poolMax } from './pool';

describe('poolMax', () => {
  it('uses the configured size', () => {
    expect(poolMax('25')).toBe(25);
  });

  it('falls back to 10 when unset, empty or not a positive whole number', () => {
    for (const value of [undefined, '', '0', '-3', '2.5', 'many']) {
      expect(poolMax(value)).toBe(10);
    }
  });
});
