import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import path from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
    migratorUrl: string;
    redisUrl: string;
    s3Endpoint: string;
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
let storage: StartedTestContainer | undefined;

export const S3_TEST = {
  credentials: { accessKeyId: 'test-storage', secretAccessKey: 'test-storage-key' },
  publicBucket: 'foodz-public',
  privateBucket: 'foodz-private',
};

/**
 * Starts a disposable PostGIS database (with the same role setup as production), a Valkey
 * instance and S3-compatible storage, then applies the real migrations as the migrator role.
 */
export async function setup(project: TestProject) {
  const root = path.resolve(import.meta.dirname, '../..');
  avoidWslRelay();

  [postgres, redis, storage] = await Promise.all([
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
    new GenericContainer('rustfs/rustfs:1.0.4')
      .withEnvironment({
        RUSTFS_VOLUMES: '/data',
        RUSTFS_ADDRESS: '0.0.0.0:9000',
        RUSTFS_ACCESS_KEY: S3_TEST.credentials.accessKeyId,
        RUSTFS_SECRET_KEY: S3_TEST.credentials.secretAccessKey,
      })
      .withExposedPorts(9000)
      .withWaitStrategy(Wait.forListeningPorts())
      .start(),
  ]);

  const s3Endpoint = `http://${storage.getHost()}:${storage.getMappedPort(9000)}`;
  await createBuckets(s3Endpoint);

  const host = postgres.getHost();
  const port = postgres.getPort();
  const migratorUrl = `postgresql://foodz_migrator:${PASSWORDS.migrator}@${host}:${port}/foodz`;
  const databaseUrl = `postgresql://foodz_app:${PASSWORDS.app}@${host}:${port}/foodz`;

  execFileSync(
    process.execPath,
    // Resolved like any import, so it also works from a git worktree without its own install.
    [createRequire(import.meta.url).resolve('prisma/build/index.js'), 'migrate', 'deploy'],
    {
      cwd: root,
      env: { ...process.env, DATABASE_MIGRATOR_URL: migratorUrl },
      stdio: 'pipe',
    },
  );

  project.provide('databaseUrl', databaseUrl);
  project.provide('migratorUrl', migratorUrl);
  project.provide('redisUrl', redis.getConnectionUrl());
  project.provide('s3Endpoint', s3Endpoint);
}

/**
 * Docker Desktop on Windows publishes each container port twice: on 127.0.0.1 and ::1 through
 * WSL's localhost relay, and on every other local address through Docker's own forwarder. The
 * relay now and then accepts a connection and never passes it on until it resets it 30 s later,
 * so a test waits on the database or Redis until it times out. Another loopback address goes
 * straight to Docker's forwarder.
 */
function avoidWslRelay() {
  if (process.platform !== 'win32' || process.env.DOCKER_HOST) return;
  process.env.TESTCONTAINERS_HOST_OVERRIDE ??= '127.0.0.2';
}

export async function teardown() {
  await Promise.all([postgres?.stop(), redis?.stop(), storage?.stop()]);
}

/** The storage server can take a moment after its port opens; retry briefly. */
async function createBuckets(endpoint: string) {
  const s3 = new S3Client({
    endpoint,
    region: 'auto',
    forcePathStyle: true,
    credentials: S3_TEST.credentials,
  });
  for (let attempt = 1; ; attempt++) {
    try {
      for (const Bucket of [S3_TEST.publicBucket, S3_TEST.privateBucket]) {
        await s3.send(new CreateBucketCommand({ Bucket }));
      }
      return;
    } catch (error) {
      if (attempt >= 20) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}
