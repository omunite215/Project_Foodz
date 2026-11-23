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

/** Counts one wrong code; locks the account once `max` wrong codes in a row are reached. */
export async function countTwoFactorFailure(
  ctx: DbContext,
  id: string,
  max: number,
  lockUntil: Date,
): Promise<{ failures: number; lockedUntil: Date | null }> {
  const rows = await db(ctx).$queryRaw<{ failures: number }[]>`
    UPDATE two_factors
    SET failed_verification_count = coalesce(failed_verification_count, 0) + 1
    WHERE id = ${id}::uuid
    RETURNING failed_verification_count AS failures`;
  const failures = rows[0]?.failures ?? 0;
  if (failures < max) return { failures, lockedUntil: null };
  await db(ctx).twoFactor.updateMany({ where: { id }, data: { lockedUntil: lockUntil } });
  return { failures, lockedUntil: lockUntil };
}

export async function resetTwoFactorFailures(ctx: DbContext, id: string) {
  await db(ctx).twoFactor.updateMany({
    where: { id },
    data: { failedVerificationCount: 0, lockedUntil: null },
  });
}
