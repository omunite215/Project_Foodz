import 'server-only';
import { createHash } from 'node:crypto';

const RANGE_URL = 'https://api.pwnedpasswords.com/range/';
const TIMEOUT_MS = 3000;

export type BreachCheck = 'breached' | 'clean' | 'unknown';

/**
 * Looks a password up in the Have I Been Pwned corpus with k-anonymity: only the first five
 * characters of its SHA-1 hash leave the server, and padding hides the response size.
 * Returns 'unknown' when the service fails or is slow, so the caller decides (B2: let it
 * through and record it).
 */
export async function checkPasswordBreach(
  password: string,
  fetchImpl: typeof fetch = fetch,
): Promise<BreachCheck> {
  const hash = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);
  try {
    const response = await fetchImpl(`${RANGE_URL}${prefix}`, {
      headers: { 'add-padding': 'true', 'user-agent': 'foodz-password-check' },
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return 'unknown';
    const body = await response.text();
    for (const line of body.split(/\r?\n/)) {
      const [candidate, count] = line.trim().split(':');
      // Padding entries carry a count of 0.
      if (candidate === suffix) return Number(count) > 0 ? 'breached' : 'clean';
    }
    return 'clean';
  } catch {
    return 'unknown';
  }
}
