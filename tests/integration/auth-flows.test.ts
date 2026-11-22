import { createOTP } from '@better-auth/utils/otp';
import { PrismaPg } from '@prisma/adapter-pg';
import { signJWT, symmetricEncrypt } from 'better-auth/crypto';
import { toNextJsHandler } from 'better-auth/next-js';
import { v7 as uuid } from 'uuid';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it, vi } from 'vitest';
import { PrismaClient } from '@/server/db/generated/client';
import { redis } from '@/server/redis';
import { seedCatalog } from '../../prisma/seeding';
import {
  asBrowser,
  type Browser,
  currentBrowser,
  nextHeaders,
  newBrowser,
  requestHeaders,
  storeCookies,
  switchBrowser,
} from './support/browser';

const mocks = vi.hoisted(() => ({
  send: vi.fn<(event: { data: { sealed: string } }) => Promise<unknown>>(),
  breach: vi.fn<(password: string) => Promise<'breached' | 'clean'>>(async (password) =>
    password.includes('breached') ? 'breached' : 'clean',
  ),
  turnstile: vi.fn<(token?: string) => Promise<'passed' | 'failed' | 'missing'>>(async (token) =>
    token ? (token === 'bad-token' ? 'failed' : 'passed') : 'missing',
  ),
}));
vi.mock('next/headers', () => nextHeaders);
vi.mock('next/headers.js', () => nextHeaders);
vi.mock('@/server/jobs/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/jobs/client')>()),
  inngest: { send: mocks.send },
}));
vi.mock('@/server/security/breached-passwords', () => ({ checkPasswordBreach: mocks.breach }));
vi.mock('@/server/security/turnstile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/security/turnstile')>()),
  checkTurnstile: mocks.turnstile,
}));

const { auth } = await import('@/server/auth');
const { handleAuthRequest } = await import('@/server/auth/gateway');
const { unsealAccountEmail } = await import('@/server/modules/notifications/account-email');
const actions = await import('@/server/modules/auth/actions');
const { getTwoFactorChallenge } = await import('@/server/modules/auth/service');

const http = toNextJsHandler(auth);
const SITE = 'http://localhost:3456';
const PASSWORD = 'correct horse battery';

let migrator: PrismaClient;

// ------------------------------------------------------------------ helpers

const sent = () => mocks.send.mock.calls.map(([event]) => unsealAccountEmail(event.data.sealed));
const emailsTo = (address: string) => sent().filter((email) => email.to === address);
const linkIn = async (
  address: string,
  kind: 'verify-email' | 'verify-new-email' | 'reset-password',
) => {
  await vi.waitFor(() => expect(emailsTo(address).some((e) => e.kind === kind)).toBe(true));
  const email = emailsTo(address).findLast((e) => e.kind === kind);
  return email && 'url' in email ? email.url : '';
};

const freshEmail = (tag = 'maya') => `${tag}-${uuid()}@example.com`;

/** Whether a browser still has a session cookie. */
const holdsSession = (browser: Browser) =>
  [...browser.jar.keys()].some((name) => name.endsWith('session_token'));

const userByEmail = (email: string) =>
  migrator.user.findUniqueOrThrow({
    where: { email },
    select: { id: true, emailVerified: true, termsAcceptedVersion: true, name: true, email: true },
  });

/** Signs up through the real action in a new browser, which ends up signed in. */
async function signUp(tag = 'maya') {
  const browser = switchBrowser(newBrowser());
  const email = freshEmail(tag);
  const result = await actions.signUpAction({
    name: 'Maya Lopez',
    email,
    password: PASSWORD,
    captchaToken: 'ok',
  });
  expect(result?.data).toMatchObject({ signedIn: true });
  const user = await userByEmail(email);
  return { email, browser, userId: user.id };
}

const sessionOf = (browser: Browser) =>
  asBrowser(browser, () => auth.api.getSession({ headers: requestHeaders(browser) }));

async function get(path: string, browser?: Browser) {
  const headers = browser
    ? requestHeaders(browser)
    : new Headers({ 'x-forwarded-for': '192.0.2.10' });
  const response = await handleAuthRequest(new Request(new URL(path, SITE), { headers }), http.GET);
  if (browser) storeCookies(response, browser);
  return response;
}

