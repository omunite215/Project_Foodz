import 'server-only';
import { isRole } from '@/server/auth/roles';
import { type Actor, runAs, runAsSystem } from '@/server/db/context';
import { logger } from '@/server/logger';
import { audit } from '@/server/modules/audit/service';
import { queueAccountEmail } from '@/server/modules/notifications/account-email';
import { emailKey, resetRateLimit, takeAttempt } from '@/server/security/rate-limit';
import { AppError } from '@/server/errors';
import {
  findEmailForResetToken,
  findUserIdByEmail,
  markEmailVerified,
  setEmailLinksValidAfter,
} from './repo';

/*
 * What the sign-in machinery needs from the account module: lookups, the side effects of a
 * password reset, account emails and audit entries. Kept apart from service.ts so the auth
 * configuration can use it without an import cycle.
 */

interface AuthUser {
  id: string;
  email: string;
  name: string;
  emailVerified?: boolean | null;
  role?: string | null;
  isDemo?: boolean | null;
  deletedAt?: Date | string | null;
}

const actorFor = (user: AuthUser): Actor => ({
  kind: 'user',
  userId: user.id,
  role: isRole(user.role) ? user.role : 'customer',
  isDemo: Boolean(user.isDemo),
});

/** Demo inboxes are shared and deleted accounts have none: no account email goes to either. */
export const receivesAccountEmail = (user: AuthUser) => !user.isDemo && !user.deletedAt;

async function record(
  actor: Actor,
  entry: {
    action: string;
    targetId?: string | null;
    data?: Record<string, string | number | boolean>;
  },
) {
  try {
    await runAs(actor, (ctx) =>
      audit(ctx, {
        action: entry.action,
        targetType: 'user',
        targetId: entry.targetId ?? undefined,
        data: entry.data,
      }),
    );
  } catch (error) {
    // An audit failure must not turn a successful sign-in into an error page.
    logger.error({ err: error, action: entry.action }, 'could not write audit entry');
  }
}

export async function findUserId(email: string) {
  const row = await runAsSystem('auth lookup', (ctx) => findUserIdByEmail(ctx, email));
  return row?.id ?? null;
}

export function findEmailForReset(token: string) {
  return runAsSystem('reset lookup', (ctx) => findEmailForResetToken(ctx, token));
}

export function recordSignIn(user: AuthUser, method: 'password' | 'two-factor') {
  return record(actorFor(user), { action: 'auth.sign-in', targetId: user.id, data: { method } });
}

/** Failed sign-ins name the account when the email has one, never the email itself. */
export async function recordFailedSignIn(email: string, reason: 'password' | 'suspended') {
  const userId = await findUserId(email).catch(() => null);
  await record(
    { kind: 'anonymous' },
    {
      action: 'auth.sign-in-failed',
      targetId: userId,
      data: { reason, knownAccount: userId !== null },
    },
  );
}

export function recordFailedTwoFactor(userId: string | null) {
  return record({ kind: 'anonymous' }, { action: 'auth.two-factor-failed', targetId: userId });
}

export async function passwordChanged(user: AuthUser) {
  await record(actorFor(user), { action: 'auth.password-changed', targetId: user.id });
  if (receivesAccountEmail(user)) {
    await queueAccountEmail({
      kind: 'password-changed',
      to: user.email,
      // The name was typed by whoever signed up; only a confirmed owner is greeted with it.
      name: user.emailVerified ? user.name : undefined,
    });
  }
}

/**
 * After a completed reset: the inbox owner is proven, so the email counts as confirmed (S3.12);
 * the sign-in lockout for the address is lifted; the owner is told.
 */
export async function passwordWasReset(user: AuthUser) {
  await runAsSystem('password reset', (ctx) => markEmailVerified(ctx, user.id));
  await resetRateLimit('auth.sign-in.email', emailKey(user.email));
  await record(actorFor(user), { action: 'auth.password-reset', targetId: user.id });
  if (receivesAccountEmail(user)) {
    // The reset proved the inbox, but the name may still be a stranger's: not used here either.
    await queueAccountEmail({ kind: 'password-changed', to: user.email });
  }
}

/** "Someone tried to sign up with your email": at most one per address per hour (S1.5). */
export async function notifyAccountExists(email: string) {
  try {
    await takeAttempt('email.account-exists', emailKey(email));
  } catch (error) {
    if (error instanceof AppError) return;
    throw error;
  }
  await queueAccountEmail({ kind: 'account-exists', to: email });
}

/**
 * Before an unconfirmed account's email change: earlier confirm links stop working, and the
 * owner of the new address, if it has an account, is told someone tried to use it. The person
 * changing sees the same answer either way (S3.6).
 */
export async function prepareEmailChange(userId: string, newEmail: string) {
  // Whole seconds: links carry their issue time in seconds, and the new link is issued next.
  const now = new Date(Math.floor(Date.now() / 1000) * 1000);
  await runAsSystem('email change', (ctx) => setEmailLinksValidAfter(ctx, userId, now));
  const owner = await findUserId(newEmail);
  if (owner && owner !== userId) await notifyAccountExists(newEmail);
}

/** The breach service was unreachable and a password was accepted unchecked (B2). */
export async function noteBreachCheckSkipped(path: string) {
  logger.warn({ path }, 'breached-password check unavailable; password accepted');
  await record(
    { kind: 'system', reason: 'breach check' },
    {
      action: 'auth.breach-check-skipped',
      data: { path },
    },
  );
}
