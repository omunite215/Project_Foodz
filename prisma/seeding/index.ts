import { createOTP } from '@better-auth/utils/otp';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { generateRandomString, symmetricEncrypt } from 'better-auth/crypto';
import { v5 as uuidv5, v7 as uuidv7 } from 'uuid';
import type { Prisma, PrismaClient } from '../../server/db/generated/client';
import {
  blogPosts,
  campaigns,
  contentPages,
  coupons,
  SEED_CORRECTIONS,
  sampleCoupons,
  siteSettings,
  tags,
} from './content';
import { menuItems } from './menu';
import { escapeHtml } from './rich-text';

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
   * Adds the sample customers below with this password: an unconfirmed one, a suspended one and
   * a second customer with an address. Local and CI databases only (see `sampleAccountsRefusal`);
   * never the shared demo password, since they are ordinary, writable accounts.
   */
  samplePassword?: string;
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
 * to the demo admin. Their password is random per seed run and printed by the seed.
 */
export const SAMPLE_ACCOUNTS = [
  {
    email: 'unconfirmed.customer@foodz.example',
    name: 'Jordan Lee',
    emailVerified: false,
    banned: false,
    banReason: null,
    phone: null,
  },
  {
    email: 'suspended.customer@foodz.example',
    name: 'Sam Rivera',
    emailVerified: true,
    banned: true,
    banReason: 'Repeated coupon abuse (test account)',
    phone: null,
  },
  {
    // The main ordering account for F4 QA: her phone fills in at checkout (B23).
    email: 'second.customer@foodz.example',
    name: 'Priya Shah',
    emailVerified: true,
    banned: false,
    banReason: null,
    phone: '+16175550123',
  },
] as const;

const TERMS_VERSION = 1;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 1 Faneuil Hall Square where the address search (Photon) puts it, 1.4 km from the kitchen. The
 * second customer's Work address and her past order use it, so saving the address and checking
 * it as a guest give the same distance and fee.
 */
export const FANEUIL_HALL = { lat: 42.3600335, lng: -71.0562341 } as const;

/** The demo customer's favorites in local and CI databases (F3): one of them sold out. */
const DEMO_FAVORITE_SLUGS = ['bulgogi', 'naengmyeon'] as const;

/** Database hosts of a developer machine, the compose network and CI. */
const LOCAL_DATABASE_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', 'db']);

/**
 * Why the sample customers may not be seeded into this database, or null when they may. They
 * are writable accounts with a password printed in the seed output, so a shared deployment such
 * as the public demo must never have them: only a local or CI database qualifies.
 */
