import { createOTP } from '@better-auth/utils/otp';
import { PrismaPg } from '@prisma/adapter-pg';
import { symmetricDecrypt, verifyPassword } from 'better-auth/crypto';
import { v7 as uuid } from 'uuid';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { db } from '@/server/db/client';
import { runAs } from '@/server/db/context';
import { PrismaClient } from '@/server/db/generated/client';
import {
  DEMO_ACCOUNTS,
  FANEUIL_HALL,
  SAMPLE_ACCOUNTS,
  SAMPLE_STAFF,
  sampleAccountsRefusal,
  type SeedResult,
  seedDatabase,
  staffTotpSecret,
} from '../../prisma/seeding';
import {
  BOARD_FIXTURE_NUMBERS,
  boardFixtureId,
  resetBoardFixtures,
} from '../../prisma/seeding/board';
import { quoteCart } from '@/server/modules/cart/service';
import { quote } from '@/server/modules/cart/pricing';
import { currentTermsVersion, getLegalPage } from '@/server/modules/content/service';
import { redis } from '@/server/redis';
import {
  coupons,
  FAQ_CASH_ANSWER,
  FAQ_COUPON_ANSWER,
  FREE_DELIVERY_BAR,
  PRIVACY_WHO_SEES_IT,
  SEED_CORRECTIONS,
  WELCOME10_DESCRIPTION,
} from '../../prisma/seeding/content';
import { menuItems } from '../../prisma/seeding/menu';
import { escapeHtml } from '../../prisma/seeding/rich-text';

const config = {
  authSecret: 'integration-test-secret-integration-test-secret',
  adminEmail: 'Owner@Foodz.Example',
  adminPassword: 'correct horse battery staple',
  demoPassword: 'demo-password-1',
  samplePassword: 'sample-password-1',
};

let migrator: PrismaClient;
let first: SeedResult;
let second: SeedResult;

beforeAll(async () => {
  migrator = new PrismaClient({
    adapter: new PrismaPg({ connectionString: inject('migratorUrl') }),
  });
  first = await seedDatabase(migrator, config);
  second = await seedDatabase(migrator, {
    ...config,
    demoPassword: 'demo-password-2',
    samplePassword: 'sample-password-2',
  });
}, 120_000);

afterAll(async () => {
  await migrator.$disconnect();
  await redis.quit();
});

const customerActor = (userId: string, isDemo = false) =>
  ({ kind: 'user', userId, role: 'customer', isDemo }) as const;

const userIdOf = async (email: string) =>
  (await migrator.user.findUniqueOrThrow({ where: { email }, select: { id: true } })).id;

const faqHtml = async () =>
  (
    await migrator.contentPage.findUniqueOrThrow({
      where: { slug: 'faq' },
      select: { publishedVersion: { select: { contentHtml: true, version: true } } },
    })
  ).publishedVersion!;

const privacyVersion = async () =>
  (
    await migrator.contentPage.findUniqueOrThrow({
      where: { slug: 'privacy' },
      select: {
        publishedVersion: { select: { id: true, contentHtml: true, content: true, version: true } },
      },
    })
  ).publishedVersion!;

const credentialOf = (email: string) =>
  migrator.account.findFirstOrThrow({
    where: { providerId: 'credential', user: { email } },
    select: { password: true },
  });

/** Counts addresses as the app's database role sees them for this customer. */
const addressCount = (userId: string) =>
  runAs({ kind: 'user', userId, role: 'customer', isDemo: true }, (ctx) => db(ctx).address.count());

