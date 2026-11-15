import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Encrypts individual database fields (partner ID and licence numbers) with AES-256-GCM.
 *
 * Stored format: `v1.<iv>.<tag>.<ciphertext>`, each part base64url. The version prefix leaves
 * room to rotate keys later.
 *
 * `context` names where the value lives, e.g. `delivery_partners.license_number:<partner id>`.
 * It is authenticated but not stored, so a ciphertext copied to another row or column fails to
 * decrypt instead of revealing someone else's number.
 */

const VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;

function loadKey(raw = process.env.FIELD_ENCRYPTION_KEY): Buffer {
  const key = raw ? Buffer.from(raw, 'base64') : Buffer.alloc(0);
  if (key.length !== 32) throw new Error('FIELD_ENCRYPTION_KEY must be 32 bytes, base64-encoded');
  return key;
}

export function encryptField(plaintext: string, context: string, key = loadKey()): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(context, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), ciphertext]
    .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
    .join('.');
}

/** Throws if the value was changed, belongs to a different context, or used another key. */
export function decryptField(stored: string, context: string, key = loadKey()): string {
  const [version, iv, tag, ciphertext, ...rest] = stored.split('.');
  if (version !== VERSION || !iv || !tag || ciphertext === undefined || rest.length > 0) {
    throw new Error('Unrecognised encrypted field format');
  }
  const ivBytes = Buffer.from(iv, 'base64url');
  const tagBytes = Buffer.from(tag, 'base64url');
  if (ivBytes.length !== IV_BYTES || tagBytes.length !== TAG_BYTES) {
    throw new Error('Unrecognised encrypted field format');
  }

  try {
    const decipher = createDecipheriv('aes-256-gcm', key, ivBytes, { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(context, 'utf8'));
    decipher.setAuthTag(tagBytes);
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch (error) {
    throw new Error('Could not decrypt field', { cause: error });
  }
}
