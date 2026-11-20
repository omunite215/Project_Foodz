import 'server-only';
import { z } from 'zod';
import { UNKNOWN_CLIENT } from '@/server/client-ip';
import { AppError, invalidInput } from '@/server/errors';

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TIMEOUT_MS = 5000;
const verifyResponse = z.object({
  success: z.boolean(),
  hostname: z.string().max(253).optional(),
  action: z.string().max(64).optional(),
});

/**
 * Cloudflare's published test secrets (always pass, always fail, already spent). Their answers
 * carry a fixed hostname, example.com, and no action, so neither can be compared.
 */
const TEST_SECRET = /^[123]x0{31}AA$/;

export type TurnstileResult = 'passed' | 'missing' | 'failed' | 'unavailable';

export interface TurnstileCheck {
  /** The client address, passed on to Cloudflare when known. */
  ip?: string;
  /** The widget's `action`; a token solved for another form fails. */
  action?: string;
}

/** The host the widget must have been solved on: this site's. */
function siteHostname() {
  try {
    return process.env.NEXT_PUBLIC_SITE_URL
      ? new URL(process.env.NEXT_PUBLIC_SITE_URL).hostname
      : null;
  } catch {
    return null;
  }
}

/** Checks a Cloudflare Turnstile token. Never throws. */
export async function checkTurnstile(
  token: string | undefined,
  { ip, action }: TurnstileCheck = {},
  fetchImpl: typeof fetch = fetch,
): Promise<TurnstileResult> {
  if (!token) return 'missing';
  const secret = process.env.TURNSTILE_SECRET_KEY ?? '';
  const body = new URLSearchParams({ secret, response: token });
  if (ip && ip !== UNKNOWN_CLIENT) body.set('remoteip', ip);

  let answer: z.infer<typeof verifyResponse>;
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
    answer = result.data;
  } catch {
    return 'unavailable';
  }

  if (!answer.success) return 'failed';
  if (TEST_SECRET.test(secret)) return 'passed';
  const hostname = siteHostname();
  if (hostname && answer.hostname !== hostname) return 'failed';
  if (action && answer.action !== action) return 'failed';
  return 'passed';
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
export async function verifyTurnstile(token: string | undefined, check: TurnstileCheck = {}) {
  const result = await checkTurnstile(token, check);
  if (result === 'missing') throw invalidInput('Please complete the verification.');
  if (result !== 'passed') throw turnstileError(result);
}