describe('seed', () => {
  it('adds the menu, store settings, pages, promotions and blog posts', async () => {
    expect(await migrator.menuItem.count()).toBe(menuItems.length);
    expect(await migrator.menuItem.count({ where: { isSpecial: true } })).toBeGreaterThan(0);

    const [store] = await migrator.$queryRaw<{ point: string }[]>`
      SELECT ST_AsText(location::geometry) AS point FROM site_settings WHERE id = 1`;
    expect(store?.point).toMatch(/^POINT\(-71\.\d+ 42\.\d+\)$/);

    const pages = await migrator.contentPage.findMany({
      select: { slug: true, publishedVersion: { select: { contentHtml: true } } },
      orderBy: { slug: 'asc' },
    });
    expect(pages.map((page) => page.slug)).toEqual([
      'about',
      'faq',
      'privacy',
      'refund-policy',
      'terms',
    ]);
    for (const page of pages) expect(page.publishedVersion?.contentHtml).toMatch(/^<(p|h2|h3)>/);

    const publicCodes = coupons(new Date()).map((coupon) => coupon.code);
    expect(await migrator.coupon.count({ where: { code: { in: publicCodes } } })).toBe(4);
    const carousel = await migrator.campaign.findFirstOrThrow({
      where: { placement: 'HOME_CAROUSEL' },
      select: { coupon: { select: { code: true } }, _count: { select: { menuItems: true } } },
    });
    expect(carousel.coupon?.code).toBe('KBBQ5');
    expect(carousel._count.menuItems).toBe(4);

    const posts = await migrator.blogPost.findMany({
      where: { status: 'PUBLISHED' },
      select: { _count: { select: { tags: true } } },
    });
    expect(posts).toHaveLength(3);
    for (const post of posts) expect(post._count.tags).toBeGreaterThan(0);
  });

  it('creates the admin with a working password and two-factor secret', async () => {
    const admin = await migrator.user.findUniqueOrThrow({
      where: { email: 'owner@foodz.example' },
      select: { id: true, role: true, isDemo: true, twoFactorEnabled: true, emailVerified: true },
    });
    expect(admin).toMatchObject({
      role: 'admin',
      isDemo: false,
      twoFactorEnabled: true,
      emailVerified: true,
    });

    const { password } = await credentialOf('owner@foodz.example');
    expect(await verifyPassword({ hash: password!, password: config.adminPassword })).toBe(true);
    expect(await verifyPassword({ hash: password!, password: 'wrong password' })).toBe(false);

    // The stored secret decrypts with the auth secret and matches the URI handed to the owner.
    const twoFactor = await migrator.twoFactor.findFirstOrThrow({ where: { userId: admin.id } });
    const secret = await symmetricDecrypt({ key: config.authSecret, data: twoFactor.secret });
    expect(first.adminTwoFactor?.totpUri).toBe(
      createOTP(secret, { digits: 6 }).url('Foodz', 'owner@foodz.example'),
    );
    const otp = createOTP(secret, { digits: 6 });
    expect(await otp.verify(await otp.totp())).toBe(true);

    const backupCodes: unknown = JSON.parse(
      await symmetricDecrypt({ key: config.authSecret, data: twoFactor.backupCodes }),
    );
    expect(backupCodes).toEqual(first.adminTwoFactor?.backupCodes);
    expect(first.adminTwoFactor?.backupCodes).toHaveLength(10);
  });

  it('creates the demo accounts, flagged as demo', async () => {
    const users = await migrator.user.findMany({
      where: { email: { in: DEMO_ACCOUNTS.map((account) => account.email) } },
      select: { role: true, isDemo: true },
      orderBy: { email: 'asc' },
    });
    expect(users).toEqual([
      { role: 'admin', isDemo: true },
      { role: 'customer', isDemo: true },
      { role: 'partner', isDemo: true },
    ]);

    const partner = await migrator.deliveryPartner.findFirstOrThrow({
      where: { user: { email: 'demo.partner@foodz.example' } },
      select: { status: true },
    });
    expect(partner.status).toBe('APPROVED');
  });

  it('adds nothing the second time and keeps the admin secret', async () => {
    expect(second.adminTwoFactor).toBeUndefined();
    expect(Object.values(second.created).every((n) => n === 0)).toBe(true);
    expect(
      await migrator.twoFactor.count({ where: { user: { email: 'owner@foodz.example' } } }),
    ).toBe(1);
  });

  it('resets demo passwords on every run but never the admin password', async () => {
    const demo = await credentialOf('demo.customer@foodz.example');
    expect(await verifyPassword({ hash: demo.password!, password: 'demo-password-2' })).toBe(true);

    const admin = await credentialOf('owner@foodz.example');
    expect(await verifyPassword({ hash: admin.password!, password: config.adminPassword })).toBe(
      true,
    );
  });

  it('gives the demo customer an address that only they can see through the app role', async () => {
    const customer = await migrator.user.findUniqueOrThrow({
      where: { email: 'demo.customer@foodz.example' },
      select: { id: true },
    });
    expect(await addressCount(customer.id)).toBe(1);
    expect(await addressCount(uuid())).toBe(0);
  });
});

