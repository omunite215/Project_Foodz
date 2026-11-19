import { PrismaPg } from '@prisma/adapter-pg';
import { RateLimiterRedis } from 'rate-limiter-flexible';
import { v7 as uuid } from 'uuid';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { PrismaClient } from '@/server/db/generated/client';
import { redis } from '@/server/redis';
import type { RateLimitPolicy } from '@/server/security/rate-limit';
import { seedCatalog } from '../../prisma/seeding';
import { nextHeaders, newBrowser, switchBrowser } from './support/browser';

/*
 * Abuse cases for the rate limits added with the account pages: each policy is driven through
 * its Server Action, the way a script would, until the next call is refused with the wait.
 */

const mocks = vi.hoisted(() => ({
  send: vi.fn<(event: unknown) => Promise<unknown>>(async () => ({ ids: ['evt'] })),
}));
vi.mock('next/headers', () => nextHeaders);
vi.mock('next/headers.js', () => nextHeaders);
vi.mock('@/server/jobs/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/jobs/client')>()),
  inngest: { send: mocks.send },
}));
vi.mock('@/server/security/breached-passwords', () => ({
  checkPasswordBreach: async () => 'clean',
}));
vi.mock('@/server/security/turnstile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/security/turnstile')>()),
  checkTurnstile: async () => 'passed',
}));

const authActions = await import('@/server/modules/auth/actions');
const account = await import('@/server/modules/account/actions');
const addresses = await import('@/server/modules/addresses/actions');

const PASSWORD = 'correct horse battery';
const NEW_PASSWORD = 'a different long password';

let migrator: PrismaClient;

async function signUp(tag = 'limits') {
  const browser = switchBrowser(newBrowser());
  const email = `${tag}-${uuid()}@example.com`;
  const result = await authActions.signUpAction({
    name: 'Maya Lopez',
    email,
    password: PASSWORD,
    captchaToken: 'ok',
  });
  expect(result?.data?.signedIn).toBe(true);
  const { id } = await migrator.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  return { email, browser, userId: id };
}

/** Makes this account's sessions older than the 10-minute fresh window. */
const ageSessions = (userId: string) =>
  migrator.session.updateMany({
    where: { userId },
    data: { createdAt: new Date(Date.now() - 11 * 60 * 1000) },
  });

/** The limiter behind one policy stops answering, as if Redis had gone away. */
function limiterDown(policy: RateLimitPolicy) {
  const consume: RateLimiterRedis['consume'] = Reflect.get(RateLimiterRedis.prototype, 'consume');
  vi.spyOn(RateLimiterRedis.prototype, 'consume').mockImplementation(function (
    this: RateLimiterRedis,
    ...args: Parameters<RateLimiterRedis['consume']>
  ) {
    return this.keyPrefix === `rl:${policy}`
      ? Promise.reject(new Error('connection lost'))
      : consume.apply(this, args);
  });
}

interface ActionResult {
  serverError?: { code: string; message: string; retryAfterSeconds?: number };
}

/** Calls `run` `times` times (none of them refused for the limit), then once more. */
async function overTheLimit(times: number, run: () => Promise<ActionResult | undefined>) {
  for (let i = 0; i < times; i++) {
    expect((await run())?.serverError?.code).not.toBe('RATE_LIMITED');
  }
  const refused = (await run())?.serverError;
  expect(refused?.code).toBe('RATE_LIMITED');
  expect(refused?.retryAfterSeconds).toBeGreaterThan(0);
  return refused!;
}

beforeAll(async () => {
  migrator = new PrismaClient({
    adapter: new PrismaPg({ connectionString: inject('migratorUrl') }),
  });
  await migrator.$transaction((tx) => seedCatalog(tx, { now: new Date() }), { timeout: 60_000 });
}, 120_000);

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await migrator.$disconnect();
  await redis.quit();
});

describe('deleting the account (account.delete)', () => {
  it('allows 5 calls in 15 minutes, counting every call, then refuses even the right password', async () => {
    const { userId } = await signUp();
    await ageSessions(userId);
    const refused = await overTheLimit(5, () =>
      account.deleteAccountAction({ password: 'not my password' }),
    );
    expect(refused.message).toBe('Too many attempts. Try again in 15 minutes.');
    expect(refused.retryAfterSeconds).toBeGreaterThan(14 * 60);
    expect((await account.deleteAccountAction({ password: PASSWORD }))?.serverError?.code).toBe(
      'RATE_LIMITED',
    );
    expect((await migrator.user.findUniqueOrThrow({ where: { id: userId } })).deletedAt).toBeNull();
  });

  it('refuses while the limiter is down (fail closed)', async () => {
    const { userId } = await signUp();
    limiterDown('account.delete');
    expect((await account.deleteAccountAction({}))?.serverError?.code).toBe('UNAVAILABLE');
    expect((await migrator.user.findUniqueOrThrow({ where: { id: userId } })).deletedAt).toBeNull();
  });
});