async function addTwoFactor(userId: string, role: string) {
  const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
  const context = await auth.$context;
  await migrator.twoFactor.create({
    data: {
      id: uuid(),
      userId,
      secret: await symmetricEncrypt({ key: context.secretConfig, data: secret }),
      backupCodes: await symmetricEncrypt({
        key: context.secretConfig,
        data: JSON.stringify(['ABCDE-12345', 'FGHIJ-67890']),
      }),
      verified: true,
    },
  });
  await migrator.user.update({ where: { id: userId }, data: { twoFactorEnabled: true, role } });
  return createOTP(secret, { digits: 6 });
}

beforeAll(async () => {
  migrator = new PrismaClient({
    adapter: new PrismaPg({ connectionString: inject('migratorUrl') }),
  });
  // Sign-up records the published Terms version; the catalog gives the store settings.
  await migrator.$transaction((tx) => seedCatalog(tx, { now: new Date() }), { timeout: 60_000 });
}, 120_000);

beforeEach(() => {
  mocks.send.mockReset().mockResolvedValue({ ids: ['evt'] });
  mocks.breach.mockClear();
  mocks.turnstile.mockClear();
});

afterAll(async () => {
  await migrator.$disconnect();
  await redis.quit();
});

// ------------------------------------------------------------------ sign up (S1)

describe('sign-up', () => {
  it('creates the account signed in, with a normalised email, and sends one confirm link', async () => {
    const browser = switchBrowser(newBrowser());
    const email = freshEmail('Maya');
    const result = await actions.signUpAction({
      name: '  Maya   Lopez ',
      email: `  ${email.toUpperCase()} `,
      password: PASSWORD,
      captchaToken: 'ok',
      callbackUrl: '/menu/bulgogi',
    });
    expect(result?.data).toEqual({
      signedIn: true,
      email: email.toLowerCase(),
      redirectTo: '/menu/bulgogi',
    });
    expect(browser.jar.get('foodz_welcome')).toBe('1');
    expect((await sessionOf(browser))?.user.email).toBe(email.toLowerCase());

    const user = await userByEmail(email.toLowerCase());
    expect(user).toMatchObject({ name: 'Maya Lopez', emailVerified: false });
    expect(user.termsAcceptedVersion).toBeGreaterThanOrEqual(1);

    const url = new URL(await linkIn(email.toLowerCase(), 'verify-email'));
    expect(url.pathname).toBe('/api/auth/verify-email');
    expect(url.searchParams.get('callbackURL')).toBe('/verify-email?callbackUrl=%2Fmenu%2Fbulgogi');
    expect(emailsTo(email.toLowerCase())).toHaveLength(1);
  });

  it('answers a taken email like a new one, without a second account, and tells the owner once an hour', async () => {
    const { email } = await signUp();
    mocks.send.mockClear();
    for (let i = 0; i < 2; i++) {
      switchBrowser(newBrowser());
      const result = await actions.signUpAction({
        name: 'Someone',
        email,
        password: PASSWORD,
        captchaToken: 'ok',
      });
      expect(result?.data).toEqual({ signedIn: false, email, redirectTo: '/' });
    }
    expect(await migrator.user.count({ where: { email } })).toBe(1);
    await vi.waitFor(() =>
      expect(emailsTo(email).filter((e) => e.kind === 'account-exists')).toHaveLength(1),
    );
  });

  it('refuses short and breached passwords without using up the sign-up limit (S1.7)', async () => {
    switchBrowser(newBrowser());
    for (const password of ['breached-password-1', 'breached-password-2']) {
      const result = await actions.signUpAction({
        name: 'Maya',
        email: freshEmail(),
        password,
        captchaToken: 'ok',
      });
      expect(result?.serverError).toMatchObject({
        code: 'INVALID_INPUT',
        fieldErrors: {
          password: ['This password has appeared in a data breach. Please choose a different one.'],
        },
      });
    }
    const short = await actions.signUpAction({
      name: 'Maya',
      email: freshEmail(),
      password: 'short',
      captchaToken: 'ok',
    });
    expect(short?.validationErrors).toBeDefined();

    for (let i = 0; i < 3; i++) {
      const ok = await actions.signUpAction({
        name: 'Maya',
        email: freshEmail(),
        password: PASSWORD,
        captchaToken: 'ok',
      });
      expect(ok?.data?.signedIn).toBe(true);
    }
    const fourth = await actions.signUpAction({
      name: 'Maya',
      email: freshEmail(),
      password: PASSWORD,
      captchaToken: 'ok',
    });
    expect(fourth?.serverError).toMatchObject({
      code: 'RATE_LIMITED',
      message: 'Too many sign-ups from this network. Try again in 10 minutes.',
    });
    expect(fourth?.serverError?.retryAfterSeconds).toBeGreaterThan(500);
  });

  it('needs the security check, and says so when it is missing or fails', async () => {
    switchBrowser(newBrowser());
    const base = { name: 'Maya', email: freshEmail(), password: PASSWORD };
    expect((await actions.signUpAction(base))?.serverError).toMatchObject({
      code: 'CAPTCHA_REQUIRED',
    });
    expect(
      (await actions.signUpAction({ ...base, captchaToken: 'bad-token' }))?.serverError,
    ).toMatchObject({
      code: 'CAPTCHA_FAILED',
    });
    expect(await migrator.user.count({ where: { email: base.email } })).toBe(0);
  });

  it('refuses invalid names, emails and extra fields', async () => {
    switchBrowser(newBrowser());
    for (const input of [
      { name: '   ', email: freshEmail(), password: PASSWORD, captchaToken: 'ok' },
      { name: 'x'.repeat(61), email: freshEmail(), password: PASSWORD, captchaToken: 'ok' },
      { name: 'Maya', email: 'maya@example', password: PASSWORD, captchaToken: 'ok' },
      { name: 'Maya', email: freshEmail(), password: PASSWORD, captchaToken: 'ok', role: 'admin' },
    ]) {
      expect((await actions.signUpAction(input))?.validationErrors).toBeDefined();
    }
  });
});

