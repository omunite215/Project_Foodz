import { afterAll, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/server/errors';
import { redis } from '@/server/redis';
import {
  blockedFor,
  enforceRateLimit,
  formatWait,
  limitError,
  takeAttempt,
  takeAttempts,
} from '@/server/security/rate-limit';

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

  it('never reads a wait longer than the window of its policy, whatever the clocks say', () => {
    // Redis a moment ahead of the app read a 15-minute limit as 901 s, "16 minutes".
    const late = limitError('account.delete', 900_400);
    expect(late.message).toBe('Too many attempts. Try again in 15 minutes.');
    expect(late.retryAfterSeconds).toBe(900);
    // A block outlasts its window: the block is the limit (5 minutes after a minute's tries).
    expect(limitError('auth.sign-in.email', 300_900).retryAfterSeconds).toBe(300);
    expect(limitError('account.delete', 120_000).retryAfterSeconds).toBe(120);
  });

  it('formats waits as people say them', () => {
    expect(formatWait(0.2)).toBe('1 second');
    expect(formatWait(45)).toBe('45 seconds');
    expect(formatWait(60)).toBe('1 minute');
    expect(formatWait(61)).toBe('2 minutes');
    expect(formatWait(600)).toBe('10 minutes');
    expect(formatWait(3600)).toBe('1 hour');
    // An hour-long window read a moment late never doubles (F2's download limit).
    expect(formatWait(3601)).toBe('61 minutes');
    expect(formatWait(7140)).toBe('119 minutes');
    expect(formatWait(7200)).toBe('2 hours');
    expect(formatWait(7201)).toBe('3 hours');
  });
});

/** A fresh caller's account and network keys under the promo-guessing policies. */
function keys() {
  const id = crypto.randomUUID();
  return [
    { policy: 'coupon.miss.user' as const, key: `user:${id}` },
    { policy: 'coupon.miss.ip' as const, key: `ip:${id}` },
  ];
}

describe('limits counted under several keys (per account and per network)', () => {
  it('takes a point under each key and gives them all back at once', async () => {
    const checks = keys();
    for (let i = 0; i < 20; i++) {
      const attempt = await takeAttempts(checks);
      await attempt.refund();
    }
    expect(await blockedFor(checks)).toBeNull();
  });

  it('is all or nothing: over one limit, the other keys get their point back', async () => {
    const [user, ip] = keys();
    for (let i = 0; i < 10; i++) await takeAttempts([user!, ip!]);
    const refused = await takeAttempts([user!, ip!]).catch((error: unknown) => error);
    expect(refused).toMatchObject({
      code: 'RATE_LIMITED',
      message: 'Too many codes tried. You can try again in 10 minutes.',
    });
    // The network key kept only the 10 that counted: 20 more fit before its limit of 30.
    for (let i = 0; i < 20; i++) await takeAttempt('coupon.miss.ip', ip!.key);
    await expect(takeAttempt('coupon.miss.ip', ip!.key)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
  });

  it('says whether a key is blocked, and for how long, without using a point', async () => {
    const [user, ip] = keys();
    expect(await blockedFor([user!, ip!])).toBeNull();
    for (let i = 0; i < 10; i++) await takeAttempt('coupon.miss.user', user!.key);
    // At the limit but not over it: not blocked, and asking doesn't use the last point.
    for (let i = 0; i < 5; i++) expect(await blockedFor([user!, ip!])).toBeNull();
    await takeAttempt('coupon.miss.user', user!.key).catch(() => undefined);
    const blocked = await blockedFor([user!, ip!]);
    expect(blocked).toMatchObject({ code: 'RATE_LIMITED', status: 429 });
    expect(blocked?.retryAfterSeconds).toBeGreaterThan(9 * 60);
    expect(blocked?.retryAfterSeconds).toBeLessThanOrEqual(10 * 60);
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
