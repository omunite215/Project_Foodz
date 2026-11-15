import 'server-only';
import { RateLimiterRedis, RateLimiterRes } from 'rate-limiter-flexible';
import { rateLimited } from '@/server/errors';
import { logger } from '@/server/logger';
import { redis } from '@/server/redis';

/** Requests allowed per window, keyed by caller (user id or IP). */
const POLICIES = {
  'auth.sign-in': { points: 5, duration: 60, blockDuration: 300 },
  'auth.sign-up': { points: 3, duration: 600 },
  'auth.password-reset': { points: 3, duration: 900 },
  'auth.default': { points: 30, duration: 60 },
  'coupon.check': { points: 10, duration: 60 },
  'contact.submit': { points: 3, duration: 600 },
  'support.create': { points: 5, duration: 3600 },
  'delivery.otp': { points: 5, duration: 900 },
  'partner.location': { points: 1, duration: 2 },
  'realtime.auth': { points: 60, duration: 60 },
  search: { points: 60, duration: 60 },
  'action.default': { points: 60, duration: 60 },
} as const;

export type RateLimitPolicy = keyof typeof POLICIES;

const limiters = new Map<RateLimitPolicy, RateLimiterRedis>();

function limiterFor(policy: RateLimitPolicy) {
  let limiter = limiters.get(policy);
  if (!limiter) {
    limiter = new RateLimiterRedis({
      storeClient: redis,
      keyPrefix: `rl:${policy}`,
      useRedisPackage: false,
      ...POLICIES[policy],
    });
    limiters.set(policy, limiter);
  }
  return limiter;
}

// Limits that guard against guessing stay closed if Redis is unreachable; the rest fail open
// so a cache outage does not take the whole site down.
const FAIL_CLOSED: ReadonlySet<RateLimitPolicy> = new Set([
  'auth.sign-in',
  'auth.password-reset',
  'delivery.otp',
  'coupon.check',
]);

/** Consumes one point; throws a 429 AppError when the caller is over the limit. */
export async function enforceRateLimit(policy: RateLimitPolicy, key: string) {
  try {
    await limiterFor(policy).consume(key);
  } catch (error) {
    if (error instanceof RateLimiterRes) throw rateLimited();
    logger.warn({ err: error, policy }, 'rate limiter unavailable');
    if (FAIL_CLOSED.has(policy)) throw rateLimited();
  }
}
