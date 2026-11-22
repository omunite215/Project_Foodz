import 'server-only';
import type { UserActor } from '@/server/auth/session';
import type { StaffShell } from './schema';

/*
 * Staff access, sessions and step-up (F5). Contract stage: signatures only; the bodies arrive
 * with the implementation (docs: features/F5/contract.md).
 */

function notImplemented(name: string): never {
  throw new Error(`${name} is not implemented yet.`);
}

/** For the `/admin` layout and every admin page (A1, design 1.1). Reads the session itself. */
export async function getStaffShell(_now = new Date()): Promise<StaffShell> {
  return notImplemented('getStaffShell');
}

/**
 * The step-up gate for money-back actions (A7.10), called by a service inside its action when
 * `stepUpNeeded()` says so. With no code: STEP_UP_REQUIRED. With a code: checked against the
 * caller's authenticator or backup codes; a wrong one answers STEP_UP_INVALID and counts toward
 * the sign-in lockout (5, then 15 minutes: STEP_UP_LOCKED with `retryAt`). A good one is
 * recorded on the session (`sessions.step_up_at`) and covers the next 10 minutes. Every attempt
 * is audited (`staff.step-up`).
 */
export async function passStepUp(
  _actor: UserActor,
  _code: unknown,
  _now = new Date(),
): Promise<void> {
  return notImplemented('passStepUp');
}

/**
 * When the caller's last sign-in or code check stops covering money-back actions, or null when
 * it already has: max(session start, last code check) plus 10 minutes.
 */
export async function stepUpFreshUntil(_now = new Date()): Promise<Date | null> {
  return notImplemented('stepUpFreshUntil');
}
