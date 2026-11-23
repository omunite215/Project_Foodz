import Redis from 'ioredis';
import { describe, expect, it } from 'vitest';
import { redisOptions } from './redis-options';

const open = (url: string) => new Redis(url, { ...redisOptions(), lazyConnect: true });

describe('redisOptions', () => {
  it('turns TLS on for a rediss:// URL', () => {
    const client = open('rediss://:token@cache.example.internal:6379');
    expect(client.options.tls).toBeDefined();
    expect(client.options.host).toBe('cache.example.internal');
    client.disconnect();
  });

  it('keeps plain redis:// without TLS', () => {
    const client = open('redis://127.0.0.1:6380');
    expect(client.options.tls).toBeUndefined();
    client.disconnect();
  });

  it('fails fast during an outage', () => {
    expect(redisOptions()).toMatchObject({ enableOfflineQueue: false, maxRetriesPerRequest: 2 });
  });
});