export function sampleAccountsRefusal(
  databaseUrl: string,
  env: Record<string, string | undefined>,
): string | null {
  if (env.VERCEL_ENV) return 'sample accounts are never seeded on a Vercel deployment';
  if (env.CI) return null;
  let host: string;
  try {
    host = new URL(databaseUrl).hostname;
  } catch {
    return 'the database URL could not be read';
  }
  return LOCAL_DATABASE_HOSTS.has(host)
    ? null
    : `the database at ${host} is not a local or CI database`;
}

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
  const [adminHash, demoHash, sampleHash] = await Promise.all([
    authContext.password.hash(config.adminPassword),
    authContext.password.hash(config.demoPassword),
    config.samplePassword ? authContext.password.hash(config.samplePassword) : null,
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
      if (sampleHash) {
        const sample: Record<string, string> = {};
        for (const account of SAMPLE_ACCOUNTS) {
          const user = await upsertUser(tx, {
            email: account.email,
            name: account.name,
            role: 'customer',
            isDemo: false,
            passwordHash: sampleHash,
            resetPassword: true,
            // Each run puts them back in the state the stories test. Flagged as sample data, so
            // demo logins see them in full like the demo accounts (U4).
            state: {
              emailVerified: account.emailVerified,
              banned: account.banned,
              banReason: account.banReason,
              isSample: true,
              phone: account.phone,
            },
          });
          sample[account.email] = user.id;
          count('users', user.created);
        }

        const workId = seedId('second-customer-work');
        const work = await tx.address.findUnique({
          where: { id: workId },
          select: { lat: true, lng: true },
        });
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
              ...FANEUIL_HALL,
            },
          });
          count('addresses', true);
        } else if (work.lat !== FANEUIL_HALL.lat || work.lng !== FANEUIL_HALL.lng) {
          // Put back where the address search finds it, so the saved address and a guest's
          // check of the same address give the same distance and fee.
          await tx.address.update({ where: { id: workId }, data: FANEUIL_HALL });
        }

        // F3 fixtures: codes for the refusals nobody could reach otherwise, the second
        // customer's store credit and past WELCOME10 order, and the demo customer's favorites.
        const secondCustomer = sample['second.customer@foodz.example']!;
        for (const coupon of sampleCoupons(now, { secondCustomer })) {
          const existing = await tx.coupon.findUnique({
            where: { code: coupon.code },
            select: { id: true },
          });
          if (existing) continue;
          await tx.coupon.create({ data: coupon });
          count('coupons', true);
        }
        // LASTONE has its one use back on every run (S8.4).
        await tx.coupon.updateMany({ where: { code: 'LASTONE' }, data: { usedCount: 0 } });
        count('orders', await seedPastWelcomeOrder(tx, secondCustomer, now));
        await completePastOrderSnapshot(tx);

        const favoriteDishes = await tx.menuItem.findMany({
          where: { slug: { in: [...DEMO_FAVORITE_SLUGS] } },
          select: { id: true, slug: true },
        });
        const favorites = await tx.favorite.createMany({
          data: favoriteDishes.map((dish) => ({
            userId: demo.customer!,
            menuItemId: dish.id,
            // Bulgogi was saved last, so it leads the list.
            createdAt: new Date(now.getTime() - (dish.slug === 'bulgogi' ? 1 : 2) * DAY_MS),
          })),
          skipDuplicates: true,
        });
        created.favorites = (created.favorites ?? 0) + favorites.count;
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

      count(
        'contentVersions',
        await correctFaqAnswer(tx, admin.id, now, SEED_CORRECTIONS.faqCouponAnswer),
      );
      count(
        'contentVersions',
        await correctFaqAnswer(tx, admin.id, now, SEED_CORRECTIONS.faqCashAnswer),
      );

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

  // Values earlier runs seeded and F3 changed; edited values are left alone.
  const { taxRateBps, welcome10Description, freeDeliveryBar } = SEED_CORRECTIONS;
  const corrected = await Promise.all([
    tx.siteSettings.updateMany({
      where: { id: 1, taxRateBps: taxRateBps.from },
      data: { taxRateBps: taxRateBps.to },
    }),
    tx.coupon.updateMany({
      where: { code: 'WELCOME10', description: welcome10Description.from },
      data: { description: welcome10Description.to },
    }),
    tx.campaign.updateMany({
      where: { id: seedId('campaign:bar-free-delivery'), subtitle: freeDeliveryBar.from },
      data: { subtitle: freeDeliveryBar.to },
    }),
  ]);

  return {
    siteSettings: siteSettingsCreated,
    menuItems: menu.count,
    coupons: couponsCreated,
    campaigns: campaignsCreated,
    corrections: corrected.reduce((sum, result) => sum + result.count, 0),
  };
}

/**
 * The second customer's delivered order that used WELCOME10, so "already used by me" (R6) can
 * be tried before checkout exists (F3). Amounts as quote() gives them at 7 %: 2 × Gimbap
 * $25.98, WELCOME10 −$2.60, delivery 1.3 km $2.64, tax on $23.38 = $1.64, total $27.66.
 */
async function seedPastWelcomeOrder(tx: Tx, userId: string, now: Date): Promise<boolean> {
  const id = seedId('second-customer-past-order');
  if (await tx.order.findUnique({ where: { id }, select: { id: true } })) return false;
  const [welcome, gimbap] = await Promise.all([
    tx.coupon.findUniqueOrThrow({ where: { code: 'WELCOME10' }, select: { id: true } }),
    tx.menuItem.findUniqueOrThrow({ where: { slug: 'gimbap' }, select: { id: true, title: true } }),
  ]);
  const placedAt = new Date(now.getTime() - 3 * DAY_MS);
  await tx.order.create({
    data: {
      id,
      number: 'S1001',
      userId,
      status: 'DELIVERED',
      paymentMethod: 'CASH',
      paymentStatus: 'PAID',
      contactName: 'Priya Shah',
      contactPhone: '+16175550123',
      addressText: '1 Faneuil Hall Square, Boston, MA 02109',
      ...PAST_ORDER_SNAPSHOT,
      addressLat: FANEUIL_HALL.lat,
      addressLng: FANEUIL_HALL.lng,
      distanceKm: 1.4,
      subtotalCents: 2598,
      discountCents: 260,
      deliveryFeeCents: 269,
      taxCents: 164,
      tipCents: 0,
      totalCents: 2771,
      couponId: welcome.id,
      placedAt,
      deliveredAt: new Date(placedAt.getTime() + 38 * 60 * 1000),
      createdAt: placedAt,
      items: {
        create: [
          {
            menuItemId: gimbap.id,
            title: gimbap.title,
            unitPriceCents: 1299,
            quantity: 2,
            flavors: [],
          },
        ],
      },
    },
  });
  await tx.couponRedemption.create({
    data: {
      couponId: welcome.id,
      userId,
      orderId: id,
      status: 'REDEEMED',
      discountCents: 260,
      createdAt: placedAt,
    },
  });
  await tx.coupon.update({ where: { id: welcome.id }, data: { usedCount: { increment: 1 } } });
  return true;
}

