import { createOTP } from '@better-auth/utils/otp';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { generateRandomString, symmetricEncrypt } from 'better-auth/crypto';
import { v5 as uuidv5, v7 as uuidv7 } from 'uuid';
import type { PrismaClient } from '../../server/db/generated/client';
import { blogPosts, campaigns, contentPages, coupons, siteSettings, tags } from './content';
import { menuItems } from './menu';

/*
 * Seeds an empty database with everything a fresh install needs: the menu, store settings,
 * site pages, promotions, blog posts, one real admin and the public demo accounts.
 *
 * Safe to run again: existing rows are left as they are, so edits made in the admin are never
 * overwritten. Only the demo accounts are reset (role, flags and password).
 */

export interface SeedConfig {
  /** BETTER_AUTH_SECRET: needed to encrypt the admin's two-factor secret the way sign-in expects. */
  authSecret: string;
  adminEmail: string;
  adminPassword: string;
  demoPassword: string;
  /**
   * Adds the sample customers below (local and demo deployments only, never production):
   * an unconfirmed one, a suspended one and a second customer with an address.
   */
  sampleAccounts?: boolean;
  now?: Date;
}

export interface SeedResult {
  /** Present only when the admin was created by this run: shown once, never stored in clear. */
  adminTwoFactor?: { totpUri: string; backupCodes: string[] };
  created: Record<string, number>;
}

export type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

// Fixed ids for seeded rows that have no natural unique key, so a second run finds them.
const NAMESPACE = '8c1d7a52-5b1e-4f0e-9a37-2f4b9d0c6e11';
const seedId = (name: string) => uuidv5(name, NAMESPACE);

export const DEMO_ACCOUNTS = [
  { email: 'demo.customer@foodz.example', name: 'Dana Customer', role: 'customer' },
  { email: 'demo.partner@foodz.example', name: 'Riley Courier', role: 'partner' },
  { email: 'demo.admin@foodz.example', name: 'Demo Admin', role: 'admin' },
] as const;

/**
 * Sample customers for trying the sign-in and address rules (Decision 15). They are ordinary
 * accounts, not demo logins, so they behave like real customers; `isSample` shows them in full
 * to the demo admin. Password: DEMO_PASSWORD.
 */
export const SAMPLE_ACCOUNTS = [
  {
    email: 'unconfirmed.customer@foodz.example',
    name: 'Jordan Lee',
    emailVerified: false,
    banned: false,
    banReason: null,
  },
  {
    email: 'suspended.customer@foodz.example',
    name: 'Sam Rivera',
    emailVerified: true,
    banned: true,
    banReason: 'Repeated coupon abuse (test account)',
  },
  {
    email: 'second.customer@foodz.example',
    name: 'Priya Shah',
    emailVerified: true,
    banned: false,
    banReason: null,
  },
] as const;

const TERMS_VERSION = 1;

