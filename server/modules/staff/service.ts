import 'server-only';
import { can, isRole, type Role } from '@/server/auth/roles';
import { getSession, type UserActor } from '@/server/auth/session';
import { staffSessionEnd, staffSessionOver } from '@/server/auth/staff-session';
import { checkStepUpCode } from '@/server/auth/step-up';
import { runAs } from '@/server/db/context';
import { AppError, unauthenticated } from '@/server/errors';
import { logger } from '@/server/logger';
import { audit } from '@/server/modules/audit/service';
import { getStoreStatus } from '@/server/modules/menu/service';
import { clockAt } from '@/server/modules/orders/text';
import { takeAttempt } from '@/server/security/rate-limit';
import {
  countTwoFactorFailure,
  findSessionStepUp,
  findTwoFactorLock,
  recordSessionStepUp,
  resetTwoFactorFailures,
} from './repo';
import {
  STEP_UP_ERRORS,
  STEP_UP_WINDOW_MS,
  stepUpInput,
  type StaffRole,
  type StaffShell,
} from './schema';

/*
 * Staff access, sessions and step-up (F5). The `/admin` layout and every admin page ask
 * getStaffShell(); every action checks again in its wrapper and service (A1.10).
 */

/** The F2 sign-in lockout: 5 wrong codes in a row lock two-factor for 15 minutes. */
const LOCK_AFTER = 5;
const LOCK_MS = 15 * 60 * 1000;

const STAFF_ROLES: readonly StaffRole[] = ['kitchen', 'support', 'content_editor', 'admin'];
const staffRoleOf = (role: Role): StaffRole | null =>
  STAFF_ROLES.find((staff) => staff === role) ?? null;

interface SessionFacts {
  user: {
    name: string;
    role: unknown;
    isDemo: boolean;
    twoFactorEnabled: boolean;
    banned: boolean;
  };
  session: { createdAt: Date; expiresAt: Date };
}

/** The shell's decision from the session alone (A1.2 to A1.7); pure, for the tests. */
export function staffShellOf(
  facts: SessionFacts | null,
  freshUntil: Date | null,
  now: Date,
): StaffShell {
  if (!facts || facts.user.banned) return { kind: 'guest' };
  const role = staffRoleOf(isRole(facts.user.role) ? facts.user.role : 'customer');
  if (!role) return { kind: 'notStaff' };
  if (staffSessionOver(role, facts.session.createdAt, now)) return { kind: 'guest' };
  const user = { name: facts.user.name, role, isDemo: facts.user.isDemo };
  if (!facts.user.isDemo && !facts.user.twoFactorEnabled) {
    return { kind: 'twoFactorRequired', user };
  }
  const board = can(role, { order: ['read-any'] });
  const ends = staffSessionEnd(facts.session.createdAt);
  const expires = facts.session.expiresAt < ends ? facts.session.expiresAt : ends;
  return {
    kind: 'staff',
    user,
    screens: board ? ['orderBoard'] : [],
    home: board ? '/admin/orders' : null,
    sidebar: role !== 'kitchen',
    readOnly: facts.user.isDemo,
    sessionExpiresAt: expires.toISOString(),
    stepUpFreshUntil: freshUntil?.toISOString() ?? null,
  };
}

/** max(session start, last code check) plus 10 minutes, or null once that has passed. */
export function freshUntilOf(createdAt: Date, stepUpAt: Date | null, now: Date): Date | null {
  const base = stepUpAt && stepUpAt > createdAt ? stepUpAt : createdAt;
  const until = new Date(base.getTime() + STEP_UP_WINDOW_MS);
  return until.getTime() > now.getTime() ? until : null;
}

async function currentSession() {
  const session = await getSession();
  return session && !session.user.banned ? session : null;
}

/** The step-up window of the request's own session, when it belongs to `userId`. */
async function freshUntilFor(userId: string | null, now: Date): Promise<Date | null> {
  const session = await currentSession();
  if (!session || (userId !== null && session.user.id !== userId)) return null;
  const actor = {
    kind: 'user',
    userId: session.user.id,
    role: isRole(session.user.role) ? session.user.role : 'customer',
    isDemo: Boolean(session.user.isDemo),
  } as const;
  const row = await runAs(actor, (ctx) => findSessionStepUp(ctx, session.session.id));
  if (!row || row.userId !== session.user.id) return null;
  return freshUntilOf(row.createdAt, row.stepUpAt, now);
}

