import 'server-only';
import { createHmac, hkdfSync } from 'node:crypto';

/*
 * The delivery code's check value (F8 contract §4): HMAC-SHA256 of "<delivery id>:<code>" under a
 * key derived from the field key, so no new secret is needed and a code means nothing on
 * another delivery. The database compares these hashes; the digits never leave memory.
 */

function codeKey(raw = process.env.FIELD_ENCRYPTION_KEY): Buffer {
  const key = raw ? Buffer.from(raw, 'base64') : Buffer.alloc(0);
  if (key.length !== 32) throw new Error('FIELD_ENCRYPTION_KEY must be 32 bytes, base64-encoded');
  return Buffer.from(hkdfSync('sha256', key, Buffer.alloc(0), 'foodz:delivery-code', 32));
}

export function deliveryCodeHash(deliveryId: string, code: string, raw?: string): string {
  return createHmac('sha256', codeKey(raw)).update(`${deliveryId}:${code}`).digest('hex');
}

export const deliveryCodeContext = (deliveryId: string) => `deliveries.otp:${deliveryId}`;