// ------------------------------------------------------------------ sign in (S2)

describe('sign-in', () => {
  it('signs in, lands on a safe return path and is audited', async () => {
    const { email, userId } = await signUp();
    const browser = switchBrowser(newBrowser());
    const result = await actions.signInAction({
      email: email.toUpperCase(),
      password: PASSWORD,
      callbackUrl: '//evil.example',
    });
    expect(result?.data).toEqual({ status: 'signed-in', redirectTo: '/' });
    expect((await sessionOf(browser))?.user.id).toBe(userId);
    expect(
      await migrator.auditLog.count({ where: { action: 'auth.sign-in', targetId: userId } }),
    ).toBe(1);
  });

  it('never returns a path that dot segments turn into another host (S4)', async () => {
    const { email } = await signUp();
    switchBrowser(newBrowser());
    for (const callbackUrl of [
      '/.//evil.com',
      '/..//evil.com',
      '/a/..//evil.com',
      '/%2e//evil.com',
    ]) {
      const result = await actions.signInAction({ email, password: PASSWORD, callbackUrl });
      expect(result?.data).toEqual({ status: 'signed-in', redirectTo: '/' });
    }
  });

  it('answers a wrong password and an unknown email the same way', async () => {
    const { email } = await signUp();
    switchBrowser(newBrowser());
    const wrong = await actions.signInAction({ email, password: 'not the password' });
    switchBrowser(newBrowser());
    const unknown = await actions.signInAction({
      email: freshEmail('nobody'),
      password: 'not the password',
    });
    const expected = {
      code: 'INVALID_CREDENTIALS',
      message: "That email and password don't match. Try again, or reset your password.",
    };
    expect(wrong?.serverError).toEqual(expected);
    expect(unknown?.serverError).toEqual(expected);
  });

  it('asks for the security check after a failure, then locks the email after five failures', async () => {
    const { email } = await signUp();
    switchBrowser(newBrowser());
    expect((await actions.signInAction({ email, password: 'wrong one' }))?.serverError?.code).toBe(
      'INVALID_CREDENTIALS',
    );
    // The second try needs Turnstile; asking for it does not count as an attempt.
    expect((await actions.signInAction({ email, password: 'wrong one' }))?.serverError?.code).toBe(
      'CAPTCHA_REQUIRED',
    );
    for (let i = 0; i < 4; i++) {
      const result = await actions.signInAction({
        email,
        password: 'wrong one',
        captchaToken: 'ok',
      });
      expect(result?.serverError?.code).toBe('INVALID_CREDENTIALS');
    }
    // The same lock applies from another network, and with the right password.
    switchBrowser(newBrowser());
    const locked = await actions.signInAction({ email, password: PASSWORD, captchaToken: 'ok' });
    expect(locked?.serverError).toMatchObject({
      code: 'RATE_LIMITED',
      message: 'Too many attempts. Try again in 5 minutes, or reset your password.',
    });
    expect(locked?.serverError?.retryAfterSeconds).toBeGreaterThan(240);
  });

  it('does not count successful sign-ins', async () => {
    const { email } = await signUp();
    switchBrowser(newBrowser());
    for (let i = 0; i < 7; i++) {
      expect((await actions.signInAction({ email, password: PASSWORD }))?.data?.status).toBe(
        'signed-in',
      );
    }
  });

  it('tells a suspended account only when the password is right (S2.10)', async () => {
    const { email, userId } = await signUp();
    await migrator.user.update({
      where: { id: userId },
      data: { banned: true, banReason: 'test' },
    });
    switchBrowser(newBrowser());
    expect((await actions.signInAction({ email, password: 'wrong one' }))?.serverError?.code).toBe(
      'INVALID_CREDENTIALS',
    );
    switchBrowser(newBrowser());
    expect(
      (await actions.signInAction({ email, password: PASSWORD, captchaToken: 'ok' }))?.serverError,
    ).toEqual({
      code: 'ACCOUNT_SUSPENDED',
      message: 'This account is suspended. Contact support if you think this is a mistake.',
    });
  });
});