/** For the `/admin` layout and every admin page (A1, design 1.1). Reads the session itself. */
export async function getStaffShell(now = new Date()): Promise<StaffShell> {
  const session = await currentSession();
  const facts: SessionFacts | null = session
    ? {
        user: {
          name: session.user.name,
          role: session.user.role,
          isDemo: Boolean(session.user.isDemo),
          twoFactorEnabled: Boolean(session.user.twoFactorEnabled),
          banned: Boolean(session.user.banned),
        },
        session: {
          createdAt: new Date(session.session.createdAt),
          expiresAt: new Date(session.session.expiresAt),
        },
      }
    : null;
  const shell = staffShellOf(facts, null, now);
  if (shell.kind !== 'staff' || shell.readOnly) return shell;
  const fresh = await freshUntilFor(session?.user.id ?? null, now);
  return { ...shell, stepUpFreshUntil: fresh?.toISOString() ?? null };
}

/**
 * When the caller's last sign-in or code check stops covering money-back actions, or null when
 * it already has: max(session start, last code check) plus 10 minutes.
 */
export function stepUpFreshUntil(now = new Date()): Promise<Date | null> {
  return freshUntilFor(null, now);
}

/** The same, for a service acting for `actor`: null unless the request's session is theirs. */
export function stepUpFreshUntilFor(actor: UserActor, now = new Date()): Promise<Date | null> {
  return freshUntilFor(actor.userId, now);
}

// ------------------------------------------------------------------ the step-up gate (A7.10)

export const stepUpRequired = () =>
  new AppError('STEP_UP_REQUIRED', 'Enter a code from your authenticator app to continue.', 403, {
    details: { action: 'refund', windowMinutes: STEP_UP_WINDOW_MS / 60_000 },
  });

async function lockedError(retryAt: Date, now: Date) {
  const { timeZone } = await getStoreStatus(now);
  return new AppError(
    'STEP_UP_LOCKED',
    `Too many wrong codes. Try again at ${clockAt(retryAt, timeZone)}.`,
    429,
    {
      retryAfterSeconds: Math.max(1, Math.ceil((retryAt.getTime() - now.getTime()) / 1000)),
      details: { retryAt: retryAt.toISOString() },
    },
  );
}

/**
 * The step-up gate for money-back actions (A7.10), called by a service inside its action when
 * `stepUpNeeded()` says so. With no code: STEP_UP_REQUIRED. With a code: checked against the
 * caller's authenticator or backup codes; a wrong one answers STEP_UP_INVALID and counts toward
 * the sign-in lockout (5, then 15 minutes: STEP_UP_LOCKED with `retryAt`). A good one is
 * recorded on the session (`sessions.step_up_at`) and covers the next 10 minutes. Every attempt
 * is audited (`staff.step-up`).
 */
export async function passStepUp(actor: UserActor, code: unknown, now = new Date()): Promise<void> {
  if (code === undefined || code === null) throw stepUpRequired();
  const { method, code: value } = stepUpInput.parse(code);
  const session = await currentSession();
  if (!session || session.user.id !== actor.userId) throw unauthenticated();

  // Wrong codes count here too (10 in 10 minutes); the point comes back for a good one.
  const attempt = await takeAttempt('staff.step-up', `user:${actor.userId}`);
  const record = (outcome: 'passed' | 'wrong' | 'locked') =>
    runAs(actor, (ctx) =>
      audit(ctx, {
        action: 'staff.step-up',
        targetType: 'user',
        targetId: actor.userId,
        data: { outcome, method },
      }),
    );

  const lock = await runAs(actor, (ctx) => findTwoFactorLock(ctx, actor.userId));
  if (lock?.lockedUntil && lock.lockedUntil.getTime() > now.getTime()) {
    await record('locked');
    throw await lockedError(lock.lockedUntil, now);
  }
  if (lock?.lockedUntil) await runAs(actor, (ctx) => resetTwoFactorFailures(ctx, lock.id));

  const good = lock ? await checkStepUpCode(method, value) : false;
  if (!good) {
    const counted = lock
      ? await runAs(actor, (ctx) =>
          countTwoFactorFailure(ctx, lock.id, LOCK_AFTER, new Date(now.getTime() + LOCK_MS)),
        )
      : { failures: 0, lockedUntil: null };
    if (counted.lockedUntil) {
      await record('locked');
      logger.warn({ userId: actor.userId }, 'step-up locked after wrong codes');
      throw await lockedError(counted.lockedUntil, now);
    }
    await record('wrong');
    const message = method === 'totp' ? STEP_UP_ERRORS.totp : STEP_UP_ERRORS.backup;
    throw new AppError('STEP_UP_INVALID', message, 422, { fieldErrors: { stepUp: [message] } });
  }

  await runAs(actor, async (ctx) => {
    await resetTwoFactorFailures(ctx, lock!.id);
    await recordSessionStepUp(ctx, session.session.id, actor.userId, now);
    await audit(ctx, {
      action: 'staff.step-up',
      targetType: 'user',
      targetId: actor.userId,
      data: { outcome: 'passed', method },
    });
  });
  await attempt.refund();
}
