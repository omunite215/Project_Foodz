import 'server-only';
import { createHash } from 'node:crypto';
import { RateLimiterRedis, RateLimiterRes } from 'rate-limiter-flexible';
import { type AppError, rateLimited, unavailable } from '@/server/errors';
import { logger } from '@/server/logger';
import { redis, waitUntilReady } from '@/server/redis';

interface Policy {
  points: number;
  /** Window in seconds. */
  duration: number;
  /** Once over the limit, refuse for this long (seconds) instead of until the window ends. */
  blockDuration?: number;
  /**
   * Guards against guessing: refuse when the limiter itself is down. Everything else fails open
   * so a cache outage does not take the site down.
   */
  failClosed?: boolean;
  /** Shown with the real wait, e.g. "Try again in {wait}." */
  message?: string;
  /** Shown when a fail-closed limiter is down. */
  unavailableMessage?: string;
}

const SIGN_IN_UNAVAILABLE = "We can't sign you in right now. Please try again in a minute.";

/** Requests allowed per window, keyed by caller (user id, email hash or IP). */
const POLICIES = {
  // Failed sign-ins only (successes are refunded); per email and per network.
  'auth.sign-in.email': {
    points: 5,
    duration: 60,
    blockDuration: 300,
    failClosed: true,
    message: 'Too many attempts. Try again in {wait}, or reset your password.',
    unavailableMessage: SIGN_IN_UNAVAILABLE,
  },
  'auth.sign-in.ip': {
    points: 20,
    duration: 60,
    blockDuration: 300,
    failClosed: true,
    message: 'Too many attempts. Try again in {wait}, or reset your password.',
    unavailableMessage: SIGN_IN_UNAVAILABLE,
  },
  // Accepted sign-ups; rejected passwords are refunded. The hard cap counts everything.
  'auth.sign-up': {
    points: 3,
    duration: 600,
    message: 'Too many sign-ups from this network. Try again in {wait}.',
  },
  'auth.sign-up.any': {
    points: 10,
    duration: 600,
    message: 'Too many sign-ups from this network. Try again in {wait}.',
  },
  'auth.password-reset.email': {
    points: 3,
    duration: 900,
    failClosed: true,
    message: 'Too many reset requests. Try again in {wait}.',
  },
  'auth.password-reset.ip': {
    points: 10,
    duration: 900,
    failClosed: true,
    message: 'Too many reset requests. Try again in {wait}.',
  },
  'auth.reset-password': {
    points: 5,
    duration: 900,
    failClosed: true,
    message: 'Too many attempts. Try again in {wait}.',
  },
  'auth.verify-email.cooldown': {
    points: 1,
    duration: 60,
    message: 'You can resend in {wait}.',
  },
  'auth.verify-email': {
    points: 5,
    duration: 3600,
    message: "You've asked for several links. You can send another in {wait}.",
  },
  'auth.change-email': {
    points: 5,
    duration: 3600,
    message: 'Too many email changes. Try again in {wait}.',
  },
  // Wrong current passwords only.
  'auth.change-password': {
    points: 5,
    duration: 900,
    failClosed: true,
    message: 'Too many attempts. Try again in {wait}.',
  },
  'auth.two-factor': {
    points: 10,
    duration: 300,
    failClosed: true,
    message: 'Too many wrong codes. Try again in {wait}.',
    unavailableMessage: SIGN_IN_UNAVAILABLE,
  },
  'auth.default': { points: 60, duration: 60 },
  // "Someone tried to sign up with your email": at most one per address per hour.
  'email.account-exists': { points: 1, duration: 3600 },
  'coupon.check': { points: 10, duration: 60, failClosed: true },
  // Price and availability re-checks before adding to the cart; about one per add.
  'menu.check': { points: 60, duration: 60 },
  'contact.submit': { points: 3, duration: 600 },
  'support.create': { points: 5, duration: 3600 },
  'delivery.otp': { points: 5, duration: 900, failClosed: true },
  'partner.location': { points: 1, duration: 2 },
  'realtime.auth': { points: 60, duration: 60 },
  'upload.request': { points: 30, duration: 600 },
  // Address suggestions while typing (debounced in the browser).
  'geo.search': { points: 30, duration: 60 },
  'geo.check': { points: 60, duration: 60 },
  'address.write': { points: 30, duration: 600 },
  'account.update': { points: 20, duration: 600 },
  'account.devices': { points: 30, duration: 600 },
  'account.export': {
    points: 5,
    duration: 3600,
    message: 'You can download your data again in {wait}.',
  },
  'account.delete': {
    points: 5,
    duration: 900,
    failClosed: true,
    message: 'Too many attempts. Try again in {wait}.',
  },
  search: { points: 60, duration: 60 },
  'action.default': { points: 60, duration: 60 },
} as const satisfies Record<string, Policy>;