// ------------------------------------------------------------------ two-factor (S2.9)

describe('two-factor sign-in', () => {
  it('asks staff for a code every time and never trusts the device', async () => {
    const { email, userId } = await signUp('staff');
    const otp = await addTwoFactor(userId, 'admin');
    const browser = switchBrowser(newBrowser());

    const first = await actions.signInAction({ email, password: PASSWORD, callbackUrl: '/menu' });
    expect(first?.data).toEqual({
      status: 'two-factor',
      redirectTo: '/sign-in/two-factor?callbackUrl=%2Fmenu',
    });
    expect(await sessionOf(browser)).toBeNull();
    expect(await getTwoFactorChallenge()).toEqual({ valid: true, canTrustDevice: false });

    const wrong = await actions.verifyTwoFactorAction({ method: 'totp', code: '000 000' });
    expect(wrong?.serverError).toMatchObject({
      code: 'INVALID_INPUT',
      fieldErrors: { code: ["That code didn't work. Check your app and try again."] },
    });

    const code = await otp.totp();
    const ok = await actions.verifyTwoFactorAction({
      method: 'totp',
      code: `${code.slice(0, 3)} ${code.slice(3)}`,
      trustDevice: true,
      callbackUrl: '/menu',
    });
    expect(ok?.data).toEqual({ redirectTo: '/menu' });
    expect((await sessionOf(browser))?.user.id).toBe(userId);
    expect([...browser.jar.keys()].some((name) => name.includes('trust_device'))).toBe(false);
  });

  it('offers "trust this device" to customers and accepts a backup code once', async () => {
    const { email, userId } = await signUp();
    await addTwoFactor(userId, 'customer');
    const browser = switchBrowser(newBrowser());
    await actions.signInAction({ email, password: PASSWORD });
    expect(await getTwoFactorChallenge()).toEqual({ valid: true, canTrustDevice: true });

    const ok = await actions.verifyTwoFactorAction({
      method: 'backup',
      code: 'ABCDE-12345',
      trustDevice: true,
    });
    expect(ok?.data).toEqual({ redirectTo: '/' });
    expect([...browser.jar.keys()].some((name) => name.includes('trust_device'))).toBe(true);
  });

  it('reports a missing or expired challenge as timed out', async () => {
    switchBrowser(newBrowser());
    expect(await getTwoFactorChallenge()).toEqual({ valid: false, canTrustDevice: false });
    const result = await actions.verifyTwoFactorAction({ method: 'totp', code: '123456' });
    expect(result?.serverError).toEqual({
      code: 'SIGN_IN_EXPIRED',
      message: 'This sign-in timed out. Please start again.',
    });
  });

  it('refuses a malformed code before asking the library', async () => {
    switchBrowser(newBrowser());
    expect(
      (await actions.verifyTwoFactorAction({ method: 'totp', code: '12345' }))?.validationErrors,
    ).toBeDefined();
  });
});