export async function seedDatabase(prisma: PrismaClient, config: SeedConfig): Promise<SeedResult> {
  const now = config.now ?? new Date();

  // Hash with the same settings the app uses, before the transaction (scrypt is slow).
  const auth = betterAuth({
    baseURL: 'http://localhost',
    secret: config.authSecret,
    database: prismaAdapter(prisma, { provider: 'postgresql' }),
    emailAndPassword: { enabled: true },
  });
  const authContext = await auth.$context;
  const [adminHash, demoHash] = await Promise.all([
    authContext.password.hash(config.adminPassword),
    authContext.password.hash(config.demoPassword),
  ]);
  const encrypt = (data: string) => symmetricEncrypt({ key: authContext.secretConfig, data });

  return prisma.$transaction(
    async (tx) => {
      const created: Record<string, number> = {};
      const count = (key: string, wasCreated: boolean) => {
        if (wasCreated) created[key] = (created[key] ?? 0) + 1;
      };

      // -------------------------------------------------------------- people
      const admin = await upsertUser(tx, {
        email: config.adminEmail.toLowerCase(),
        name: 'Foodz Admin',
        role: 'admin',
        isDemo: false,
        passwordHash: adminHash,
        resetPassword: false,
      });
      count('users', admin.created);

      let adminTwoFactor: SeedResult['adminTwoFactor'];
      const hasTwoFactor = await tx.twoFactor.findFirst({
        where: { userId: admin.id },
        select: { id: true },
      });
      if (!hasTwoFactor) {
        const secret = generateRandomString(32);
        const backupCodes = Array.from({ length: 10 }, () => {
          const code = generateRandomString(10, 'a-z', '0-9', 'A-Z');
          return `${code.slice(0, 5)}-${code.slice(5)}`;
        });
        await tx.twoFactor.create({
          data: {
            id: uuidv7(),
            userId: admin.id,
            secret: await encrypt(secret),
            backupCodes: await encrypt(JSON.stringify(backupCodes)),
            verified: true,
          },
        });
        await tx.user.update({ where: { id: admin.id }, data: { twoFactorEnabled: true } });
        adminTwoFactor = {
          totpUri: createOTP(secret, { digits: 6 }).url('Foodz', config.adminEmail.toLowerCase()),
          backupCodes,
        };
      }

      const demo: Record<string, string> = {};
      for (const account of DEMO_ACCOUNTS) {
        const user = await upsertUser(tx, {
          ...account,
          isDemo: true,
          passwordHash: demoHash,
          resetPassword: true,
        });
        demo[account.role] = user.id;
        count('users', user.created);
      }

      // -------------------------------------------------------------- store, menu, promotions
      Object.assign(created, await seedCatalog(tx, { now, updatedById: admin.id }));

      // -------------------------------------------------------------- demo partner and customer
      const partner = await tx.deliveryPartner.findUnique({
        where: { userId: demo.partner },
        select: { id: true },
      });
      if (!partner) {
        const partnerId = seedId('demo-partner');
        await tx.deliveryPartner.create({
          data: {
            id: partnerId,
            userId: demo.partner!,
            status: 'APPROVED',
            vehicleType: 'SCOOTER',
            vehiclePlate: 'FDZ 204',
            ratingAvg: 4.8,
            ratingCount: 126,
            approvedAt: now,
          },
        });
        // Parked near the kitchen, so the courier simulator starts somewhere sensible.
        await tx.$executeRaw`UPDATE delivery_partners SET last_location = ST_SetSRID(ST_MakePoint(${siteSettings.lng + 0.002}, ${siteSettings.lat + 0.001}), 4326)::geography WHERE id = ${partnerId}::uuid`;
        count('partners', true);
      }

      const addressId = seedId('demo-customer-home');
      const address = await tx.address.findUnique({
        where: { id: addressId },
        select: { id: true },
      });
      if (!address) {
        const home = { lat: 42.3467, lng: -71.0972 };
        await tx.address.create({
          data: {
            id: addressId,
            userId: demo.customer!,
            kind: 'HOME',
            label: 'Home',
            line1: '12 Peterborough Street',
            line2: 'Apt 3',
            city: 'Boston, MA 02215',
            notes: 'Buzzer 3, leave at the door',
            isDefault: true,
            ...home,
          },
        });
        await tx.$executeRaw`UPDATE addresses SET location = ST_SetSRID(ST_MakePoint(${home.lng}, ${home.lat}), 4326)::geography WHERE id = ${addressId}::uuid`;
        count('addresses', true);
      }

      // -------------------------------------------------------------- sample customers
      if (config.sampleAccounts) {
        const sample: Record<string, string> = {};
        for (const account of SAMPLE_ACCOUNTS) {
          const user = await upsertUser(tx, {
            email: account.email,
            name: account.name,
            role: 'customer',
            isDemo: false,
            passwordHash: demoHash,
            resetPassword: true,
            // Each run puts them back in the state the stories test. Flagged as sample data, so
            // demo logins see them in full like the demo accounts (U4).
            state: {
              emailVerified: account.emailVerified,
              banned: account.banned,
              banReason: account.banReason,
              isSample: true,
            },
          });
          sample[account.email] = user.id;
          count('users', user.created);
        }

        const workId = seedId('second-customer-work');
        const work = await tx.address.findUnique({ where: { id: workId }, select: { id: true } });
        if (!work) {
          await tx.address.create({
            data: {
              id: workId,
              userId: sample['second.customer@foodz.example']!,
              kind: 'WORK',
              label: 'Work',
              line1: '1 Faneuil Hall Square',
              city: 'Boston, MA 02109',
              notes: 'Front desk takes deliveries',
              isDefault: true,
              lat: 42.36,
              lng: -71.0548,
            },
          });
          count('addresses', true);
        }
      }

      // -------------------------------------------------------------- site pages
      for (const page of contentPages) {
        const existing = await tx.contentPage.findUnique({
          where: { slug: page.slug },
          select: { id: true },
        });
        if (existing) continue;
        const pageId = uuidv7();
        const versionId = uuidv7();
        await tx.contentPage.create({ data: { id: pageId, slug: page.slug, title: page.title } });
        await tx.contentVersion.create({
          data: {
            id: versionId,
            pageId,
            version: page.slug === 'terms' ? TERMS_VERSION : 1,
            title: page.title,
            content: page.body.json,
            contentHtml: page.body.html,
            publishedById: admin.id,
            publishedAt: now,
          },
        });
        await tx.contentPage.update({
          where: { id: pageId },
          data: { publishedVersionId: versionId },
        });
        count('contentPages', true);
      }

      // -------------------------------------------------------------- blog
      for (const tag of tags) {
        const existing = await tx.tag.findUnique({
          where: { slug: tag.slug },
          select: { id: true },
        });
        if (existing) continue;
        await tx.tag.create({ data: tag });
        count('tags', true);
      }

      for (const post of blogPosts(now)) {
        const existing = await tx.blogPost.findUnique({
          where: { slug: post.slug },
          select: { id: true },
        });
        if (existing) continue;
        await tx.blogPost.create({
          data: {
            slug: post.slug,
            title: post.title,
            excerpt: post.excerpt,
            coverKey: '/Blog/blog1.png',
            content: post.body.json,
            contentHtml: post.body.html,
            status: 'PUBLISHED',
            featured: post.featured,
            authorId: admin.id,
            publishedAt: post.publishedAt,
            tags: { connect: post.tags.map((slug) => ({ slug })) },
          },
        });
        count('blogPosts', true);
      }

      return { adminTwoFactor, created };
    },
    { timeout: 60_000 },
  );
}

