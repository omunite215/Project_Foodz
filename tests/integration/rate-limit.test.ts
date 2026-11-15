import { afterAll, describe, expect, it } from 'vitest';
import { AppError } from '@/server/errors';
import { redis } from '@/server/redis';
import { enforceRateLimit } from '@/server/security/rate-limit';

afterAll(() => redis.quit());

describe('rate limiting', () => {
  it('allows the configured number of attempts, then refuses with 429', async () => {
    const key = `test:${crypto.randomUUID()}`;
    for (let i = 0; i < 5; i++) await enforceRateLimit('delivery.otp', key);

    const blocked = await enforceRateLimit('delivery.otp', key).catch((error: unknown) => error);
    expect(blocked).toBeInstanceOf(AppError);
    expect(blocked).toMatchObject({ status: 429 });
  });

  it('keeps separate counters per caller', async () => {
    const first = `test:${crypto.randomUUID()}`;
    const second = `test:${crypto.randomUUID()}`;
    for (let i = 0; i < 5; i++) await enforceRateLimit('delivery.otp', first);
    await expect(enforceRateLimit('delivery.otp', second)).resolves.toBeUndefined();
  });
});
