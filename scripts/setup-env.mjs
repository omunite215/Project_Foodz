#!/usr/bin/env node
// Creates .env from .env.example with random local development secrets.
// Refuses to overwrite an existing .env.
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const secret = (bytes = 24) => randomBytes(bytes).toString('base64url');
const values = {
  POSTGRES_SUPERUSER_PASSWORD: secret(),
  DB_MIGRATOR_PASSWORD: secret(),
  DB_APP_PASSWORD: secret(),
  DB_READONLY_PASSWORD: secret(),
  REDIS_PASSWORD: secret(),
  S3_ACCESS_KEY_ID: `foodz${secret(6)}`,
  S3_SECRET_ACCESS_KEY: secret(),
  PUSHER_SECRET: secret(),
  NEXT_PUBLIC_PUSHER_KEY: secret(12),
  BETTER_AUTH_SECRET: secret(32),
  FIELD_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  SEED_ADMIN_PASSWORD: secret(18),
  DEMO_PASSWORD: secret(12),
};

const urls = {
  DATABASE_URL: `postgresql://foodz_app:${values.DB_APP_PASSWORD}@127.0.0.1:5433/foodz`,
  DATABASE_MIGRATOR_URL: `postgresql://foodz_migrator:${values.DB_MIGRATOR_PASSWORD}@127.0.0.1:5433/foodz`,
  DATABASE_READONLY_URL: `postgresql://foodz_readonly:${values.DB_READONLY_PASSWORD}@127.0.0.1:5433/foodz`,
  REDIS_URL: `redis://:${values.REDIS_PASSWORD}@127.0.0.1:6380`,
};

const output = readFileSync('.env.example', 'utf8')
  .split('\n')
  .map((line) => {
    const match = /^([A-Z0-9_]+)=/.exec(line);
    if (!match) return line;
    const key = match[1];
    if (key in urls) return `${key}=${urls[key]}`;
    if (key in values) return `${key}=${values[key]}`;
    return line;
  })
  .join('\n');

try {
  // 'wx' creates the file only if it does not exist, in one atomic step.
  writeFileSync('.env', output, { mode: 0o600, flag: 'wx' });
} catch (error) {
  if (error.code === 'EEXIST') {
    console.error('.env already exists; delete it first to regenerate.');
    process.exit(1);
  }
  throw error;
}
console.warn('Wrote .env with fresh local secrets.');
