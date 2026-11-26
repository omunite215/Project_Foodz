import { AppError } from '@/server/errors';
import { type Attempt, type LimitCheck, takeAttempts } from '@/server/security/rate-limit';
import type { HandOverResult } from './schema';

/*
 * The second fence around the delivery code (L6.3, gate S9): `delivery.otp`, 5 points in 15
 * minutes per courier, taken before the code is checked and fail-closed (a 503 when the limiter
 * is down). Only wrong tries keep their point: a right code, a right code without the cash tick,
 * and a repeat of the same wrong code the server didn't count give it back. The lock in the
 * database stays the rule the courier sees.
 */

export interface CheckedCode {
  result: HandOverResult;
  /** False when the try told nothing about the code (right, or a repeat not counted). */
  counts: boolean;
}

type Take = (checks: readonly LimitCheck[]) => Promise<Attempt>;

export async function withCodeFence(
  userId: string,
  check: () => Promise<CheckedCode>,
  take: Take = takeAttempts,
): Promise<HandOverResult> {
  const fence = await take([{ policy: 'delivery.otp', key: `user:${userId}` }]);
  let checked: CheckedCode;
  try {
    checked = await check();
  } catch (error) {
    // The right code without the cash tick: the server checked the code before the cash.
    if (error instanceof AppError && error.fieldErrors?.cashCollected) await fence.refund();
    throw error;
  }
  if (!checked.counts) await fence.refund();
  return checked.result;
}
