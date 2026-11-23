/*
 * Prepares a managed Postgres (Amazon RDS) the way docker/postgres/init/01-roles.sh prepares the
 * local one: the extensions, the three login roles and their default privileges. The migrations
 * assume the roles exist, and RDS has no init-script hook, so this runs first in the one-off
 * migration task, as the instance's admin user.
 *
 * It is idempotent: roles are created once and their passwords are reset on every run (which is
 * how a rotated secret takes effect). Without DATABASE_ADMIN_URL it does nothing, so the same
 * image still works against the local database, where the init script has already run.
 */
import { Client } from 'pg';

export interface RolePasswords {
  migrator: string;
  app: string;
  readonly: string;
}

const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;

const ROLES = [
  { name: 'foodz_migrator', key: 'migrator', attributes: 'CREATEDB' },
  {
    name: 'foodz_app',
    key: 'app',
    attributes: 'NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS',
  },
  {
    name: 'foodz_readonly',
    key: 'readonly',
    attributes: 'NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS',
  },
] as const;

export function bootstrapStatements(database: string, passwords: RolePasswords): string[] {
  for (const [key, value] of Object.entries(passwords)) {
    if (!value) throw new Error(`The ${key} role password must not be empty`);
  }
  if (!/^[a-z_][a-z0-9_]*$/.test(database)) throw new Error('Unsafe database name');
  const roles = ROLES.map(
    ({ name, key, attributes }) => `DO $$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${name}') THEN
         CREATE ROLE ${name} LOGIN PASSWORD ${literal(passwords[key])} ${attributes};
       ELSE
         ALTER ROLE ${name} WITH LOGIN PASSWORD ${literal(passwords[key])} ${attributes};
       END IF;
     END $$`,
  );
  return [
    'CREATE EXTENSION IF NOT EXISTS postgis',
    'CREATE EXTENSION IF NOT EXISTS pg_trgm',
    'CREATE EXTENSION IF NOT EXISTS unaccent',
    ...roles,
    // On RDS the admin is not a superuser: it must be able to SET ROLE to the migrator to hand it
    // the schema (PostgreSQL 16 no longer grants that to the creator of a role).
    `DO $$ BEGIN
       IF NOT pg_has_role(current_user, 'foodz_migrator', 'USAGE') THEN
         EXECUTE format('GRANT foodz_migrator TO %I', current_user);
       END IF;
     END $$`,
    `REVOKE ALL ON DATABASE ${database} FROM PUBLIC`,
    `GRANT CONNECT ON DATABASE ${database} TO foodz_migrator, foodz_app, foodz_readonly`,
    'REVOKE CREATE ON SCHEMA public FROM PUBLIC',
    'ALTER SCHEMA public OWNER TO foodz_migrator',
    'GRANT USAGE ON SCHEMA public TO foodz_app, foodz_readonly',
    'ALTER DEFAULT PRIVILEGES FOR ROLE foodz_migrator IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO foodz_app',
    'ALTER DEFAULT PRIVILEGES FOR ROLE foodz_migrator IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO foodz_app',
    'ALTER DEFAULT PRIVILEGES FOR ROLE foodz_migrator IN SCHEMA public GRANT SELECT ON TABLES TO foodz_readonly',
  ];
}

async function main() {
  const url = process.env.DATABASE_ADMIN_URL;
  if (!url) {
    console.warn('DATABASE_ADMIN_URL is not set; skipping role bootstrap.');
    return;
  }
  const need = (name: string) => {
    const value = process.env[name];
    if (!value) throw new Error(`${name} must be set`);
    return value;
  };
  const database = decodeURIComponent(new URL(url).pathname.slice(1));
  const statements = bootstrapStatements(database, {
    migrator: need('DB_MIGRATOR_PASSWORD'),
    app: need('DB_APP_PASSWORD'),
    readonly: need('DB_READONLY_PASSWORD'),
  });
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    for (const statement of statements) await client.query(statement);
    console.warn('Database roles and extensions are in place.');
  } finally {
    await client.end();
  }
}

// Only when run directly (tsx prisma/bootstrap.ts), not when a test imports the builder.
if (process.argv[1]?.replaceAll('\\', '/').endsWith('prisma/bootstrap.ts')) {
  main().catch((error: unknown) => {
    // Never print the statements: they contain the passwords.
    console.error('Role bootstrap failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
