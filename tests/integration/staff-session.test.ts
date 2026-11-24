import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { PrismaClient } from '@/server/db/generated/client';
import { asBrowser, newBrowser, nextHeaders, requestHeaders } from './support/browser';
import { PASSWORD } from './support/checkout';
import { staffMember } from './support/staff';

/*
 * F5 U11, threat T3: a staff session's row ends 12 hours after sign-in, and the library's
 * refresh never moves it later. The auth library's own endpoints (the admin API) read the row,
 * not the app's 12-hour check, so the row itself must say when the session ends.
 */

vi.mock('next/headers', () => nextHeaders);
vi.mock('next/headers.js', () => nextHeaders);
vi.mock('@/server/security/breached-passwords', () => ({
  checkPasswordBreach: async () => 'clean',
}));
vi.mock('@/server/security/turnstile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/security/turnstile')>()),
  checkTurnstile: async () => 'passed',
}));

const authActions = await import('@/server/modules/auth/actions');
const { auth } = await import('@/server/auth');

const HOUR_MS = 60 * 60 * 1000;

let migrator: PrismaClient;

beforeAll(() => {
  migrator = new PrismaClient({
    adapter: new PrismaPg({ connectionString: inject('migratorUrl') }),
  });
});

afterAll(async () => {
  await migrator.$disconnect();
});

/** Signs in on a fresh browser and returns it with the session row it got. */
async function signIn(email: string) {
  const browser = newBrowser();
  const result = await asBrowser(browser, () =>
    authActions.signInAction({ email, password: PASSWORD, captchaToken: 'ok' }),
  );
  expect(result?.serverError).toBeUndefined();
  const token = [...browser.jar].find(([name]) => name.endsWith('session_token'))?.[1];
  expect(token).toBeTruthy();
  const row = await migrator.session.findFirstOrThrow({
    where: { token: decodeURIComponent(token!).split('.')[0] },
  });
  return { browser, row };
}

const spanHours = (row: { createdAt: Date; expiresAt: Date }) =>
  (row.expiresAt.getTime() - row.createdAt.getTime()) / HOUR_MS;

describe('the 12-hour staff session row (F5 U11, T3)', () => {
  it('ends 12 hours after a staff sign-in, and a refresh keeps that end', async () => {
    const alex = await staffMember(migrator, 'kitchen', { twoFactor: false });
    const { browser, row } = await signIn(alex.email);
    expect(spanHours(row)).toBeLessThanOrEqual(12 + 1 / 3600);

    // The library refreshes a session it thinks is due (a week minus a day): the hook clamps it.
    const read = await asBrowser(browser, () =>
      auth.api.getSession({ headers: requestHeaders(browser) }),
    );
    expect(read?.user.id).toBe(alex.userId);
    const after = await migrator.session.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.updatedAt.getTime()).toBeGreaterThanOrEqual(row.updatedAt.getTime());
    expect(after.expiresAt.getTime()).toBeLessThanOrEqual(row.createdAt.getTime() + 12 * HOUR_MS);
  });

  it('keeps a customer signed in for days', async () => {
    const maya = await staffMember(migrator, 'customer');
    const { row } = await signIn(maya.email);
    expect(spanHours(row)).toBeGreaterThan(24);
  });
});