describe('F3 cart settings and copy', () => {
  it('charges Boston’s 7 % meals tax and talks about codes in the cart', async () => {
    const settings = await migrator.siteSettings.findUniqueOrThrow({
      where: { id: 1 },
      select: { taxRateBps: true },
    });
    expect(settings.taxRateBps).toBe(700);
    expect(
      await migrator.coupon.findUniqueOrThrow({
        where: { code: 'WELCOME10' },
        select: { description: true, perUserLimit: true },
      }),
    ).toEqual({ description: WELCOME10_DESCRIPTION, perUserLimit: 1 });
    const bar = await migrator.campaign.findFirstOrThrow({
      where: { placement: 'ANNOUNCEMENT_BAR' },
      select: { subtitle: true },
    });
    expect(bar.subtitle).toBe(FREE_DELIVERY_BAR);
    expect((await faqHtml()).contentHtml).toContain(escapeHtml(FAQ_COUPON_ANSWER));
    expect((await faqHtml()).contentHtml).not.toContain('at checkout. The discount');
  });

  it('corrects a database seeded before F3, once, and leaves edited values alone', async () => {
    const { taxRateBps, welcome10Description, freeDeliveryBar, faqCouponAnswer } = SEED_CORRECTIONS;
    // Put the old seeded values back, as an earlier run left them.
    await migrator.siteSettings.update({ where: { id: 1 }, data: { taxRateBps: taxRateBps.from } });
    await migrator.coupon.update({
      where: { code: 'WELCOME10' },
      data: { description: welcome10Description.from },
    });
    await migrator.campaign.updateMany({
      where: { placement: 'ANNOUNCEMENT_BAR' },
      data: { subtitle: freeDeliveryBar.from },
    });
    const page = await migrator.contentPage.findUniqueOrThrow({
      where: { slug: 'faq' },
      select: { publishedVersion: { select: { id: true, version: true, contentHtml: true } } },
    });
    const old = page.publishedVersion!;
    await migrator.contentVersion.update({
      where: { id: old.id },
      data: {
        contentHtml: old.contentHtml.replace(
          escapeHtml(faqCouponAnswer.to),
          escapeHtml(faqCouponAnswer.from),
        ),
      },
    });
    // Someone edited KBBQ5's description: never touched.
    const kbbq = await migrator.coupon.update({
      where: { code: 'KBBQ5' },
      data: { description: 'Edited by staff' },
      select: { description: true },
    });

    // The same passwords as the second run, which later tests expect.
    const rerun = {
      ...config,
      demoPassword: 'demo-password-2',
      samplePassword: 'sample-password-2',
    };
    const corrected = await seedDatabase(migrator, rerun);
    expect(corrected.created).toMatchObject({ corrections: 3, contentVersions: 1 });
    const faq = await faqHtml();
    expect(faq.version).toBe(old.version + 1);
    expect(faq.contentHtml).toContain(escapeHtml(faqCouponAnswer.to));
    expect((await migrator.siteSettings.findUniqueOrThrow({ where: { id: 1 } })).taxRateBps).toBe(
      700,
    );
    expect(
      await migrator.coupon.findUniqueOrThrow({
        where: { code: 'KBBQ5' },
        select: { description: true },
      }),
    ).toEqual(kbbq);

    const again = await seedDatabase(migrator, rerun);
    expect(Object.values(again.created).every((n) => n === 0)).toBe(true);
    await migrator.coupon.update({
      where: { code: 'KBBQ5' },
      data: { description: '$5 off Korean dishes over $25' },
    });
  });

  it('says what Stripe receives in the Privacy Policy, and publishes it on older databases once (security S14)', async () => {
    const { privacyWhoSeesIt } = SEED_CORRECTIONS;
    // A fresh seed already has it.
    const fresh = await privacyVersion();
    expect(fresh.contentHtml).toContain('Stripe');
    expect(fresh.contentHtml).toContain('delivery address');

    // A database seeded before F4 still publishes the old paragraph.
    await migrator.contentVersion.update({
      where: { id: fresh.id },
      data: {
        contentHtml: fresh.contentHtml.replace(
          escapeHtml(PRIVACY_WHO_SEES_IT),
          escapeHtml(privacyWhoSeesIt.from),
        ),
        content: JSON.parse(
          JSON.stringify(fresh.content).replace(PRIVACY_WHO_SEES_IT, privacyWhoSeesIt.from),
        ),
      },
    });
    expect((await privacyVersion()).contentHtml).not.toContain('Stripe');

    const rerun = {
      ...config,
      demoPassword: 'demo-password-2',
      samplePassword: 'sample-password-2',
    };
    const corrected = await seedDatabase(migrator, rerun);
    expect(corrected.created).toMatchObject({ contentVersions: 1 });
    const published = await privacyVersion();
    expect(published.version).toBe(fresh.version + 1);
    expect(published.contentHtml).toContain(escapeHtml(PRIVACY_WHO_SEES_IT));
    expect(JSON.stringify(published.content)).toContain(PRIVACY_WHO_SEES_IT);

    // Once: the next run publishes nothing more.
    const again = await seedDatabase(migrator, rerun);
    expect(again.created.contentVersions ?? 0).toBe(0);
    expect((await privacyVersion()).version).toBe(published.version);
  });
});

