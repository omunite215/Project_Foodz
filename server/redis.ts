import 'server-only';
import Redis from 'ioredis';

declare global {
  var foodzRedis: Redis | undefined;
}

export const redis =
  globalThis.foodzRedis ??
  new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6380', {
    maxRetriesPerRequest: 2,
    // Commands fail fast during an outage instead of piling up.
    enableOfflineQueue: false,
    lazyConnect: false,
  });

if (process.env.NODE_ENV !== 'production') globalThis.foodzRedis = redis;

interface ReadyEmitter {
  status: string;
  once(event: 'ready', listener: () => void): unknown;
  off(event: 'ready', listener: () => void): unknown;
}

/**
 * Waits briefly for the connection to open. Without the offline queue, a command sent while a
 * fresh instance (a cold start) is still connecting would fail as if Redis were down.
 */
export function waitUntilReady(client: ReadyEmitter = redis, timeoutMs = 1500): Promise<void> {
  if (client.status === 'ready') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onReady = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      client.off('ready', onReady);
      reject(new Error('Redis is not ready'));
    }, timeoutMs);
    client.once('ready', onReady);
  });
}
