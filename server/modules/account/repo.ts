import 'server-only';
import { db } from '@/server/db/client';
import type { DbContext } from '@/server/db/context';

/*
 * The auth tables (users, sessions, accounts, two_factors, verifications) belong to Better Auth.
 * This module reads and changes only the caller's own rows, always filtered by user id here.
 * For a demo actor, row-level security on users also hides every real person.
 */

const profileFields = {
  id: true,
  name: true,
  email: true,
  emailVerified: true,
  phone: true,
  role: true,
  isDemo: true,
  twoFactorEnabled: true,
  createdAt: true,
  termsAcceptedVersion: true,
} as const;

export function findProfile(ctx: DbContext, userId: string) {
  return db(ctx).user.findUnique({ where: { id: userId }, select: profileFields });
}

export async function findSignInMethods(ctx: DbContext, userId: string) {
  const [providers, withPassword] = await Promise.all([
    db(ctx).account.findMany({ where: { userId }, select: { providerId: true } }),
    db(ctx).account.count({
      where: { userId, providerId: 'credential', password: { not: null } },
    }),
  ]);
  return { providers: providers.map((row) => row.providerId), hasPassword: withPassword > 0 };
}

export function updateProfile(
  ctx: DbContext,
  userId: string,
  data: { name: string; phone: string | null },
) {
  return db(ctx).user.update({
    where: { id: userId },
    data: { name: data.name, phone: data.phone },
    select: profileFields,
  });
}

export function findUserIdByEmail(ctx: DbContext, email: string) {
  return db(ctx).user.findUnique({ where: { email }, select: { id: true } });
}

/** The account a password-reset token belongs to (the token row holds the user id). */
export async function findEmailForResetToken(ctx: DbContext, token: string) {
  const verification = await db(ctx).verification.findFirst({
    where: { identifier: `reset-password:${token}` },
    select: { value: true },
  });
  if (!verification) return null;
  const user = await db(ctx).user.findUnique({
    where: { id: verification.value },
    select: { email: true },
  });
  return user?.email ?? null;
}

export async function markEmailVerified(ctx: DbContext, userId: string) {
  await db(ctx).user.updateMany({
    where: { id: userId, emailVerified: false },
    data: { emailVerified: true },
  });
}

/** Confirm-email links issued before this instant stop working (S3.6). */
export async function setEmailLinksValidAfter(ctx: DbContext, userId: string, at: Date) {
  await db(ctx).user.update({
    where: { id: userId },
    data: { emailLinksValidAfter: at },
    select: { id: true },
  });
}

// ------------------------------------------------------------------ devices

export function listSessions(ctx: DbContext, userId: string, now: Date) {
  return db(ctx).session.findMany({
    where: { userId, expiresAt: { gt: now } },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    select: { id: true, userAgent: true, createdAt: true, updatedAt: true },
  });
}

export function countSessions(ctx: DbContext, userId: string, now: Date) {
  return db(ctx).session.count({ where: { userId, expiresAt: { gt: now } } });
}

export async function deleteSession(ctx: DbContext, userId: string, sessionId: string) {
  const result = await db(ctx).session.deleteMany({ where: { id: sessionId, userId } });
  return result.count;
}

export async function deleteOtherSessions(ctx: DbContext, userId: string, keepId: string) {
  const result = await db(ctx).session.deleteMany({ where: { userId, id: { not: keepId } } });
  return result.count;
}

// ------------------------------------------------------------------ deletion

export async function findPasswordHash(ctx: DbContext, userId: string) {
  const account = await db(ctx).account.findFirst({
    where: { userId, providerId: 'credential' },
    select: { password: true },
  });
  return account?.password ?? null;
}

/**
 * The account's partner row on deletion (F6 P15.5), through the database function that owns
 * the rule: a waiting application is withdrawn, any other row is anonymised, an online partner
 * is refused (55006, "Go offline first."). Returns the uploads whose files go after commit.
 */
export async function erasePartnerData(ctx: DbContext): Promise<{
  outcome: 'none' | 'withdrawn' | 'anonymised';
  partnerId?: string;
  uploadIds?: string[];
}> {
  const rows = await db(ctx).$queryRaw<
    {
      result: {
        outcome: 'none' | 'withdrawn' | 'anonymised';
        partnerId?: string;
        uploadIds?: string[];
      };
    }[]
  >`
    SELECT app_erase_own_partner_data() AS result`;
  return rows[0]?.result ?? { outcome: 'none' };
}

/** Deliveries a partner is carrying right now. */
export function countDeliveriesInProgress(ctx: DbContext, userId: string) {
  return db(ctx).delivery.count({
    where: { partner: { userId }, status: { in: ['ASSIGNED', 'AT_RESTAURANT', 'PICKED_UP'] } },
  });
}

/**
 * Removes a person while keeping order records for accounting (B10): sign-in methods, sessions,
 * two-factor, open tokens, addresses, favorites and notifications go; the user row stays as an
 * anonymous placeholder that orders still point to. The orders lose their contact details
 * through the orders module, in the same transaction (customers can't write orders, F4).
 */
export async function anonymizeAccount(ctx: DbContext, userId: string, now: Date) {
  const tx = db(ctx);
  await tx.session.deleteMany({ where: { userId } });
  await tx.account.deleteMany({ where: { userId } });
  await tx.twoFactor.deleteMany({ where: { userId } });
  // Reset, two-factor and trusted-device tokens store the user id as their value.
  await tx.verification.deleteMany({ where: { value: userId } });
  await tx.address.deleteMany({ where: { userId } });
  await tx.favorite.deleteMany({ where: { userId } });
  await tx.notification.deleteMany({ where: { userId } });
  await tx.user.update({
    where: { id: userId },
    data: {
      name: 'Deleted customer',
      email: `deleted-${userId}@deleted.invalid`,
      emailVerified: false,
      phone: null,
      image: null,
      stripeCustomerId: null,
      twoFactorEnabled: false,
      emailLinksValidAfter: now,
      deletedAt: now,
    },
    select: { id: true },
  });
}

// ------------------------------------------------------------------ staff

interface DirectoryRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: string;
  is_demo: boolean;
  email_verified: boolean;
  banned: boolean;
  created_at: Date;
  deleted_at: Date | null;
  masked: boolean;
  is_sample: boolean;
}

/** A person as staff see them; the view masks personal details for demo staff. */
export async function findPersonForStaff(ctx: DbContext, userId: string) {
  const rows = await db(ctx).$queryRaw<DirectoryRow[]>`
    SELECT id::text AS id, name, email, phone, role, is_demo, email_verified, banned,
           created_at, deleted_at, masked, is_sample
    FROM user_directory
    WHERE id = ${userId}::uuid`;
  return rows[0] ?? null;
}
