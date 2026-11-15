import 'server-only';
import Redis from 'ioredis';

declare global {
  var foodzRedis: Redis | undefined;
}

export const redis =
  globalThis.foodzRedis ??
  new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6380', {
    maxRetriesPerRequest: 2,
    enableOfflineQueue: false,
    lazyConnect: false,
  });

if (process.env.NODE_ENV !== 'production') globalThis.foodzRedis = redis;
