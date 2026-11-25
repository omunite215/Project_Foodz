/**
 * The ID number hash key and the field encryption key are never the same secret (F6 B4): a
 * shared key would let one leak open both. Checked at server start and before each hash.
 */
export function hashKeyDistinct(env: Record<string, string | undefined>): boolean {
  const hash = env.ID_NUMBER_HASH_KEY;
  const field = env.FIELD_ENCRYPTION_KEY;
  return !hash || !field || Buffer.from(hash, 'base64').compare(Buffer.from(field, 'base64')) !== 0;
}