describe('sample customers (local and CI only)', () => {
  it('adds an unconfirmed, a suspended and a second customer, none of them demo logins', async () => {
    const users = await migrator.user.findMany({
      where: { email: { in: SAMPLE_ACCOUNTS.map((account) => account.email) } },
      select: {
        email: true,
        isDemo: true,
        isSample: true,
        emailVerified: true,
        banned: true,
        banReason: true,
        role: true,
      },
      orderBy: { email: 'asc' },
    });
    expect(users).toEqual([
      {
        email: 'second.customer@foodz.example',
        isDemo: false,
        isSample: true,
        emailVerified: true,
        banned: false,
        banReason: null,
        role: 'customer',
      },
      {
        email: 'suspended.customer@foodz.example',
        isDemo: false,
        isSample: true,
        emailVerified: true,
        banned: true,
        banReason: 'Repeated coupon abuse (test account)',
        role: 'customer',
      },
      {
        email: 'unconfirmed.customer@foodz.example',
        isDemo: false,
        isSample: true,
        emailVerified: false,
        banned: false,
        banReason: null,
        role: 'customer',
      },
    ]);
  });

  it('gives them their own password, reset on every run, never the shared demo password', async () => {
    for (const { email } of SAMPLE_ACCOUNTS) {
      const { password } = await credentialOf(email);
      expect(await verifyPassword({ hash: password!, password: 'sample-password-2' })).toBe(true);
      expect(await verifyPassword({ hash: password!, password: 'demo-password-2' })).toBe(false);
    }
  });

  it('are refused for any database that is not local or CI', () => {
    const local = 'postgresql://foodz_migrator:x@127.0.0.1:5433/foodz';
    expect(sampleAccountsRefusal(local, {})).toBeNull();
    expect(sampleAccountsRefusal('postgresql://u:x@localhost:5432/foodz', {})).toBeNull();
    expect(sampleAccountsRefusal('postgresql://u:x@db:5432/foodz', {})).toBeNull();
    expect(
      sampleAccountsRefusal('postgresql://u:x@postgres:5432/foodz', { CI: 'true' }),
    ).toBeNull();

    const hosted = 'postgresql://u:x@ep-demo-123.us-east-2.aws.neon.tech/foodz';
    expect(sampleAccountsRefusal(hosted, {})).toMatch(/not a local or CI database/);
    expect(sampleAccountsRefusal(local, { VERCEL_ENV: 'preview' })).toMatch(/Vercel/);
    expect(sampleAccountsRefusal(local, { VERCEL_ENV: 'production', CI: '1' })).toMatch(/Vercel/);
    expect(sampleAccountsRefusal('not a url', {})).toMatch(/could not be read/);
  });

  it('are left out when no sample password is given', async () => {
    const before = await migrator.user.count({ where: { isSample: true } });
    await seedDatabase(migrator, {
      ...config,
      demoPassword: 'demo-password-2',
      samplePassword: undefined,
    });
    expect(await migrator.user.count({ where: { isSample: true } })).toBe(before);
    const { password } = await credentialOf('second.customer@foodz.example');
    expect(await verifyPassword({ hash: password!, password: 'sample-password-2' })).toBe(true);
  });

  it('gives the second customer a Work address inside the area, and the demo Home its kind', async () => {
    const work = await migrator.address.findFirstOrThrow({
      where: { user: { email: 'second.customer@foodz.example' } },
      select: { kind: true, label: true, line1: true, isDefault: true, lat: true, lng: true },
    });
    // Where the address search puts it, so a guest checking it gets the same distance (F6).
    expect(work).toEqual({
      kind: 'WORK',
      label: 'Work',
      line1: '1 Faneuil Hall Square',
      isDefault: true,
      ...FANEUIL_HALL,
    });
    const home = await migrator.address.findFirstOrThrow({
      where: { user: { email: 'demo.customer@foodz.example' } },
      select: { kind: true },
    });
    expect(home.kind).toBe('HOME');
  });
});