// ------------------------------------------------------------------ password reset (S3.8 to S3.13)

describe('password reset', () => {
  it('sends a 30-minute link only to real accounts, with the same answer for everyone', async () => {
    const { email } = await signUp();
    const demo = await signUp('demo');
    await migrator.user.update({ where: { id: demo.userId }, data: { isDemo: true } });
    mocks.send.mockClear();

    for (const address of [email, demo.email, freshEmail('nobody')]) {
      switchBrowser(newBrowser());
      const result = await actions.requestPasswordResetAction({
        email: address,
        captchaToken: 'ok',
        callbackUrl: '/menu',
      });
      expect(result?.data).toEqual({ email: address });
    }
    const link = new URL(await linkIn(email, 'reset-password'));
    expect(link.pathname).toMatch(/^\/api\/auth\/reset-password\/[\w-]+$/);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(emailsTo(demo.email)).toHaveLength(0);
    expect(sent()).toHaveLength(1);
  });

  it('resets once: signs out everywhere, confirms the email and tells the owner', async () => {
    const { email, browser: oldDevice, userId } = await signUp();
    switchBrowser(newBrowser());
    await actions.requestPasswordResetAction({ email, captchaToken: 'ok', callbackUrl: '/menu' });
    const link = await linkIn(email, 'reset-password');

    // The emailed link lands on our page with the token and the return path.
    const landing = await get(new URL(link).pathname + new URL(link).search);
    expect(landing.status).toBe(302);
    const location = new URL(landing.headers.get('location') ?? '', SITE);
    expect(location.pathname).toBe('/reset-password');
    expect(location.searchParams.get('callbackUrl')).toBe('/menu');
    const token = location.searchParams.get('token') ?? '';

    const breached = await actions.resetPasswordAction({
      token,
      newPassword: 'breached password 9',
    });
    expect(breached?.serverError?.fieldErrors?.newPassword).toBeDefined();

    const result = await actions.resetPasswordAction({
      token,
      newPassword: 'a brand new password',
    });
    expect(result?.data).toEqual({ email });
    expect(await sessionOf(oldDevice)).toBeNull();
    expect((await userByEmail(email)).emailVerified).toBe(true);
    await vi.waitFor(() =>
      expect(emailsTo(email).some((e) => e.kind === 'password-changed')).toBe(true),
    );
    expect(
      await migrator.auditLog.count({ where: { action: 'auth.password-reset', targetId: userId } }),
    ).toBe(1);

    switchBrowser(newBrowser());
    expect((await actions.signInAction({ email, password: PASSWORD }))?.serverError?.code).toBe(
      'INVALID_CREDENTIALS',
    );
    switchBrowser(newBrowser());
    expect(
      (await actions.signInAction({ email, password: 'a brand new password', captchaToken: 'ok' }))
        ?.data?.status,
    ).toBe('signed-in');

    const again = await actions.resetPasswordAction({ token, newPassword: 'another new password' });
    expect(again?.serverError).toEqual({
      code: 'LINK_EXPIRED',
      message: 'This link has expired or has already been used. We can send you a new one.',
    });
  });

  it('clears the session cookie of the browser it was made in, not of another account (S3.11)', async () => {
    const { email, browser } = await signUp();
    const resetToken = async () => {
      mocks.send.mockClear();
      await actions.requestPasswordResetAction({ email, captchaToken: 'ok' });
      const link = new URL(await linkIn(email, 'reset-password'));
      const landing = await get(link.pathname + link.search);
      return new URL(landing.headers.get('location') ?? '', SITE).searchParams.get('token') ?? '';
    };
    // Reset from the browser still signed in to the account: signed out there in the same answer,
    // so the sign-in page it lands on shows no trace of the old session.
    expect(holdsSession(browser)).toBe(true);
    const token = await resetToken();
    expect(
      (await actions.resetPasswordAction({ token, newPassword: 'a brand new password' }))?.data,
    ).toEqual({ email });
    expect(holdsSession(browser)).toBe(false);

    // Reset from a browser signed in to someone else's account: that session stays.
    const other = await signUp('other');
    const second = await resetToken();
    await actions.resetPasswordAction({ token: second, newPassword: 'another brand new password' });
    expect(holdsSession(other.browser)).toBe(true);
    expect(await sessionOf(other.browser)).not.toBeNull();
  });
});

