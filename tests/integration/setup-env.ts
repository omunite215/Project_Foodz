import { inject } from 'vitest';

// Point the app's singletons at the test containers before any server module loads.
process.env.DATABASE_URL = inject('databaseUrl');
process.env.REDIS_URL = inject('redisUrl');
process.env.LOG_LEVEL = 'silent';