describe('F3 fixtures (local and CI only)', () => {
  it('adds the codes for refusals nobody could reach otherwise', async () => {
    const priya = await userIdOf('second.customer@foodz.example');
    const rows = await migrator.coupon.findMany({
      where: { code: { in: ['NEXTWEEK', 'FIRST100', 'PAUSED20', 'CREDIT-PRIYA-7Q2XK9'] } },
      select: {
        code: true,
        startsAt: true,
        usageLimit: true,
        usedCount: true,
        isActive: true,
        ownerUserId: true,
        isStoreCredit: true,
        value: true,
      },
      orderBy: { code: 'asc' },
    });
    expect(rows.map((row) => row.code)).toEqual([
      'CREDIT-PRIYA-7Q2XK9',
      'FIRST100',
      'NEXTWEEK',
      'PAUSED20',
    ]);
    const [credit, usedUp, next, paused] = rows;
    expect(credit).toMatchObject({ ownerUserId: priya, isStoreCredit: true, value: 800 });
    expect(usedUp).toMatchObject({ usageLimit: 100, usedCount: 100 });
    expect(next!.startsAt.getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 60 * 60 * 1000);
    expect(paused!.isActive).toBe(false);
  });

  it('gives the second customer a delivered WELCOME10 order whose figures quote() agrees with', async () => {
    const priya = await userIdOf('second.customer@foodz.example');
    const order = await migrator.order.findFirstOrThrow({
      where: { userId: priya, number: 'S1001' },
      select: {
        status: true,
        subtotalCents: true,
        discountCents: true,
        deliveryFeeCents: true,
        taxCents: true,
        totalCents: true,
        coupon: { select: { code: true } },
        redemption: { select: { status: true, discountCents: true } },
        items: { select: { quantity: true, unitPriceCents: true } },
      },
    });
    expect(order).toMatchObject({
      status: 'DELIVERED',
      coupon: { code: 'WELCOME10' },
      redemption: { status: 'REDEEMED', discountCents: 260 },
      items: [{ quantity: 2, unitPriceCents: 1299 }],
    });
    const figures = quote({
      lines: [
        { key: 'gimbap', status: 'ok', cuisine: 'KOREAN', unitPriceCents: 1299, quantity: 2 },
      ],
      promo: {
        kind: 'lookup',
        code: 'WELCOME10',
        customer: { userId: priya, redeemed: 0, heldBy: [] },
        coupon: {
          code: 'WELCOME10',
          description: null,
          type: 'PERCENT',
          value: 10,
          minSubtotalCents: 1500,
          maxDiscountCents: 1000,
          usageLimit: null,
          usedCount: 0,
          perUserLimit: 1,
          cuisines: [],
          ownerUserId: null,
          isStoreCredit: false,
          isActive: true,
          startsAt: new Date(0),
          endsAt: null,
        },
      },
      delivery: { status: 'inside', distanceMeters: 1400 },
      settings: {
        taxRateBps: 700,
        baseDeliveryFeeCents: 199,
        perKmFeeCents: 50,
        deliveryRadiusKm: 8,
      },
      now: new Date(),
    });
    expect([
      order.subtotalCents,
      order.discountCents,
      order.deliveryFeeCents,
      order.taxCents,
      order.totalCents,
    ]).toEqual([
      figures.subtotalCents,
      figures.promo!.amountCents,
      figures.delivery.feeCents,
      figures.tax.cents,
      figures.totalCents,
    ]);
  });

  it('makes R6 and the personal code testable in the cart (S4.4 table, S4.16)', async () => {
    const priya = await userIdOf('second.customer@foodz.example');
    const dana = await userIdOf('demo.customer@foodz.example');
    const gimbap = await migrator.menuItem.findUniqueOrThrow({
      where: { slug: 'gimbap' },
      select: { id: true },
    });
    const cart = { lines: [{ key: 'a', menuItemId: gimbap.id, quantity: 2 }] };
    const ip = { ip: `seed-${uuid()}` };

    const welcome = await quoteCart(customerActor(priya), { ...cart, code: 'WELCOME10' }, ip);
    expect(welcome.promo?.reason).toMatchObject({ code: 'alreadyUsed', rule: 'R6' });
    const own = await quoteCart(customerActor(priya), { ...cart, code: 'credit-priya-7q2xk9' }, ip);
    expect(own.promo).toMatchObject({ status: 'applied', foodDiscountCents: 800 });
    const other = await quoteCart(
      customerActor(dana, true),
      { ...cart, code: 'CREDIT-PRIYA-7Q2XK9' },
      ip,
    );
    expect(other.promo?.reason).toMatchObject({ code: 'notFound', rule: 'R1' });
  });

  it('gives the demo customer two favorites, one of them sold out, seen only by them', async () => {
    const dana = await userIdOf('demo.customer@foodz.example');
    const favorites = await runAs(
      { kind: 'user', userId: dana, role: 'customer', isDemo: true },
      (ctx) =>
        db(ctx).favorite.findMany({
          select: { menuItem: { select: { slug: true, isAvailable: true } } },
          orderBy: { createdAt: 'desc' },
        }),
    );
    expect(favorites.map((row) => row.menuItem)).toEqual([
      { slug: 'bulgogi', isAvailable: true },
      { slug: 'naengmyeon', isAvailable: false },
    ]);
  });
});