// ------------------------------------------------------------------ email links (S3.1 to S3.6)

describe('confirm-email links', () => {
  it('confirms in the same browser with a flash, and signs in another browser', async () => {
    const { email, browser } = await signUp();
    const link = new URL(await linkIn(email, 'verify-email'));
    const path = link.pathname + link.search;

    const elsewhere = newBrowser();
    const other = await get(path, elsewhere);
    expect(other.status).toBe(302);
    const otherLocation = new URL(other.headers.get('location') ?? '', SITE);
    expect(otherLocation.pathname).toBe('/verify-email');
    expect(otherLocation.searchParams.get('status')).toBe('confirmed');
    expect(otherLocation.searchParams.get('via')).toBe('new-session');
    expect(elsewhere.jar.has('foodz_flash')).toBe(false);
    expect((await sessionOf(elsewhere))?.user.email).toBe(email);
    expect((await userByEmail(email)).emailVerified).toBe(true);

    const again = await get(path, browser);
    expect(new URL(again.headers.get('location') ?? '', SITE).searchParams.get('status')).toBe(
      'already-confirmed',
    );
  });

  it('shows the flash after confirming in the browser that signed up', async () => {
    const { email, browser } = await signUp();
    const link = new URL(await linkIn(email, 'verify-email'));
    const response = await get(link.pathname + link.search, browser);
    const location = new URL(response.headers.get('location') ?? '', SITE);
    expect(location.searchParams.get('status')).toBe('confirmed');
    expect(location.searchParams.has('via')).toBe(false);
    expect(browser.jar.get('foodz_flash')).toBe('email-confirmed');
  });

  it('confirms a link opened while signed in to another account, without switching (S2)', async () => {
    const signedIn = await signUp('victim');
    const before = await sessionOf(signedIn.browser);
    const cookieBefore = [...signedIn.browser.jar].find(([name]) => name.includes('session_token'));
    expect(cookieBefore).toBeDefined();

    const stranger = await signUp('stranger');
    const strangerSessions = await migrator.session.count({ where: { userId: stranger.userId } });
    const link = new URL(await linkIn(stranger.email, 'verify-email'));

    const response = await get(link.pathname + link.search, signedIn.browser);
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location') ?? '', SITE);
    expect(location.pathname).toBe('/verify-email');
    expect(location.searchParams.get('status')).toBe('confirmed');
    expect(location.searchParams.get('via')).toBe('other-account');
    expect(location.search).not.toContain(stranger.email);
    expect(location.search).not.toContain(signedIn.email);

    // The browser keeps its own session; the link's account is confirmed but not signed in.
    expect(response.headers.getSetCookie().some((line) => line.includes('session_token'))).toBe(
      false,
    );
    expect([...signedIn.browser.jar].find(([name]) => name.includes('session_token'))).toEqual(
      cookieBefore,
    );
    const after = await sessionOf(signedIn.browser);
    expect(after?.user.id).toBe(signedIn.userId);
    expect(after?.session.id).toBe(before?.session.id);
    expect(signedIn.browser.jar.has('foodz_flash')).toBe(false);
    expect((await userByEmail(stranger.email)).emailVerified).toBe(true);
    expect((await userByEmail(signedIn.email)).emailVerified).toBe(false);
    expect(await migrator.session.count({ where: { userId: stranger.userId } })).toBe(
      strangerSessions,
    );

    // Opened again, it is simply already confirmed.
    const again = await get(link.pathname + link.search, signedIn.browser);
    expect(new URL(again.headers.get('location') ?? '', SITE).searchParams.get('status')).toBe(
      'already-confirmed',
    );
    expect((await sessionOf(signedIn.browser))?.user.id).toBe(signedIn.userId);
  });

  it('refuses a link that does not name its account, whoever is signed in', async () => {
    const signedIn = await signUp('victim');
    const other = await signUp('other');
    const context = await auth.$context;
    const token = await signJWT({ email: other.email }, context.secret, 3600);
    const response = await get(
      `/api/auth/verify-email?token=${token}&callbackURL=%2Fverify-email`,
      signedIn.browser,
    );
    expect(response.headers.get('location')).toMatch(/^\/verify-email\?.*error=INVALID_TOKEN/);
    expect((await sessionOf(signedIn.browser))?.user.id).toBe(signedIn.userId);
    expect((await userByEmail(other.email)).emailVerified).toBe(false);
  });

  it('sends a tampered link to the expired page, never an error trace', async () => {
    const response = await get(
      '/api/auth/verify-email?token=not.a.token&callbackURL=%2Fverify-email',
    );
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toMatch(/^\/verify-email\?.*error=INVALID_TOKEN/);
  });

  it('never redirects off the site', async () => {
    const response = await get(
      '/api/auth/verify-email?token=x&callbackURL=https%3A%2F%2Fevil.example',
    );
    expect(response.headers.get('location')).toMatch(/^\/verify-email/);
  });

  it('resends from a signed-in session, at most once a minute', async () => {
    const { email } = await signUp();
    await linkIn(email, 'verify-email');
    expect((await actions.resendVerificationAction({}))?.data).toEqual({ sent: true });
    const soon = await actions.resendVerificationAction({});
    expect(soon?.serverError).toMatchObject({ code: 'RATE_LIMITED' });
    expect(soon?.serverError?.message).toMatch(/^You can resend in (\d+ seconds|1 minute)\.$/);
    expect(soon?.serverError?.retryAfterSeconds).toBeLessThanOrEqual(60);
    await vi.waitFor(() =>
      expect(emailsTo(email).filter((e) => e.kind === 'verify-email')).toHaveLength(2),
    );
  });
});

