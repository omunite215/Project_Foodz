import { describe, expect, it } from 'vitest';
import { bootstrapStatements } from '@/prisma/bootstrap';

const passwords = { migrator: 'm-pass', app: 'a-pass', readonly: 'r-pass' };

describe('bootstrapStatements', () => {
  const sql = bootstrapStatements('foodz', passwords).join('\n');

  it('creates the three roles with least privilege', () => {
    expect(sql).toContain('CREATE ROLE foodz_migrator LOGIN');
    expect(sql).toMatch(/CREATE ROLE foodz_app LOGIN PASSWORD 'a-pass' NOSUPERUSER .*NOBYPASSRLS/);
    expect(sql).toMatch(/CREATE ROLE foodz_readonly LOGIN .*NOBYPASSRLS/);
  });

  it('installs the extensions the schema needs before anything else', () => {
    expect(bootstrapStatements('foodz', passwords).slice(0, 3)).toEqual([
      'CREATE EXTENSION IF NOT EXISTS postgis',
      'CREATE EXTENSION IF NOT EXISTS pg_trgm',
      'CREATE EXTENSION IF NOT EXISTS unaccent',
    ]);
  });

  it('resets passwords when a role already exists, so rotation takes effect', () => {
    expect(sql).toContain("ALTER ROLE foodz_app WITH LOGIN PASSWORD 'a-pass'");
  });

  it('hands the schema to the migrator and locks it against PUBLIC', () => {
    expect(sql).toContain('ALTER SCHEMA public OWNER TO foodz_migrator');
    expect(sql).toContain('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
  });

  it('escapes quotes in passwords', () => {
    const quoted = bootstrapStatements('foodz', { ...passwords, app: "a'b" }).join('\n');
    expect(quoted).toContain("PASSWORD 'a''b'");
  });

  it('refuses empty passwords and unsafe database names', () => {
    expect(() => bootstrapStatements('foodz', { ...passwords, app: '' })).toThrow(/app/);
    expect(() => bootstrapStatements('foodz; DROP', passwords)).toThrow(/Unsafe/);
  });
});