describe('F4 fixtures (local and CI only, B23)', () => {
  it('gives Priya her profile phone, on every run', async () => {
    const priya = await migrator.user.findUniqueOrThrow({
      where: { email: 'second.customer@foodz.example' },
      select: { phone: true },
    });
    expect(priya.phone).toBe('+16175550123');
    const jordan = await migrator.user.findUniqueOrThrow({
      where: { email: 'unconfirmed.customer@foodz.example' },
      select: { phone: true },
    });
    expect(jordan.phone).toBeNull();
  });

  it('adds LASTONE with one use, and puts its use back on every run (S8.4)', async () => {
    await migrator.coupon.update({ where: { code: 'LASTONE' }, data: { usedCount: 1 } });
    await seedDatabase(migrator, {
      ...config,
      demoPassword: 'demo-password-2',
      samplePassword: 'sample-password-2',
    });
    expect(
      await migrator.coupon.findUniqueOrThrow({
        where: { code: 'LASTONE' },
        select: { type: true, value: true, usageLimit: true, usedCount: true },
      }),
    ).toEqual({ type: 'FIXED', value: 200, usageLimit: 1, usedCount: 0 });
  });

  it("keeps S1001's address, instructions, arrival window and timeline so its page renders", async () => {
    const priya = await userIdOf('second.customer@foodz.example');
    const order = await migrator.order.findFirstOrThrow({
      where: { userId: priya, number: 'S1001' },
      select: {
        addressLabel: true,
        addressLine1: true,
        addressCity: true,
        courierInstructions: true,
        taxRateBps: true,
        promoCode: true,
        arrivalFromMinutes: true,
        arrivalToMinutes: true,
        events: { select: { type: true }, orderBy: { createdAt: 'asc' } },
      },
    });
    expect(order).toEqual({
      addressLabel: 'Work',
      addressLine1: '1 Faneuil Hall Square',
      addressCity: 'Boston, MA 02109',
      courierInstructions: 'Front desk takes deliveries',
      taxRateBps: 700,
      promoCode: 'WELCOME10',
      arrivalFromMinutes: 35,
      arrivalToMinutes: 45,
      events: [{ type: 'placed' }, { type: 'delivered' }],
    });
  });

  it('says cash is for orders up to $100 in the FAQ', async () => {
    expect((await faqHtml()).contentHtml).toContain(escapeHtml(FAQ_CASH_ANSWER));
  });
});

