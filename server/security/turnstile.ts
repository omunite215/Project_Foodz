import 'server-only';
import { z } from 'zod';
import { AppError, invalidInput } from '@/server/errors';

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TIMEOUT_MS = 5000;
const verifyResponse = z.object({ success: z.boolean() });

export type TurnstileResult = 'passed' | 'missing' | 'failed' | 'unavailable';

/** Checks a Cloudflare Turnstile token. Never throws. */
export async function checkTurnstile(
  token: string | undefined,
  ip?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TurnstileResult> {
  if (!token) return 'missing';
  const body = new URLSearchParams({
    secret: process.env.TURNSTILE_SECRET_KEY ?? '',
    response: token,
  });
  if (ip && ip !== 'unknown') body.set('remoteip', ip);

  try {
    const response = await fetchImpl(VERIFY_URL, {
      method: 'POST',
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return 'unavailable';
    const result = verifyResponse.safeParse(await response.json());
    if (!result.success) return 'unavailable';
    return result.data.success ? 'passed' : 'failed';
  } catch {
    return 'unavailable';
  }
}

const FAILURES = {
  missing: ['CAPTCHA_REQUIRED', 'Please complete the quick security check.', 403],
  failed: ['CAPTCHA_FAILED', "The security check didn't pass. Please try again.", 403],
  unavailable: [
    'CAPTCHA_UNAVAILABLE',
    "We couldn't run our quick security check. Check your connection, then try again.",
    503,
  ],
} as const;

/** The error to show for a check that did not pass. */
export function turnstileError(result: Exclude<TurnstileResult, 'passed'>): AppError {
  const [code, message, status] = FAILURES[result];
  return new AppError(code, message, status);
}

/** Verifies a token for public forms (contact, partner application); throws when it fails. */
export async function verifyTurnstile(token: string | undefined, ip?: string) {
  const result = await checkTurnstile(token, ip);
  if (result === 'missing') throw invalidInput('Please complete the verification.');
  if (result !== 'passed') throw turnstileError(result);
}
