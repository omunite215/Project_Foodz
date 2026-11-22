import { describe, expect, it } from 'vitest';
import { CUSTOMER_CANCEL_LINES, reorderInput, STEP_KEYS } from './progress-schema';

describe('reorderInput (S7.5, S7.6)', () => {
  it('takes an order id only', () => {
    const orderId = '0196a1b2-0000-7000-8000-000000000001';
    expect(reorderInput.parse({ orderId })).toEqual({ orderId });
    expect(reorderInput.safeParse({ orderId: 'S1001' }).success).toBe(false);
    expect(reorderInput.safeParse({ orderId, lines: [] }).success).toBe(false);
    expect(reorderInput.safeParse({}).success).toBe(false);
  });
});

describe('customer words', () => {
  it('has the six steps in order (S1.1)', () => {
    expect(STEP_KEYS).toEqual([
      'placed',
      'accepted',
      'preparing',
      'ready',
      'pickedUp',
      'delivered',
    ]);
  });

  it('never keys a cancellation line by a staff word (S5.6)', () => {
    expect(CUSTOMER_CANCEL_LINES.join(' ')).not.toMatch(/fraud|refus|staff|kitchen/i);
  });
});
