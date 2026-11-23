import 'server-only';
import { isAPIError } from 'better-auth/api';
import { headers } from 'next/headers';
import { auth } from './index';

/*
 * Checks a step-up code (F5 A7.10) against the signed-in caller's authenticator or backup
 * codes, through the two-factor plugin itself, so the codes are read and a backup code is used
 * up exactly as at sign-in. Called with the request's own session; the library keeps no
 * failure count for a signed-in check, so the caller counts wrong codes toward the lockout.
 */

const WRONG = new Set([
  'INVALID_CODE',
  'INVALID_BACKUP_CODE',
  'TOTP_NOT_ENABLED',
  'BACKUP_CODES_NOT_ENABLED',
  'TWO_FACTOR_NOT_ENABLED',
]);

const codeOf = (error: unknown) =>
  isAPIError(error) ? (error.body as { code?: string } | undefined)?.code : undefined;

/** True for a good code; false for a wrong one. Anything else (no session, an outage) throws. */
export async function checkStepUpCode(method: 'totp' | 'backup', code: string): Promise<boolean> {
  const requestHeaders = new Headers(await headers());
  try {
    if (method === 'totp') {
      await auth.api.verifyTOTP({ body: { code }, headers: requestHeaders });
    } else {
      await auth.api.verifyBackupCode({
        body: { code, disableSession: true },
        headers: requestHeaders,
      });
    }
    return true;
  } catch (error) {
    const reason = codeOf(error);
    if (reason && WRONG.has(reason)) return false;
    throw error;
  }
}
