import { randomBytes } from 'node:crypto';
import { inject } from 'vitest';

// Point the app's singletons at the test containers before any server module loads.
process.env.DATABASE_URL = inject('databaseUrl');
process.env.REDIS_URL = inject('redisUrl');
process.env.LOG_LEVEL = 'silent';

process.env.S3_ENDPOINT = inject('s3Endpoint');
process.env.S3_REGION = 'auto';
process.env.S3_ACCESS_KEY_ID = 'test-storage';
process.env.S3_SECRET_ACCESS_KEY = 'test-storage-key';
process.env.S3_PUBLIC_BUCKET = 'foodz-public';
process.env.S3_PRIVATE_BUCKET = 'foodz-private';
process.env.S3_PUBLIC_URL = `${inject('s3Endpoint')}/foodz-public`;

// Sign-in and account flows.
process.env.BETTER_AUTH_SECRET = 'integration-auth-secret-integration-auth-secret';
process.env.BETTER_AUTH_URL = 'http://localhost:3456';
process.env.NEXT_PUBLIC_SITE_URL ??= 'http://localhost:3456';
process.env.FIELD_ENCRYPTION_KEY = randomBytes(32).toString('base64');
process.env.ID_NUMBER_HASH_KEY = randomBytes(32).toString('base64');
process.env.TURNSTILE_SECRET_KEY = 'test-turnstile-secret';

// Each test browser has its own address (support/browser.ts sends it as X-Forwarded-For).
process.env.CLIENT_IP_FROM_HEADER = '1';
