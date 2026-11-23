import 'server-only';
import { createHmac } from 'node:crypto';

/**
 * A keyed hash of a partner's ID number (F6 B4): two applications with the same number get the
 * same value, so the reviewer sees a flag, yet the number can't be recovered or checked against
 * a guess without the key. ID numbers are short, so the key must stay secret and distinct from
 * FIELD_ENCRYPTION_KEY. Never sent to a browser.
 */
function loadKey(raw = process.env.ID_NUMBER_HASH_KEY): Buffer {
  const key = raw ? Buffer.from(raw, 'base64') : Buffer.alloc(0);
  if (key.length !== 32) throw new Error('ID_NUMBER_HASH_KEY must be 32 bytes, base64-encoded');
  return key;
}

/** `normalized` is the number as stored (capitals, no spaces or hyphens). */
export function idNumberHash(normalized: string, key = loadKey()): string {
  return createHmac('sha256', key).update(`id-number:${normalized}`).digest('base64url');
}
