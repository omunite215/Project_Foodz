import { describe, expect, it } from 'vitest';
import { retryQuote } from './quote-retry';

describe('retryQuote', () => {
  it('asks a timed-out quote once more, and only once', () => {
    expect(retryQuote(0, 'TIMEOUT')).toBe(true);
    expect(retryQuote(1, 'TIMEOUT')).toBe(false);
  });

  it('shows every other failure at once', () => {
    for (const code of [
      'RATE_LIMITED',
      'CART_TOO_BIG',
      'OFFLINE',
      'INTERNAL',
      'VALIDATION',
      null,
    ]) {
      expect(retryQuote(0, code)).toBe(false);
    }
  });
});
