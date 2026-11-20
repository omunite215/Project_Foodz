import 'server-only';
import { createHash } from 'node:crypto';
import { logger } from '@/server/logger';
import { redis, waitUntilReady } from '@/server/redis';

/*
 * Codes a caller has already had confirmed as real. While the guessing limit blocks a caller,
 * every code check is refused the same way, so the refusal can't tell real codes from made-up
 * ones; a code from this list is still honoured, so the code already in the cart keeps working
 * (S4.13). A code gets here only by being checked while the caller was not blocked.
 *
 * Codes are kept and logged only as hashes: store-credit codes are secrets.
 */

const REMEMBER_SECONDS = 24 * 60 * 60;

const keyOf = (caller: string) => `promo:confirmed:${caller}`;

export const codeHash = (code: string) =>
  createHash('sha256').update(`promo:${code}`).digest('hex').slice(0, 32);

export async function rememberCode(caller: string, code: string): Promise<void> {
  try {
    await waitUntilReady();
    const key = keyOf(caller);
    await redis.multi().sadd(key, codeHash(code)).expire(key, REMEMBER_SECONDS).exec();
  } catch (error) {
    logger.warn({ err: error }, 'could not remember a confirmed promo code');
  }
}

/** False when unknown or when Redis can't answer (the caller is then simply blocked). */
export async function wasConfirmed(caller: string, code: string): Promise<boolean> {
  try {
    await waitUntilReady();
    return (await redis.sismember(keyOf(caller), codeHash(code))) === 1;
  } catch (error) {
    logger.warn({ err: error }, 'could not read confirmed promo codes');
    return false;
  }
}