describe('changing an unconfirmed email (S3.6)', () => {
  it('sends the link to the new address, kills old links, and changes on click', async () => {
    const { email, browser, userId } = await signUp();
    const oldLink = new URL(await linkIn(email, 'verify-email'));
    // Links carry whole seconds; the change must come in a later second than the old link.
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const newEmail = freshEmail('fixed');
    expect((await actions.changeEmailAction({ newEmail, callbackUrl: '/account' }))?.data).toEqual({
      email: newEmail,
    });
    expect((await userByEmail(email)).id).toBe(userId);

    const stale = await get(oldLink.pathname + oldLink.search, newBrowser());
    expect(stale.headers.get('location')).toMatch(/error=TOKEN_EXPIRED/);

    // Worded for a changed address, not for a new account.
    const newLink = new URL(await linkIn(newEmail, 'verify-new-email'));
    const confirmed = await get(newLink.pathname + newLink.search, browser);
    expect(confirmed.headers.get('location')).not.toMatch(/error=/);
    expect(await userByEmail(newEmail)).toMatchObject({ id: userId, emailVerified: true });
  });

  it('answers the same for a taken address, changes nothing and tells its owner', async () => {
    const owner = await signUp('owner');
    const { email, userId } = await signUp();
    mocks.send.mockClear();
    expect((await actions.changeEmailAction({ newEmail: owner.email }))?.data).toEqual({
      email: owner.email,
    });
    await vi.waitFor(() =>
      expect(emailsTo(owner.email).map((e) => e.kind)).toEqual(['account-exists']),
    );
    expect((await userByEmail(email)).id).toBe(userId);
  });

  it('is not offered once the email is confirmed', async () => {
    const { userId } = await signUp();
    await migrator.user.update({ where: { id: userId }, data: { emailVerified: true } });
    expect((await actions.changeEmailAction({ newEmail: freshEmail() }))?.serverError).toEqual({
      code: 'FORBIDDEN',
      message: "Changing a confirmed email isn't available yet.",
    });
  });
});

