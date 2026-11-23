import 'server-only';
import { db } from '@/server/db/client';
import type { DbContext } from '@/server/db/context';

/*
 * Staff sessions and the step-up code (F5 A7.10). The two-factor failure count and lock are
 * the sign-in lockout's own columns, so wrong codes in either place count toward one limit.
 */

/** When a session started and when it last passed a step-up code. */
export function findSessionStepUp(ctx: DbContext, sessionId: string) {
  return db(ctx).session.findUnique({
    where: { id: sessionId },
    select: { userId: true, createdAt: true, stepUpAt: true },
  });
}

export async function recordSessionStepUp(
  ctx: DbContext,
  sessionId: string,
  userId: string,
  at: Date,
) {
  await db(ctx).session.updateMany({ where: { id: sessionId, userId }, data: { stepUpAt: at } });
}

export function findTwoFactorLock(ctx: DbContext, userId: string) {
  return db(ctx).twoFactor.findFirst({
    where: { userId },
    select: { id: true, failedVerificationCount: true, lockedUntil: true },
  });
}

/**
 * Takes one try at a code before it is checked, atomically: the count of tries in a row goes up
 * by one (from one again once an old lock has passed). Null while the account is locked. Parallel
 * guesses each get their own number, so no more than the limit are ever checked.
 */
export async function takeTwoFactorTry(ctx: DbContext, id: string, now: Date) {
  const rows = await db(ctx).$queryRaw<{ tries: number }[]>`
    UPDATE two_factors
    SET failed_verification_count = CASE
          WHEN locked_until IS NOT NULL AND locked_until <= ${now} THEN 1
          ELSE coalesce(failed_verification_count, 0) + 1
        END,
        locked_until = CASE WHEN locked_until <= ${now} THEN NULL ELSE locked_until END
    WHERE id = ${id}::uuid AND (locked_until IS NULL OR locked_until <= ${now})
    RETURNING failed_verification_count AS tries`;
  return rows[0]?.tries ?? null;
}

/** Locks two-factor until `until`, unless it is already locked; returns the lock in force. */
export async function lockTwoFactor(ctx: DbContext, id: string, until: Date, now: Date) {
  await db(ctx).twoFactor.updateMany({
    where: { id, OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }] },
    data: { lockedUntil: until },
  });
  const lock = await db(ctx).twoFactor.findUnique({ where: { id }, select: { lockedUntil: true } });
  return lock?.lockedUntil ?? until;
}

export async function resetTwoFactorFailures(ctx: DbContext, id: string) {
  await db(ctx).twoFactor.updateMany({
    where: { id },
    data: { failedVerificationCount: 0, lockedUntil: null },
  });
}
