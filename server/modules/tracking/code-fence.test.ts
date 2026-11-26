import { describe, expect, it, vi } from 'vitest';
import { AppError, invalidInput } from '@/server/errors';
import type { Attempt, LimitCheck } from '@/server/security/rate-limit';
import { type CheckedCode, withCodeFence } from './code-fence';

const down = async (): Promise<Attempt> => {
  throw new AppError('UNAVAILABLE', "We can't check codes right now.", 503);
};

/*
 * The delivery code's second fence (gate S9): only wrong tries keep their `delivery.otp`
 * point, so a sixth right code in 15 minutes is never refused; the limiter stays fail-closed.
 */

function fence() {
  const refund = vi.fn<() => Promise<void>>(async () => {});
  const taken: LimitCheck[][] = [];
  const take = vi.fn<(checks: readonly LimitCheck[]) => Promise<Attempt>>(async (checks) => {
    taken.push([...checks]);
    return { consumed: 1, refund };
  });
  return { refund, take, taken };
}

describe('the delivery code fence (L6.3, gate S9)', () => {
  it('takes one delivery.otp point per try, keyed by the courier', async () => {
    const { take, taken } = fence();
    await withCodeFence(
      'user-1',
      async () => ({ result: { outcome: 'wrong', triesLeft: 4 }, counts: true }),
      take,
    );
    expect(taken).toEqual([[{ policy: 'delivery.otp', key: 'user:user-1' }]]);
  });

  it('gives the point back for a right code', async () => {
    const { take, refund } = fence();
    const result = await withCodeFence(
      'user-1',
      async () => ({
        result: { outcome: 'delivered', payWords: 'Order 1042 delivered · You earned $7.64' },
        counts: false,
      }),
      take,
    );
    expect(result.outcome).toBe('delivered');
    expect(refund).toHaveBeenCalledTimes(1);
  });

  it('keeps the point for a wrong code', async () => {
    const { take, refund } = fence();
    await withCodeFence(
      'user-1',
      async () => ({ result: { outcome: 'wrong', triesLeft: 3 }, counts: true }),
      take,
    );
    expect(refund).not.toHaveBeenCalled();
  });

  it('gives the point back for a right code without the cash tick', async () => {
    const { take, refund } = fence();
    const message = 'Tick this once you have the cash.';
    await expect(
      withCodeFence(
        'user-1',
        async () => {
          throw invalidInput(message, { cashCollected: [message] });
        },
        take,
      ),
    ).rejects.toBeInstanceOf(AppError);
    expect(refund).toHaveBeenCalledTimes(1);
  });

  it('stays fail-closed: a refused point means the code is never checked', async () => {
    const check = vi.fn<() => Promise<CheckedCode>>();
    await expect(withCodeFence('user-1', check, down)).rejects.toMatchObject({ status: 503 });
    expect(check).not.toHaveBeenCalled();
  });
});
