import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * F6 U26 (contract 11.5): nothing that serves a request decrypts a partner's ID number. The
 * only code that may call `decryptField` is the encryption module itself, F2's sealed account
 * emails and F8's delivery code (shown to the order's customer), each with its own context.
 */

const root = path.resolve(import.meta.dirname, '../..');
const ALLOWED = new Set([
  'server/security/field-encryption.ts',
  'server/security/field-encryption.test.ts',
  'server/modules/notifications/account-email.ts',
  'server/modules/tracking/service.ts',
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(path.join(root, dir)).flatMap((name) => {
    const relative = `${dir}/${name}`;
    if (name === 'node_modules' || name === 'generated' || name.startsWith('.')) return [];
    if (statSync(path.join(root, relative)).isDirectory()) return sourceFiles(relative);
    return /\.(ts|tsx)$/.test(name) ? [relative] : [];
  });
}

const files = ['app', 'server', 'lib', 'components'].flatMap(sourceFiles);

describe('the partner ID number is never decrypted by the app (U26)', () => {
  it('is encrypted in one module and decrypted nowhere a request runs', () => {
    const users = files.filter((file) =>
      readFileSync(path.join(root, file), 'utf8').includes('decryptField'),
    );
    expect(users.filter((file) => !ALLOWED.has(file))).toEqual([]);
    // It reads every source file, which takes longer than the default 5 s on a busy machine.
  }, 30_000);

  it('never puts the partner context next to a decryption', () => {
    const account = readFileSync(
      path.join(root, 'server/modules/notifications/account-email.ts'),
      'utf8',
    );
    expect(account).not.toContain('license_number');
    expect(files.length).toBeGreaterThan(50);
  });
});
