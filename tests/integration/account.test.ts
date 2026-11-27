import { PrismaPg } from '@prisma/adapter-pg';
import { v7 as uuid } from 'uuid';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it, vi } from 'vitest';
import { PrismaClient } from '@/server/db/generated/client';
import { redis } from '@/server/redis';
import { seedCatalog } from '../../prisma/seeding';
import {
  asBrowser,
  type Browser,
  nextHeaders,
  newBrowser,
  requestHeaders,
  switchBrowser,
} from './support/browser';

const mocks = vi.hoisted(() => ({
  send: vi.fn<(event: { data: { sealed: string } }) => Promise<unknown>>(),
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

const { auth } = await import('@/server/auth');
const { unsealAccountEmail } = await import('@/server/modules/notifications/account-email');
const authActions = await import('@/server/modules/auth/actions');
const account = await import('@/server/modules/account/actions');
const addresses = await import('@/server/modules/addresses/actions');

const PASSWORD = 'correct horse battery';
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36';

let migrator: PrismaClient;

const sent = () => mocks.send.mock.calls.map(([event]) => unsealAccountEmail(event.data.sealed));

async function signUp(tag = 'maya') {
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

async function signInElsewhere(email: string, userAgent = ANDROID_CHROME) {
  const browser = switchBrowser(newBrowser(userAgent));
  expect((await authActions.signInAction({ email, password: PASSWORD }))?.data?.status).toBe(
    'signed-in',
  );
  return browser;
}

const sessionOf = (browser: Browser) =>
  asBrowser(browser, () => auth.api.getSession({ headers: requestHeaders(browser) }));

const peterborough = {
  kind: 'HOME' as const,
  line1: '12 Peterborough Street',
  line2: 'Apt 3',
  city: 'Boston, MA 02215',
  notes: 'Buzzer 3',
  lat: 42.3467,
  lng: -71.0972,
};

beforeAll(async () => {
  migrator = new PrismaClient({
    adapter: new PrismaPg({ connectionString: inject('migratorUrl') }),
  });
  await migrator.$transaction((tx) => seedCatalog(tx, { now: new Date() }), { timeout: 60_000 });
}, 120_000);

beforeEach(() => {
  mocks.send.mockReset().mockResolvedValue({ ids: ['evt'] });
});

afterAll(async () => {
  await migrator.$disconnect();
  await redis.quit();
});

describe('account summary', () => {
  it('has everything the account layout needs', async () => {
    const { email, browser } = await signUp();
    await signInElsewhere(email);
    switchBrowser(browser);
    await addresses.createAddressAction(peterborough);

    const result = await account.getAccountAction();
    expect(result?.data).toMatchObject({
      name: 'Maya Lopez',
      firstName: 'Maya',
      email,
      emailVerified: false,
      phone: null,
      role: 'customer',
      isDemo: false,
      isStaff: false,
      twoFactorEnabled: false,
      hasPassword: true,
      googleLinked: false,
      signInMethods: ['password'],
      addressCount: 1,
      deviceCount: 2,
      termsAcceptedVersion: expect.any(Number) as number,
      canEditProfile: true,
      canDelete: true,
      deleteBlockedReason: null,
    });
  });

  it('shows the demo account as confirmed, read-only and on one device', async () => {
    const { userId, email } = await signUp('demo');
    await migrator.user.update({ where: { id: userId }, data: { isDemo: true } });
    await signInElsewhere(email);
    expect((await account.getAccountAction())?.data).toMatchObject({
      isDemo: true,
      emailVerified: true,
      deviceCount: 1,
      canEditProfile: false,
      canDelete: false,
      deleteBlockedReason: 'demo',
    });
  });

  it('refuses callers without a session', async () => {
    switchBrowser(newBrowser());
    expect((await account.getAccountAction())?.serverError).toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });
});

describe('profile (S5.1 to S5.3)', () => {
  it('saves a name in any script and a phone in one canonical form', async () => {
    await signUp();
    for (const phone of ['(617) 555-0142', '617-555-0142', '+1 617 555 0142']) {
      const result = await account.updateProfileAction({ name: '  Nguyễn   Thị Minh ', phone });
      expect(result?.data).toMatchObject({
        name: 'Nguyễn Thị Minh',
        phone: '+16175550142',
        phoneCountry: 'US',
        phoneDisplay: '(617) 555-0142',
      });
    }
    const vietnam = await account.updateProfileAction({
      name: '김민지',
      phone: '+84 123 465 798',
      phoneCountry: 'VN',
    });
    expect(vietnam?.data).toMatchObject({
      name: '김민지',
      phone: '+84123465798',
      phoneCountry: 'VN',
    });
    const cleared = await account.updateProfileAction({ name: 'Maya', phone: '' });
    expect(cleared?.data).toMatchObject({ phone: null, phoneDisplay: null });
  });

  it('refuses an empty name, a number that cannot be called, and extra fields', async () => {
    await signUp();
    expect((await account.updateProfileAction({ name: '   ' }))?.validationErrors).toBeDefined();
    const badPhone = await account.updateProfileAction({ name: 'Maya', phone: '555-0142' });
    expect(badPhone?.validationErrors).toMatchObject({
      phone: { _errors: ['Enter a number we can call, like (617) 555-0142.'] },
    });
    expect(
      (await account.updateProfileAction({ name: 'Maya', email: 'x@y.co' } as never))
        ?.validationErrors,
    ).toBeDefined();
  });

  it('is read-only for the demo account', async () => {
    const { userId } = await signUp('demo');
    await migrator.user.update({ where: { id: userId }, data: { isDemo: true } });
    expect((await account.updateProfileAction({ name: 'Taken over' }))?.serverError).toEqual({
      code: 'DEMO_READ_ONLY',
      message: "Demo accounts can't change this.",
    });
  });
});

describe('devices (S5.6, S5.7)', () => {
  it('lists this device first, with names and no addresses or tokens', async () => {
    const { email, browser } = await signUp();
    await signInElsewhere(email);
    switchBrowser(browser);
    const devices = (await account.listDevicesAction())?.data ?? [];
    expect(devices).toHaveLength(2);
    expect(devices[0]).toMatchObject({ isCurrent: true, label: 'Safari on iPhone', type: 'phone' });
    expect(devices[1]).toMatchObject({ isCurrent: false, label: 'Chrome on Android' });
    expect(Object.keys(devices[0]!).toSorted()).toEqual(
      [
        'browser',
        'id',
        'isCurrent',
        'label',
        'lastActiveAt',
        'signedInAt',
        'system',
        'type',
      ].toSorted(),
    );
  });

  it('signs out one other device, then all others, but never someone else’s', async () => {
    const { email, browser } = await signUp();
    const phone = await signInElsewhere(email);
    const laptop = await signInElsewhere(
      email,
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0 Safari/537.36',
    );
    const stranger = await signUp('stranger');
    const strangerSession = (await sessionOf(stranger.browser))!.session.id;

    switchBrowser(browser);
    const phoneSession = (await sessionOf(phone))!.session.id;
    expect((await account.signOutDeviceAction({ id: phoneSession }))?.data).toEqual({
      id: phoneSession,
    });
    expect(await sessionOf(phone)).toBeNull();

    expect((await account.signOutDeviceAction({ id: strangerSession }))?.serverError).toEqual({
      code: 'NOT_FOUND',
      message: 'That device is no longer signed in.',
    });
    expect(await sessionOf(stranger.browser)).not.toBeNull();

    const current = (await sessionOf(browser))!.session.id;
    expect((await account.signOutDeviceAction({ id: current }))?.serverError).toMatchObject({
      code: 'CONFLICT',
    });

    expect((await account.signOutOtherDevicesAction())?.data).toEqual({ signedOut: 1 });
    expect(await sessionOf(laptop)).toBeNull();
    expect(await sessionOf(browser)).not.toBeNull();
  });

  it('shows the demo account only this device and lets it sign out nothing else', async () => {
    const { email, userId } = await signUp('demo');
    await migrator.user.update({ where: { id: userId }, data: { isDemo: true } });
    const other = await signInElsewhere(email);
    const here = await signInElsewhere(email);
    expect((await account.listDevicesAction())?.data).toHaveLength(1);
    expect((await account.signOutOtherDevicesAction())?.serverError).toMatchObject({
      code: 'DEMO_READ_ONLY',
    });
    expect(await sessionOf(other)).not.toBeNull();
    expect(here).toBeDefined();
  });
});

describe('download my data (S6.1 to S6.3)', () => {
  it('holds only the caller’s own data, never secrets', async () => {
    const stranger = await signUp('stranger');
    await addresses.createAddressAction({ ...peterborough, notes: 'stranger notes' });
    const { email, browser, userId } = await signUp();
    await addresses.createAddressAction(peterborough);
    switchBrowser(browser);

    const response = await account.exportMyDataAction();
    expect(response?.serverError).toBeUndefined();
    const result = response?.data;
    expect(result?.fileName).toMatch(/^foodz-data-\d{4}-\d{2}-\d{2}\.json$/);
    expect(result?.data.profile).toMatchObject({
      name: 'Maya Lopez',
      email,
      emailConfirmed: false,
    });
    expect(result?.data.addresses).toEqual([
      expect.objectContaining({
        type: 'Home',
        address: '12 Peterborough Street',
        apartment: 'Apt 3',
        isDefault: true,
      }),
    ]);
    expect(result?.data.devices).toEqual([
      expect.objectContaining({ device: 'Safari on iPhone', thisDevice: true }),
    ]);

    const { profile, addresses: saved, devices } = result!.data;
    const text = JSON.stringify({ profile, saved, devices });
    expect(text).not.toContain(stranger.email);
    expect(text).not.toContain('stranger notes');
    expect(text).not.toMatch(/password|token|ipAddress|secret|backup/i);
    expect(result?.data.about.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
    expect(
      await migrator.auditLog.count({
        where: { action: 'account.data-exported', targetId: userId },
      }),
    ).toBe(1);
  });

  it('allows five downloads an hour', async () => {
    await signUp();
    for (let i = 0; i < 5; i++) expect((await account.exportMyDataAction())?.data).toBeDefined();
    const sixth = await account.exportMyDataAction();
    expect(sixth?.serverError?.message).toMatch(
      /^You can download your data again in (\d+ minutes?|1 hour)\.$/,
    );
  });
});

async function placeOrder(userId: string, status: 'DELIVERED' | 'PREPARING') {
  return migrator.order.create({
    data: {
      number: `T-${uuid().slice(-8)}`,
      userId,
      status,
      paymentMethod: 'CASH',
      contactName: 'Maya Lopez',
      contactPhone: '+16175550142',
      addressText: '12 Peterborough Street, Apt 3',
      addressLat: 42.346712,
      addressLng: -71.097234,
      distanceKm: 4.3,
      subtotalCents: 2000,
      deliveryFeeCents: 300,
      taxCents: 125,
      totalCents: 2425,
    },
    select: { id: true },
  });
}

describe('deleting the account (S6.4 to S6.7)', () => {
  it('anonymises the person, keeps orders for accounting and frees the email', async () => {
    const { email, browser, userId } = await signUp();
    await addresses.createAddressAction(peterborough);
    const other = await signInElsewhere(email);
    const order = await placeOrder(userId, 'DELIVERED');
    switchBrowser(browser);

    expect((await account.deleteAccountAction({}))?.data).toEqual({ deleted: true });
    expect(browser.jar.get('foodz_flash')).toBe('account-deleted');
    expect([...browser.jar.keys()].some((name) => name.includes('session_token'))).toBe(false);
    expect(await sessionOf(other)).toBeNull();

    const user = await migrator.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user).toMatchObject({
      name: 'Deleted customer',
      email: `deleted-${userId}@deleted.invalid`,
      phone: null,
    });
    expect(user.deletedAt).toBeInstanceOf(Date);
    expect(await migrator.account.count({ where: { userId } })).toBe(0);
    expect(await migrator.address.count({ where: { userId } })).toBe(0);
    const kept = await migrator.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(kept).toMatchObject({
      contactName: 'Deleted customer',
      contactPhone: '',
      addressText: 'Address removed',
      totalCents: 2425,
      addressLat: 42.35,
      addressLng: -71.1,
    });
    expect(
      await migrator.auditLog.count({ where: { action: 'account.deleted', targetId: userId } }),
    ).toBe(1);
    await vi.waitFor(() =>
      expect(
        sent()
          .filter((e) => e.kind === 'account-deleted')
          .map((e) => e.to),
      ).toEqual([email]),
    );

    // The old details no longer work, a reset sends nothing, and the email can sign up again.
    switchBrowser(newBrowser());
    expect((await authActions.signInAction({ email, password: PASSWORD }))?.serverError?.code).toBe(
      'INVALID_CREDENTIALS',
    );
    mocks.send.mockClear();
    await authActions.requestPasswordResetAction({ email, captchaToken: 'ok' });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(sent()).toHaveLength(0);
    switchBrowser(newBrowser());
    const again = await authActions.signUpAction({
      name: 'Maya',
      email,
      password: PASSWORD,
      captchaToken: 'ok',
    });
    expect(again?.data?.signedIn).toBe(true);
    expect((await account.getAccountAction())?.data).toMatchObject({ addressCount: 0, email });
  });

  it('asks a stale session to confirm with the password first (S5.11)', async () => {
    const { browser, userId } = await signUp();
    await migrator.session.updateMany({
      where: { userId },
      data: { createdAt: new Date(Date.now() - 11 * 60 * 1000) },
    });
    switchBrowser(browser);
    expect((await account.deleteAccountAction({}))?.serverError).toEqual({
      code: 'REAUTH_REQUIRED',
      message: "Confirm it's you to continue.",
      details: { methods: ['password'] },
    });
    expect(
      (await account.deleteAccountAction({ password: 'not my password' }))?.serverError,
    ).toMatchObject({
      code: 'INVALID_INPUT',
      fieldErrors: { password: ["That password isn't right. Try again."] },
    });
    expect((await account.deleteAccountAction({ password: PASSWORD }))?.data).toEqual({
      deleted: true,
    });
  });

  it('waits while an order is on its way', async () => {
    const { userId } = await signUp();
    await placeOrder(userId, 'PREPARING');
    expect((await account.deleteAccountAction({}))?.serverError).toEqual({
      code: 'CONFLICT',
      message: "You have an order on its way. You can delete your account once it's delivered.",
    });
    expect((await migrator.user.findUniqueOrThrow({ where: { id: userId } })).deletedAt).toBeNull();
  });

  it("is refused for a partner whose Foodz balance isn't settled (F9 P61.2, T20)", async () => {
    const { userId } = await signUp('partner');
    await migrator.user.update({ where: { id: userId }, data: { role: 'partner' } });
    const partner = await migrator.deliveryPartner.create({
      data: {
        userId,
        status: 'APPROVED',
        vehicleType: 'SCOOTER',
        approvedAt: new Date(),
        version: 2,
      },
      select: { id: true },
    });
    // Foodz owes him $3.00 (a bonus recorded by staff).
    await migrator.$executeRaw`
      SELECT app_append_entry(${partner.id}::uuid, 'BONUS', 300, NULL, 'bonus', 'Thanks', NULL, NULL, NULL,
        'REAL', ${uuid()}, app_now(), 'staff')`;
    expect((await account.deleteAccountAction({}))?.serverError).toEqual({
      code: 'BALANCE_NOT_SETTLED',
      message:
        "Your Foodz balance isn't settled yet. Call Foodz Kitchen before deleting your account.",
    });
    expect((await migrator.user.findUniqueOrThrow({ where: { id: userId } })).deletedAt).toBeNull();
    // Paid out: square, so the account can go; his ledger rows stay for accounting.
    await migrator.$executeRaw`
      SELECT app_append_entry(${partner.id}::uuid, 'PAYOUT', -300, NULL, NULL, NULL, 'bank-transfer', NULL,
        app_store_date(app_now()), 'REAL', ${uuid()}, app_now(), 'staff')`;
    expect((await account.deleteAccountAction({}))?.data).toEqual({ deleted: true });
    expect(await migrator.partnerEarning.count({ where: { partnerId: partner.id } })).toBe(2);
  });

  it('is refused for the demo account and for staff', async () => {
    const demo = await signUp('demo');
    await migrator.user.update({ where: { id: demo.userId }, data: { isDemo: true } });
    expect((await account.deleteAccountAction({}))?.serverError).toEqual({
      code: 'DEMO_READ_ONLY',
      message: "Demo accounts can't change this.",
    });

    const staff = await signUp('staff');
    await migrator.user.update({ where: { id: staff.userId }, data: { role: 'kitchen' } });
    expect((await account.deleteAccountAction({}))?.serverError).toEqual({
      code: 'FORBIDDEN',
      message: 'Staff accounts are removed by an admin.',
    });
  });
});

describe('notices', () => {
  it('dismisses the welcome notice', async () => {
    const { browser } = await signUp();
    expect(browser.jar.get('foodz_welcome')).toBe('1');
    expect((await account.dismissNoticeAction({ notice: 'welcome' }))?.data).toEqual({
      dismissed: 'welcome',
    });
    expect(browser.jar.has('foodz_welcome')).toBe(false);
    expect(
      (await account.dismissNoticeAction({ notice: 'other' } as never))?.validationErrors,
    ).toBeDefined();
  });
});