// ------------------------------------------------------------------ change password (S5.4)

describe('changing the password', () => {
  it('keeps this device, signs out the others and sends the email', async () => {
    const { email, browser: other } = await signUp();
    const here = switchBrowser(newBrowser());
    await actions.signInAction({ email, password: PASSWORD });

    const wrong = await actions.changePasswordAction({
      currentPassword: 'not it at all',
      newPassword: 'a new long password',
    });
    expect(wrong?.serverError).toMatchObject({
      fieldErrors: { currentPassword: ["Your current password isn't right."] },
    });

    const ok = await actions.changePasswordAction({
      currentPassword: PASSWORD,
      newPassword: 'a new long password',
    });
    expect(ok?.data).toEqual({ changed: true });
    expect(await sessionOf(here)).not.toBeNull();
    expect(await sessionOf(other)).toBeNull();
    await vi.waitFor(() =>
      expect(emailsTo(email).some((e) => e.kind === 'password-changed')).toBe(true),
    );
  });

  it('is refused for demo accounts and without a session', async () => {
    const { userId } = await signUp('demo');
    await migrator.user.update({ where: { id: userId }, data: { isDemo: true } });
    expect(
      (
        await actions.changePasswordAction({
          currentPassword: PASSWORD,
          newPassword: 'a new long password',
        })
      )?.serverError,
    ).toMatchObject({
      code: 'DEMO_READ_ONLY',
    });
    switchBrowser(newBrowser());
    expect(
      (
        await actions.changePasswordAction({
          currentPassword: PASSWORD,
          newPassword: 'a new long password',
        })
      )?.serverError,
    ).toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });
});

// ------------------------------------------------------------------ /api/auth over HTTP

describe('the /api/auth gateway', () => {
  it('closes the endpoints that the Server Actions replace', async () => {
    for (const path of [
      '/api/auth/sign-in/email',
      '/api/auth/sign-up/email',
      '/api/auth/request-password-reset',
    ]) {
      const response = await handleAuthRequest(
        new Request(new URL(path, SITE), {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-forwarded-for': '192.0.2.20' },
          body: JSON.stringify({ email: 'a@b.co', password: PASSWORD }),
        }),
        http.POST,
      );
      expect(response.status).toBe(404);
    }
  });

  it('keeps other visitors’ sessions and links away from the demo account', async () => {
    const { browser, userId } = await signUp('demo');
    await migrator.user.update({ where: { id: userId }, data: { isDemo: true } });
    expect((await get('/api/auth/list-sessions', browser)).status).toBe(404);
    const accounts = await get('/api/auth/list-accounts', browser);
    expect(accounts.status).toBe(403);
    expect(await accounts.json()).toMatchObject({ code: 'DEMO_READ_ONLY' });
  });

  it('never hands the session, its token or its address to page scripts (S7)', async () => {
    const { browser } = await signUp();
    const response = await get('/api/auth/get-session', browser);
    expect(response.status).toBe(404);
    const body = await response.text();
    expect(body).not.toMatch(/token|ipAddress|banReason/);
  });

  it('records the address the deployment trusts, not the one the client claims', async () => {
    const { email } = await signUp();
    const browser = switchBrowser(newBrowser());
    browser.ip = '203.0.113.50';
    await actions.signInAction({ email, password: PASSWORD });
    const session = await sessionOf(browser);
    expect(session?.session.ipAddress).toBe('203.0.113.50');
    expect(currentBrowser()).toBe(browser);
  });
});