/**
 * What the order page needs of S1001 (F4): the address, instructions and arrival window as
 * an order keeps them. Gimbap takes 20 minutes at most, the address is 1.3 km away: 20 + 10 + 4
 * = 34, so 35–45 minutes.
 */
const PAST_ORDER_SNAPSHOT = {
  addressLabel: 'Work',
  addressLine1: '1 Faneuil Hall Square',
  addressLine2: null,
  addressCity: 'Boston, MA 02109',
  courierInstructions: 'Front desk takes deliveries',
  taxRateBps: 700,
  promoCode: 'WELCOME10',
  tipChoice: 'none',
  arrivalFromMinutes: 35,
  arrivalToMinutes: 45,
} as const;

/** S1001 seeded before F4 gets its snapshot, and the timeline its placed and delivered steps. */
async function completePastOrderSnapshot(tx: Tx) {
  const id = seedId('second-customer-past-order');
  const order = await tx.order.findUnique({
    where: { id },
    select: { addressLabel: true, placedAt: true, deliveredAt: true },
  });
  if (!order) return;
  if (order.addressLabel === null) {
    await tx.order.update({ where: { id }, data: PAST_ORDER_SNAPSHOT, select: { id: true } });
  }
  const events = await tx.orderEvent.count({ where: { orderId: id } });
  if (events === 0 && order.placedAt) {
    await tx.orderEvent.createMany({
      data: [
        {
          orderId: id,
          type: 'placed',
          toStatus: 'PLACED',
          data: { actor: 'customer', method: 'cash' },
          createdAt: order.placedAt,
        },
        ...(order.deliveredAt
          ? [
              {
                orderId: id,
                type: 'delivered',
                fromStatus: 'PICKED_UP' as const,
                toStatus: 'DELIVERED' as const,
                createdAt: order.deliveredAt,
              },
            ]
          : []),
      ],
    });
  }
}

/**
 * FAQ answers earlier seeds published that a feature changed (coupons in F3, cash in F4). When
 * the published version still has the old sentence, a new version with the new one is
 * published, the way the CMS would.
 */
async function correctFaqAnswer(
  tx: Tx,
  publishedById: string,
  now: Date,
  { from, to }: { from: string; to: string },
) {
  const page = await tx.contentPage.findUnique({
    where: { slug: 'faq' },
    select: {
      id: true,
      publishedVersion: { select: { title: true, content: true, contentHtml: true } },
    },
  });
  const current = page?.publishedVersion;
  // Whole paragraphs only: a new answer may begin with the old one (F4's cash sentence does).
  const oldParagraph = `>${escapeHtml(from)}<`;
  if (!page || !current?.contentHtml.includes(oldParagraph)) return false;
  const content = replaceText(current.content, from, to);
  if (content === null) return false;

  const latest = await tx.contentVersion.findFirst({
    where: { pageId: page.id },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  const versionId = uuidv7();
  await tx.contentVersion.create({
    data: {
      id: versionId,
      pageId: page.id,
      version: (latest?.version ?? 0) + 1,
      title: current.title,
      content,
      contentHtml: current.contentHtml.replaceAll(oldParagraph, `>${escapeHtml(to)}<`),
      publishedById,
      publishedAt: now,
    },
  });
  await tx.contentPage.update({ where: { id: page.id }, data: { publishedVersionId: versionId } });
  return true;
}

/** The same document with every text node that reads `from` reading `to`. */
function replaceText(node: Prisma.JsonValue, from: string, to: string): Prisma.JsonValue {
  if (Array.isArray(node)) return node.map((child) => replaceText(child, from, to));
  if (node !== null && typeof node === 'object') {
    return Object.fromEntries(
      Object.entries(node).map(([key, value]) => [
        key,
        key === 'text' && value === from ? to : replaceText(value ?? null, from, to),
      ]),
    );
  }
  return node;
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
      /** The profile phone the stories use (E.164), or null. */
      phone?: string | null;
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
        phone: state.phone ?? null,
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
