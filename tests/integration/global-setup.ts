import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
    migratorUrl: string;
    redisUrl: string;
  }
}

const PASSWORDS = {
  superuser: 'test-superuser',
  migrator: 'test-migrator',
  app: 'test-app',
  readonly: 'test-readonly',
};

let postgres: StartedPostgreSqlContainer | undefined;
let redis: StartedRedisContainer | undefined;

/**
 * Starts a disposable PostGIS database (with the same role setup as production) and a Valkey
 * instance, then applies the real migrations as the migrator role.
 */
export async function setup(project: TestProject) {
  const root = path.resolve(import.meta.dirname, '../..');

  [postgres, redis] = await Promise.all([
    new PostgreSqlContainer('postgis/postgis:17-3.5-alpine')
      .withDatabase('foodz')
      .withUsername('postgres')
      .withPassword(PASSWORDS.superuser)
      .withEnvironment({
        DB_MIGRATOR_PASSWORD: PASSWORDS.migrator,
        DB_APP_PASSWORD: PASSWORDS.app,
        DB_READONLY_PASSWORD: PASSWORDS.readonly,
      })
      .withCopyFilesToContainer([
        {
          source: path.join(root, 'docker/postgres/init/01-roles.sh'),
          target: '/docker-entrypoint-initdb.d/01-roles.sh',
        },
      ])
      .start(),
    new RedisContainer('valkey/valkey:9.0-alpine').start(),
  ]);

  const host = postgres.getHost();
  const port = postgres.getPort();
  const migratorUrl = `postgresql://foodz_migrator:${PASSWORDS.migrator}@${host}:${port}/foodz`;
  const databaseUrl = `postgresql://foodz_app:${PASSWORDS.app}@${host}:${port}/foodz`;

  execFileSync(
    process.execPath,
    [path.join(root, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy'],
    {
      cwd: root,
      env: { ...process.env, DATABASE_MIGRATOR_URL: migratorUrl },
      stdio: 'pipe',
    },
  );

  project.provide('databaseUrl', databaseUrl);
  project.provide('migratorUrl', migratorUrl);
  project.provide('redisUrl', redis.getConnectionUrl());
}

export async function teardown() {
  await Promise.all([postgres?.stop(), redis?.stop()]);
}
