import { afterAll, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/server/errors';
import { redis } from '@/server/redis';
import { enforceRateLimit, formatWait, takeAttempt } from '@/server/security/rate-limit';

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

  it('waits for a fresh connection instead of refusing the first request (cold start)', async () => {
    // A new server instance: fresh modules, so a brand-new client that is still connecting.
    globalThis.foodzRedis = undefined;
    vi.resetModules();
    const fresh = await import('@/server/security/rate-limit');
    const freshRedis = (await import('@/server/redis')).redis;
    expect(freshRedis.status).not.toBe('ready');

    // Sign-in limits fail closed, so treating "still connecting" as an outage would mean a 429.
    await expect(
      fresh.enforceRateLimit('auth.sign-in.ip', `test:${crypto.randomUUID()}`),
    ).resolves.toBeUndefined();
    await freshRedis.quit();
  });
});

describe('refundable attempts', () => {
  it('gives a point back when the request turns out not to count', async () => {
    const key = `test:${crypto.randomUUID()}`;
    for (let i = 0; i < 10; i++) {
      const attempt = await takeAttempt('auth.sign-in.email', key);
      expect(attempt.consumed).toBe(1);
      await attempt.refund();
      // A second refund of the same attempt does nothing.
      await attempt.refund();
    }
  });

  it('blocks for the policy period and says how long, in words', async () => {
    const key = `test:${crypto.randomUUID()}`;
    for (let i = 0; i < 5; i++) await takeAttempt('auth.sign-in.email', key);
    const blocked = await takeAttempt('auth.sign-in.email', key).catch((error: unknown) => error);
    expect(blocked).toMatchObject({
      code: 'RATE_LIMITED',
      status: 429,
      message: 'Too many attempts. Try again in 5 minutes, or reset your password.',
    });
    expect((blocked as AppError).retryAfterSeconds).toBeGreaterThan(290);
  });

  it('formats waits as people say them', () => {
    expect(formatWait(0.2)).toBe('1 second');
    expect(formatWait(45)).toBe('45 seconds');
    expect(formatWait(60)).toBe('1 minute');
    expect(formatWait(61)).toBe('2 minutes');
    expect(formatWait(600)).toBe('10 minutes');
    expect(formatWait(3600)).toBe('1 hour');
  });
});

describe('when the limiter is down', () => {
  it('refuses sign-in with a message that does not blame the person, and lets other things through', async () => {
    globalThis.foodzRedis = undefined;
    vi.resetModules();
    const previous = process.env.REDIS_URL;
    // A closed port: every connection attempt is refused.
    process.env.REDIS_URL = 'redis://127.0.0.1:1';
    try {
      const fresh = await import('@/server/security/rate-limit');
      const down = await fresh
        .takeAttempt('auth.sign-in.ip', 'ip:test')
        .catch((error: unknown) => error);
      expect(down).toMatchObject({
        code: 'UNAVAILABLE',
        status: 503,
        message: "We can't sign you in right now. Please try again in a minute.",
      });
      await expect(fresh.enforceRateLimit('menu.check', 'ip:test')).resolves.toBeUndefined();
      const freshRedis = (await import('@/server/redis')).redis;
      freshRedis.disconnect();
    } finally {
      process.env.REDIS_URL = previous;
      globalThis.foodzRedis = undefined;
    }
  }, 20_000);
});