describe('legal pages', () => {
  it('reads the published Terms and Privacy Policy as plain blocks', async () => {
    const terms = await getLegalPage('terms');
    expect(terms).toMatchObject({ slug: 'terms', title: 'Terms and Conditions', version: 1 });
    expect(terms?.blocks[0]).toEqual({
      type: 'paragraph',
      text: 'Foodz is a demonstration store. Orders placed here are not cooked or delivered, and card payments run in test mode only.',
    });
    expect(terms?.blocks).toContainEqual({ type: 'heading', level: 2, text: 'Using Foodz' });

    const privacy = await getLegalPage('privacy');
    expect(privacy?.blocks).toContainEqual(expect.objectContaining({ type: 'list' }));
    expect(privacy?.blocks).toContainEqual({
      type: 'paragraph',
      text: 'From your account page you can download a copy of your data or delete your account at any time.',
    });
    expect(await currentTermsVersion()).toBe(1);
  });

  it('returns nothing for other or malformed slugs', async () => {
    expect(await getLegalPage('faq')).toBeNull();
    expect(await getLegalPage('../terms')).toBeNull();
  });
});

describe('F5 board fixtures and sample staff (local and CI only)', () => {
  it('adds the sample staff, two-factor on all but Casey, with a secret stable across runs', async () => {
    const staff = await migrator.user.findMany({
      where: { email: { in: SAMPLE_STAFF.map((member) => member.email) } },
      select: { email: true, role: true, isSample: true, isDemo: true, twoFactorEnabled: true },
      orderBy: { email: 'asc' },
    });
    expect(staff).toEqual(
      SAMPLE_STAFF.map((member) => ({
        email: member.email,
        role: member.role,
        isSample: true,
        isDemo: false,
        twoFactorEnabled: member.twoFactor,
      })).toSorted((a, b) => a.email.localeCompare(b.email)),
    );
    expect(first.staffTwoFactor?.map((member) => member.email)).toEqual([
      'kitchen@foodz.example',
      'support@foodz.example',
      'editor@foodz.example',
    ]);
    expect(second.staffTwoFactor?.map((member) => member.totpUri)).toEqual(
      first.staffTwoFactor?.map((member) => member.totpUri),
    );
    expect(second.staffTwoFactor?.[0]?.backupCodes).not.toEqual(
      first.staffTwoFactor?.[0]?.backupCodes,
    );
    const kitchen = await migrator.twoFactor.findFirstOrThrow({
      where: { user: { email: 'kitchen@foodz.example' } },
      select: { secret: true },
    });
    const secret = await symmetricDecrypt({ key: config.authSecret, data: kitchen.secret });
    expect(secret).toBe(staffTotpSecret(config.authSecret, 'kitchen@foodz.example'));
  });

  it('seeds S1101 to S1108 in every board state, with their timelines and no Stripe payment', async () => {
    const fixtures = await migrator.order.findMany({
      where: { number: { in: [...BOARD_FIXTURE_NUMBERS] } },
      orderBy: { number: 'asc' },
      select: {
        number: true,
        status: true,
        paymentMethod: true,
        stripePaymentIntentId: true,
        note: true,
        cancelReason: true,
        cancelCode: true,
        prepMinutes: true,
        events: { select: { type: true, data: true }, orderBy: { createdAt: 'asc' } },
        items: { select: { title: true, note: true } },
      },
    });
    expect(fixtures.map((order) => [order.number, order.status, order.paymentMethod])).toEqual([
      ['S1101', 'PLACED', 'CARD'],
      ['S1102', 'PLACED', 'CASH'],
      ['S1103', 'ACCEPTED', 'CASH'],
      ['S1104', 'PREPARING', 'CASH'],
      ['S1105', 'PREPARING', 'CARD'],
      ['S1106', 'READY', 'CASH'],
      ['S1107', 'READY', 'CARD'],
      ['S1108', 'CANCELLED', 'CASH'],
    ]);
    expect(fixtures.every((order) => order.stripePaymentIntentId === null)).toBe(true);
    const byNumber = Object.fromEntries(fixtures.map((order) => [order.number, order]));
    expect(byNumber.S1101?.note).toBe('More spicy, more sauce');
    expect(byNumber.S1101?.prepMinutes).toBe(24);
    expect(byNumber.S1105?.note).toBe('<b>extra rice</b>');
    expect(byNumber.S1103?.items).toEqual([{ title: 'Kimchi', note: 'No sesame please' }]);
    expect(byNumber.S1104?.events.map((event) => event.type)).toEqual([
      'created',
      'placed',
      'accepted',
      'preparing',
    ]);
    expect(byNumber.S1108).toMatchObject({ cancelReason: 'staff', cancelCode: 'customer-asked' });
    expect(byNumber.S1108?.events.at(-1)?.data).toMatchObject({
      by: { name: 'Morgan Diaz', role: 'support' },
      note: 'Called back to confirm',
    });
  });

  it('puts the fixtures back with seed:board, leaving every other order alone', async () => {
    const s1101 = boardFixtureId('S1101');
    await migrator.order.update({ where: { id: s1101 }, data: { status: 'ACCEPTED' } });
    await migrator.orderEvent.create({ data: { orderId: s1101, type: 'accepted' } });
    const s1001 = await migrator.order.findFirstOrThrow({
      where: { number: 'S1001' },
      select: { id: true, updatedAt: true },
    });
    const people = {
      priya: await userIdOf('second.customer@foodz.example'),
      dana: await userIdOf('demo.customer@foodz.example'),
      alex: await userIdOf('kitchen@foodz.example'),
      morgan: await userIdOf('support@foodz.example'),
    };
    expect(
      await migrator.$transaction((tx) => resetBoardFixtures(tx, people, new Date()), {
        timeout: 30_000,
      }),
    ).toBe(0);
    const reset = await migrator.order.findUniqueOrThrow({
      where: { id: s1101 },
      select: { status: true, events: { select: { type: true } } },
    });
    expect(reset.status).toBe('PLACED');
    expect(reset.events.map((event) => event.type).toSorted()).toEqual([
      'created',
      'paid',
      'placed',
    ]);
    expect(
      (
        await migrator.order.findUniqueOrThrow({
          where: { id: s1001.id },
          select: { updatedAt: true },
        })
      ).updatedAt,
    ).toEqual(s1001.updatedAt);
  });
});
