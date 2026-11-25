import { describe, expect, it } from 'vitest';
import { isOrderPage } from './request-path';

describe('isOrderPage (F8 lead decision 1)', () => {
  it("matches an order's own page only", () => {
    expect(isOrderPage('/orders/0b6c3b5e-1111-4a5b-9c9d-123456789abc')).toBe(true);
    expect(isOrderPage('/orders/abc?from=checkout')).toBe(true);
    expect(isOrderPage('/orders/abc/')).toBe(true);
    expect(isOrderPage('/account/orders')).toBe(false);
    expect(isOrderPage('/orders')).toBe(false);
    expect(isOrderPage('/menu')).toBe(false);
    expect(isOrderPage(null)).toBe(false);
  });
});
