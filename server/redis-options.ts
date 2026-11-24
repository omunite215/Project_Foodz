import type { RedisOptions } from 'ioredis';

/**
 * Connection options shared by every Redis client. A `rediss://` URL (ElastiCache with
 * in-transit encryption) turns TLS on through ioredis; the certificate is verified against the
 * host name in the URL, so the URL must use the cluster's endpoint name.
 */
export function redisOptions(): RedisOptions {
  return {
    maxRetriesPerRequest: 2,
    // Commands fail fast during an outage instead of piling up.
    enableOfflineQueue: false,
    lazyConnect: false,
  };
}