describe('changing the password (auth.change-password)', () => {
  it('allows 5 wrong current passwords in 15 minutes, then refuses the right one too', async () => {
    await signUp();
    const refused = await overTheLimit(5, () =>
      authActions.changePasswordAction({
        currentPassword: 'not it at all',
        newPassword: NEW_PASSWORD,
      }),
    );
    expect(refused.message).toBe('Too many attempts. Try again in 15 minutes.');
    expect(
      (
        await authActions.changePasswordAction({
          currentPassword: PASSWORD,
          newPassword: NEW_PASSWORD,
        })
      )?.serverError?.code,
    ).toBe('RATE_LIMITED');
  });

  it('refuses while the limiter is down (fail closed)', async () => {
    const { email } = await signUp();
    limiterDown('auth.change-password');
    const result = await authActions.changePasswordAction({
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
    });
    expect(result?.serverError?.code).toBe('UNAVAILABLE');
    vi.restoreAllMocks();
    // The password did not change.
    switchBrowser(newBrowser());
    expect((await authActions.signInAction({ email, password: PASSWORD }))?.data?.status).toBe(
      'signed-in',
    );
  });
});

describe('changing an unconfirmed email (auth.change-email)', () => {
  it('allows 5 changes an hour', async () => {
    await signUp();
    const refused = await overTheLimit(5, () =>
      authActions.changeEmailAction({ newEmail: `fixed-${uuid()}@example.com` }),
    );
    expect(refused.message).toBe('Too many email changes. Try again in 1 hour.');
  });
});

describe('password reset', () => {
  it('sends at most 3 links per address in 15 minutes, from any network (auth.password-reset.email)', async () => {
    const { email } = await signUp();
    let attempt = 0;
    const refused = await overTheLimit(3, () => {
      attempt += 1;
      switchBrowser(newBrowser());
      return authActions.requestPasswordResetAction({ email, captchaToken: `ok-${attempt}` });
    });
    expect(refused.message).toBe('Too many reset requests. Try again in 15 minutes.');
  });

  it('takes at most 10 requests per network in 15 minutes (auth.password-reset.ip)', async () => {
    switchBrowser(newBrowser());
    const refused = await overTheLimit(10, () =>
      authActions.requestPasswordResetAction({
        email: `nobody-${uuid()}@example.com`,
        captchaToken: 'ok',
      }),
    );
    expect(refused.message).toBe('Too many reset requests. Try again in 15 minutes.');
  });

  it('allows 5 tries at a reset link per network in 15 minutes (auth.reset-password)', async () => {
    switchBrowser(newBrowser());
    const refused = await overTheLimit(5, () =>
      authActions.resetPasswordAction({ token: `made-up-${uuid()}`, newPassword: NEW_PASSWORD }),
    );
    expect(refused.message).toBe('Too many attempts. Try again in 15 minutes.');
  });
});

describe('the two-factor step (auth.two-factor)', () => {
  it('allows 10 codes per network in 5 minutes', async () => {
    switchBrowser(newBrowser());
    const refused = await overTheLimit(10, () =>
      authActions.verifyTwoFactorAction({ method: 'totp', code: '123456' }),
    );
    expect(refused.message).toBe('Too many wrong codes. Try again in 5 minutes.');
  });
});

describe('address book and search', () => {
  it('allows 30 address changes in 10 minutes (address.write)', async () => {
    await signUp();
    const refused = await overTheLimit(30, () => addresses.deleteAddressAction({ id: uuid() }));
    expect(refused.message).toBe('Too many requests. Try again in 10 minutes.');
  });

  it('allows 30 searches a minute (geo.search)', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ features: [] }));
    await signUp();
    const refused = await overTheLimit(30, () =>
      addresses.searchAddressesAction({ query: '12 Peterborough' }),
    );
    expect(refused.message).toMatch(/^Too many requests. Try again in (\d+ seconds|1 minute).$/);
  });

  it('allows 60 delivery checks a minute (geo.check)', async () => {
    await signUp();
    const refused = await overTheLimit(60, () =>
      addresses.checkDeliveryAreaAction({ lat: 42.3467, lng: -71.0972 }),
    );
    expect(refused.message).toMatch(/^Too many requests. Try again in (\d+ seconds|1 minute).$/);
  });
});

describe('account settings', () => {
  it('allows 20 profile saves in 10 minutes (account.update)', async () => {
    await signUp();
    const refused = await overTheLimit(20, () =>
      account.updateProfileAction({ name: 'Maya Lopez' }),
    );
    expect(refused.message).toBe('Too many requests. Try again in 10 minutes.');
  });

  it('allows 30 device reads or sign-outs in 10 minutes (account.devices)', async () => {
    await signUp();
    const refused = await overTheLimit(30, () => account.listDevicesAction());
    expect(refused.message).toBe('Too many requests. Try again in 10 minutes.');
  });
});
