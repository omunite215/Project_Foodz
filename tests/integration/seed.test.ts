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
  SAMPLE_ACCOUNTS,
  type SeedResult,
  seedDatabase,
} from '../../prisma/seeding';
import { currentTermsVersion, getLegalPage } from '@/server/modules/content/service';
import { menuItems } from '../../prisma/seeding/menu';

const config = {
  authSecret: 'integration-test-secret-integration-test-secret',
  adminEmail: 'Owner@Foodz.Example',
  adminPassword: 'correct horse battery staple',
  demoPassword: 'demo-password-1',
  sampleAccounts: true,
};

let migrator: PrismaClient;
let first: SeedResult;
let second: SeedResult;

beforeAll(async () => {
  migrator = new PrismaClient({
    adapter: new PrismaPg({ connectionString: inject('migratorUrl') }),
  });
  first = await seedDatabase(migrator, config);
  second = await seedDatabase(migrator, { ...config, demoPassword: 'demo-password-2' });
}, 120_000);

afterAll(async () => {
  await migrator.$disconnect();
});

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

    expect(await migrator.coupon.count()).toBe(4);
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

describe('sample customers (local and demo only)', () => {
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
    const { password } = await credentialOf('second.customer@foodz.example');
    expect(await verifyPassword({ hash: password!, password: 'demo-password-2' })).toBe(true);
  });

  it('gives the second customer a Work address inside the area, and the demo Home its kind', async () => {
    const work = await migrator.address.findFirstOrThrow({
      where: { user: { email: 'second.customer@foodz.example' } },
      select: { kind: true, label: true, line1: true, isDefault: true },
    });
    expect(work).toEqual({
      kind: 'WORK',
      label: 'Work',
      line1: '1 Faneuil Hall Square',
      isDefault: true,
    });
    const home = await migrator.address.findFirstOrThrow({
      where: { user: { email: 'demo.customer@foodz.example' } },
      select: { kind: true },
    });
    expect(home.kind).toBe('HOME');
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
