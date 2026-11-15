import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

// No real connection in unit tests.
vi.mock('ioredis', () => ({
  default: class extends EventEmitter {
    status = 'end';
  },
}));
const { waitUntilReady } = await import('./redis');

function fakeClient(status: string) {
  return Object.assign(new EventEmitter(), { status });
}

describe('waitUntilReady', () => {
  it('returns at once when already connected', async () => {
    await expect(waitUntilReady(fakeClient('ready'), 10)).resolves.toBeUndefined();
  });

  it('waits for the connection to open', async () => {
    const client = fakeClient('connecting');
    setTimeout(() => client.emit('ready'), 20);
    await expect(waitUntilReady(client, 1000)).resolves.toBeUndefined();
  });

  it('gives up after the timeout and stops listening', async () => {
    const client = fakeClient('reconnecting');
    await expect(waitUntilReady(client, 20)).rejects.toThrow('Redis is not ready');
    expect(client.listenerCount('ready')).toBe(0);
  });
});
