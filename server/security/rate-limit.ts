import 'server-only';
import { createHash } from 'node:crypto';
import { RateLimiterRedis, RateLimiterRes } from 'rate-limiter-flexible';
import { networkOf } from '@/server/client-ip';
import { AppError, rateLimited, unavailable } from '@/server/errors';
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
const PROMO_UNAVAILABLE =
  "We can't check promo codes right now. Your cart is fine. Try the code again in a minute.";
const TOO_MANY_CODES = 'Too many codes tried. You can try again in {wait}.';

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
  // Promo codes that don't exist (or aren't the caller's), per account and per network (F3 B5).
  // Codes that exist give the point back, so typing a real code live never counts.
  'coupon.miss.user': {
    points: 10,
    duration: 900,
    blockDuration: 600,
    failClosed: true,
    message: TOO_MANY_CODES,
    unavailableMessage: PROMO_UNAVAILABLE,
  },
  'coupon.miss.ip': {
    points: 30,
    duration: 900,
    blockDuration: 600,
    failClosed: true,
    message: TOO_MANY_CODES,
    unavailableMessage: PROMO_UNAVAILABLE,
  },
  // Cart price breakdowns: on open, after each change (debounced), on return to the tab, once
  // a minute, and two at once to compare codes.
  'cart.quote': {
    points: 120,
    duration: 60,
    message: "You're updating your cart very fast. Try again in {wait}.",
  },
  'favorites.write': {
    points: 60,
    duration: 60,
    message: "You're changing favorites very fast. Try again in {wait}.",
  },
  'favorites.read': { points: 120, duration: 60 },
  // Placing orders (F4 B11): per account and per network. A refused press counts too.
  'order.place.user': {
    points: 10,
    duration: 3600,
    message: "You've tried to order several times in a short while. You can try again in {wait}.",
  },
  'order.place.ip': {
    points: 30,
    duration: 3600,
    message: "You've tried to order several times in a short while. You can try again in {wait}.",
  },
  // Declined card payments, against card testing: the 5th decline in an hour on an account (the
  // 20th on a network) pauses card payment for an hour; cash keeps working. A limiter blocks
  // once it goes past its points, so each is one below the decline that pauses. Counted once per
  // failed payment, never per press.
  'payment.decline.user': { points: 4, duration: 3600, blockDuration: 3600 },
  'payment.decline.ip': { points: 19, duration: 3600, blockDuration: 3600 },
  // The order page polls this every 2 seconds for up to a minute while a payment is confirmed.
  'order.status': {
    points: 120,
    duration: 60,
    message: "You're checking very fast. Try again in {wait}.",
  },
  'order.read': { points: 120, duration: 60 },
  'order.cancel': {
    points: 10,
    duration: 3600,
    message: "You've cancelled several times in a short while. Try again in {wait}.",
  },
  'order.pay': {
    points: 20,
    duration: 600,
    message: "You've tried to pay several times in a short while. Try again in {wait}.",
  },
  'cards.read': { points: 60, duration: 60 },
  'cards.write': {
    points: 20,
    duration: 600,
    message: "You're changing saved cards very fast. Try again in {wait}.",
  },
  // Stripe's own calls to the webhook, per network. Generous: Stripe retries in bursts.
  'webhook.stripe': { points: 600, duration: 60 },
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
  // The same lookups for signed-out visitors (F3 U2), per network.
  'geo.guest-search': {
    points: 30,
    duration: 60,
    message: 'Too many address lookups from this network. Try again in {wait}.',
  },
  'geo.guest-check': {
    points: 30,
    duration: 60,
    message: 'Too many address checks from this network. Try again in {wait}.',
  },
  // Lookups the site sends to the public Photon server for signed-out visitors, all together:
  // its fair use is about one request a second, and going over could get the site blocked.
  'geo.photon': { points: 60, duration: 60 },
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
  search: { points: 60, duration: 60, message: "You're searching very fast. Try again in {wait}." },
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
export async function takeAttempt(policy: RateLimitPolicy, callerKey: string): Promise<Attempt> {
  const key = storedKey(callerKey);
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

/**
 * The key a counter is kept under. A per-network key (`ip:<address>`) counts the client's
 * network, so an IPv6 client can't reset its limits by moving within its /64 (F3 security S4).
 */
function storedKey(key: string): string {
  return key.startsWith('ip:') ? `ip:${networkOf(key.slice(3))}` : key;
}

/** Consumes one point; throws a 429 AppError when the caller is over the limit. */
export async function enforceRateLimit(policy: RateLimitPolicy, key: string) {
  await takeAttempt(policy, key);
}

/** One limit to count against: a policy and the caller's key under it. */
export interface LimitCheck {
  policy: RateLimitPolicy;
  key: string;
}

/**
 * Consumes one point under each check, all or nothing: if any is over its limit (429) or down
 * and fail-closed (503), the points already taken are given back and that error is thrown. A
 * 429 wins over a 503, and the longest wait wins among 429s. The returned attempt refunds every
 * point at once.
 */
export async function takeAttempts(checks: readonly LimitCheck[]): Promise<Attempt> {
  const results = await Promise.allSettled(
    checks.map(({ policy, key }) => takeAttempt(policy, key)),
  );
  const taken = results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
  const errors = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
  if (errors.length > 0) {
    await Promise.all(taken.map((attempt) => attempt.refund()));
    const refusals = errors.filter((error) => error instanceof AppError);
    const limited = refusals
      .filter((error) => error.code === 'RATE_LIMITED')
      .toSorted((a, b) => (b.retryAfterSeconds ?? 0) - (a.retryAfterSeconds ?? 0));
    throw limited[0] ?? refusals[0] ?? errors[0];
  }
  return {
    consumed: Math.max(0, ...taken.map((attempt) => attempt.consumed)),
    async refund() {
      await Promise.all(taken.map((attempt) => attempt.refund()));
    },
  };
}

/**
 * Whether any check is blocked right now, without using a point: the 429 to answer with, or
 * null. Lets a caller refuse everything while a block lasts (so the refusal can't tell anything
 * apart) and otherwise count only what it means to count. Throws a 503 when a fail-closed
 * limiter is down.
 */
export async function blockedFor(checks: readonly LimitCheck[]): Promise<AppError | null> {
  const states = await Promise.all(
    checks.map(async ({ policy, key }) => {
      try {
        await waitUntilReady();
        return { policy, state: await limiterFor(policy).get(storedKey(key)) };
      } catch (error) {
        const refusal = outage(policy, error);
        if (refusal) throw refusal;
        return { policy, state: null };
      }
    }),
  );
  const blocked = states
    .filter(({ policy, state }) => state !== null && state.consumedPoints > policyOf(policy).points)
    .toSorted((a, b) => (b.state?.msBeforeNext ?? 0) - (a.state?.msBeforeNext ?? 0));
  const [longest] = blocked;
  return longest ? limitError(longest.policy, longest.state?.msBeforeNext ?? 0) : null;
}

/** Clears a caller's counter, e.g. the sign-in lockout once the password has been reset. */
export async function resetRateLimit(policy: RateLimitPolicy, key: string) {
  try {
    await waitUntilReady();
    await limiterFor(policy).delete(storedKey(key));
  } catch (error) {
    logger.warn({ err: error, policy }, 'could not reset a rate limit');
  }
}

/** Limiter keys never hold an email address in clear. */
export function emailKey(email: string) {
  return `email:${createHash('sha256').update(email.trim().toLowerCase()).digest('hex')}`;
}
