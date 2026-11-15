import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { decryptField, encryptField } from './field-encryption';

const key = randomBytes(32);
const context = 'delivery_partners.license_number:0196a1b2-0000-7000-8000-000000000001';

/** Flips one character in the given dot-separated part of an encrypted value. */
function tamper(stored: string, partIndex: number) {
  const parts = stored.split('.');
  const part = parts[partIndex]!;
  parts[partIndex] = (part[0] === 'A' ? 'B' : 'A') + part.slice(1);
  return parts.join('.');
}

afterEach(() => {
  delete process.env.FIELD_ENCRYPTION_KEY;
});

describe('field encryption', () => {
  it('round-trips values, including empty and non-ASCII text', () => {
    for (const value of ['D1234-5678-9012', '', 'Führerschein Nr. 7', '운전면허 12-34']) {
      expect(decryptField(encryptField(value, context, key), context, key)).toBe(value);
    }
  });

  it('never stores the plain value and never repeats a ciphertext', () => {
    const first = encryptField('D1234-5678-9012', context, key);
    const second = encryptField('D1234-5678-9012', context, key);
    expect(first).not.toContain('D1234');
    expect(first).not.toBe(second);
    expect(first).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
  });

  it.each([
    ['the IV', 1],
    ['the tag', 2],
    ['the ciphertext', 3],
  ])('rejects a value whose %s was changed', (_part, index) => {
    const stored = encryptField('D1234-5678-9012', context, key);
    expect(() => decryptField(tamper(stored, index), context, key)).toThrow(/Could not decrypt/);
  });

  it('rejects a value copied to another row or column', () => {
    const stored = encryptField('D1234-5678-9012', context, key);
    expect(() =>
      decryptField(stored, 'delivery_partners.license_number:someone-else', key),
    ).toThrow(/Could not decrypt/);
    expect(() => decryptField(stored, 'delivery_partners.id_number:same-row', key)).toThrow(
      /Could not decrypt/,
    );
  });

  it('rejects a value encrypted with a different key', () => {
    const stored = encryptField('D1234-5678-9012', context, randomBytes(32));
    expect(() => decryptField(stored, context, key)).toThrow(/Could not decrypt/);
  });

  it.each(['', 'plain text', 'v2.a.b.c', 'v1.a.b', 'v1.a.b.c.d', 'v1.AAAA.AAAA.AAAA'])(
    'rejects malformed input %j',
    (stored) => {
      expect(() => decryptField(stored, context, key)).toThrow(/format|Could not decrypt/);
    },
  );

  it('reads the key from FIELD_ENCRYPTION_KEY and refuses a key of the wrong size', () => {
    process.env.FIELD_ENCRYPTION_KEY = key.toString('base64');
    expect(decryptField(encryptField('X-1', context), context)).toBe('X-1');

    process.env.FIELD_ENCRYPTION_KEY = randomBytes(16).toString('base64');
    expect(() => encryptField('X-1', context)).toThrow(/32 bytes/);

    delete process.env.FIELD_ENCRYPTION_KEY;
    expect(() => encryptField('X-1', context)).toThrow(/32 bytes/);
  });
});
