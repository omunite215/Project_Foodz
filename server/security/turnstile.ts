import 'server-only';
import { z } from 'zod';
import { invalidInput } from '@/server/errors';

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const verifyResponse = z.object({ success: z.boolean() });

/** Verifies a Cloudflare Turnstile token for public forms (contact, partner application). */
export async function verifyTurnstile(token: string | undefined, ip?: string) {
  if (!token) throw invalidInput('Please complete the verification.');
  const body = new URLSearchParams({
    secret: process.env.TURNSTILE_SECRET_KEY ?? '',
    response: token,
  });
  if (ip) body.set('remoteip', ip);

  const response = await fetch(VERIFY_URL, {
    method: 'POST',
    body,
    signal: AbortSignal.timeout(5000),
  });
  const result = verifyResponse.safeParse(await response.json());
  if (!result.success || !result.data.success)
    throw invalidInput('Verification failed. Please try again.');
}