export type RateLimitPolicy = keyof typeof POLICIES;

const policyOf = (policy: RateLimitPolicy): Policy => POLICIES[policy];

const limiters = new Map<RateLimitPolicy, RateLimiterRedis>();

function limiterFor(policy: RateLimitPolicy) {
  let limiter = limiters.get(policy);
  if (!limiter) {
    const { points, duration, blockDuration } = policyOf(policy);
    limiter = new RateLimiterRedis({
      storeClient: redis,
      keyPrefix: `rl:${policy}`,
      useRedisPackage: false,
      points,
      duration,
      blockDuration,
    });
    limiters.set(policy, limiter);
  }
  return limiter;
}

/** "45 seconds", "1 minute", "10 minutes", "1 hour". */
export function formatWait(seconds: number): string {
  const s = Math.max(1, Math.ceil(seconds));
  if (s < 60) return `${s} ${s === 1 ? 'second' : 'seconds'}`;
  const minutes = Math.ceil(s / 60);
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
  const hours = Math.ceil(minutes / 60);
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}

/** The 429 for a policy, with the real wait in the message and in `retryAfterSeconds`. */
export function limitError(policy: RateLimitPolicy, msBeforeNext: number): AppError {
  const retryAfterSeconds = Math.max(1, Math.ceil(msBeforeNext / 1000));
  const template = policyOf(policy).message;
  return template
    ? rateLimited(template.replace('{wait}', formatWait(retryAfterSeconds)), retryAfterSeconds)
    : rateLimited(
        `Too many requests. Try again in ${formatWait(retryAfterSeconds)}.`,
        retryAfterSeconds,
      );
}

function outage(policy: RateLimitPolicy, error: unknown): AppError | undefined {
  logger.warn({ err: error, policy }, 'rate limiter unavailable');
  const { failClosed, unavailableMessage } = policyOf(policy);
  return failClosed ? unavailable(unavailableMessage) : undefined;
}

/** A consumed point that can be given back when the request turns out not to count. */
export interface Attempt {
  /** Points used in the window, this one included. 0 when the limiter was unavailable. */
  consumed: number;
  refund(): Promise<void>;
}

const noAttempt: Attempt = { consumed: 0, refund: async () => {} };

/**
 * Consumes one point and returns a handle to give it back. Throws a 429 AppError when the caller
 * is over the limit, or a 503 when a fail-closed limiter is down.
 */
export async function takeAttempt(policy: RateLimitPolicy, key: string): Promise<Attempt> {
  let result: RateLimiterRes;
  try {
    await waitUntilReady();
    result = await limiterFor(policy).consume(key);
  } catch (error) {
    if (error instanceof RateLimiterRes) throw limitError(policy, error.msBeforeNext);
    const refusal = outage(policy, error);
    if (refusal) throw refusal;
    return noAttempt;
  }
  let refunded = false;
  return {
    consumed: result.consumedPoints,
    async refund() {
      if (refunded) return;
      refunded = true;
      try {
        await limiterFor(policy).reward(key, 1);
      } catch (error) {
        logger.warn({ err: error, policy }, 'could not refund a rate-limit point');
      }
    },
  };
}

/** Consumes one point; throws a 429 AppError when the caller is over the limit. */
export async function enforceRateLimit(policy: RateLimitPolicy, key: string) {
  await takeAttempt(policy, key);
}

/** Clears a caller's counter, e.g. the sign-in lockout once the password has been reset. */
export async function resetRateLimit(policy: RateLimitPolicy, key: string) {
  try {
    await waitUntilReady();
    await limiterFor(policy).delete(key);
  } catch (error) {
    logger.warn({ err: error, policy }, 'could not reset a rate limit');
  }
}

/** Limiter keys never hold an email address in clear. */
export function emailKey(email: string) {
  return `email:${createHash('sha256').update(email.trim().toLowerCase()).digest('hex')}`;
}
