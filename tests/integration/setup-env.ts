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