/**
 * What the storefront shows: store settings, the menu, coupons and campaigns. Like the rest of
 * the seed it only adds rows that are missing. Tests use it on its own.
 */
export async function seedCatalog(tx: Tx, options: { now: Date; updatedById?: string }) {
  let siteSettingsCreated = 0;
  const settings = await tx.siteSettings.findUnique({ where: { id: 1 }, select: { id: true } });
  if (!settings) {
    await tx.siteSettings.create({
      data: { id: 1, ...siteSettings, updatedById: options.updatedById },
    });
    await tx.$executeRaw`UPDATE site_settings SET location = ST_SetSRID(ST_MakePoint(${siteSettings.lng}, ${siteSettings.lat}), 4326)::geography WHERE id = 1`;
    siteSettingsCreated = 1;
  }

  const menu = await tx.menuItem.createMany({ data: menuItems, skipDuplicates: true });

  let couponsCreated = 0;
  for (const coupon of coupons(options.now)) {
    const existing = await tx.coupon.findUnique({
      where: { code: coupon.code },
      select: { id: true },
    });
    if (existing) continue;
    await tx.coupon.create({ data: coupon });
    couponsCreated += 1;
  }

  let campaignsCreated = 0;
  for (const { key, couponCode, menuSlugs, ...campaign } of campaigns(options.now)) {
    const id = seedId(`campaign:${key}`);
    const existing = await tx.campaign.findUnique({ where: { id }, select: { id: true } });
    if (existing) continue;
    await tx.campaign.create({
      data: {
        id,
        ...campaign,
        coupon: couponCode ? { connect: { code: couponCode } } : undefined,
        menuItems: { connect: menuSlugs.map((slug) => ({ slug })) },
      },
    });
    campaignsCreated += 1;
  }

  return {
    siteSettings: siteSettingsCreated,
    menuItems: menu.count,
    coupons: couponsCreated,
    campaigns: campaignsCreated,
  };
}

async function upsertUser(
  tx: Tx,
  user: {
    email: string;
    name: string;
    role: string;
    isDemo: boolean;
    passwordHash: string;
    /** Demo passwords follow the environment; a real admin's password is never reset. */
    resetPassword: boolean;
    /** Sample accounts: the confirmation and suspension state to restore on every run. */
    state?: {
      emailVerified: boolean;
      banned: boolean;
      banReason: string | null;
      isSample: boolean;
    };
  },
) {
  const existing = await tx.user.findUnique({ where: { email: user.email }, select: { id: true } });
  const id = existing?.id ?? uuidv7();

  const state = user.state ?? {
    emailVerified: true,
    banned: false,
    banReason: null,
    isSample: false,
  };
  if (existing) {
    await tx.user.update({
      where: { id },
      data: user.isDemo
        ? { role: user.role, isDemo: true, banned: false, emailVerified: true }
        : user.state
          ? { ...user.state, role: user.role }
          : { emailVerified: true },
    });
  } else {
    await tx.user.create({
      data: {
        id,
        email: user.email,
        name: user.name,
        role: user.role,
        isDemo: user.isDemo,
        emailVerified: state.emailVerified,
        banned: state.banned,
        banReason: state.banReason,
        isSample: state.isSample,
        termsAcceptedVersion: TERMS_VERSION,
      },
    });
  }

  const account = await tx.account.findFirst({
    where: { userId: id, providerId: 'credential' },
    select: { id: true },
  });
  if (!account) {
    await tx.account.create({
      data: {
        id: uuidv7(),
        userId: id,
        providerId: 'credential',
        accountId: id,
        password: user.passwordHash,
      },
    });
  } else if (user.resetPassword) {
    await tx.account.update({ where: { id: account.id }, data: { password: user.passwordHash } });
  }

  return { id, created: !existing };
}
