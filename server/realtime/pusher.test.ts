import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  trigger: vi.fn<(channel: string, event: string, data: unknown) => Promise<Response>>(),
  error: vi.fn<(...args: unknown[]) => void>(),
}));
vi.mock('pusher', () => ({
  default: class {
    trigger = mocks.trigger;
  },
}));
vi.mock('@/server/logger', () => ({ logger: { error: mocks.error } }));

vi.stubEnv('PUSHER_APP_ID', 'foodz');
vi.stubEnv('NEXT_PUBLIC_PUSHER_KEY', 'key');
vi.stubEnv('PUSHER_SECRET', 'secret');

const { publish } = await import('./pusher');
const { isRealtimeConfigured } = await import('./config');

afterAll(() => {
  vi.unstubAllEnvs();
});

const notification = {
  id: 'n1',
  title: 'Order on its way',
  body: 'Riley picked it up',
  link: null,
  kind: 'general' as const,
};

beforeEach(() => {
  mocks.trigger.mockReset();
  mocks.error.mockReset();
});

describe('publish', () => {
  it('sends the event to the channel', async () => {
    mocks.trigger.mockResolvedValue(new Response('{}'));
    await publish('private-user-1', 'notification.created', notification);
    expect(mocks.trigger).toHaveBeenCalledWith(
      'private-user-1',
      'notification.created',
      notification,
    );
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it('logs a rejection that comes back as 200 with an error body (Soketi)', async () => {
    mocks.trigger.mockResolvedValue(
      new Response('{"error":"The secret authentication failed","code":401}'),
    );
    await publish('private-user-1', 'notification.created', notification);
    expect(mocks.error).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'private-user-1', alert: 'realtime-publish' }),
      'realtime publish rejected',
    );
  });

  it('logs instead of throwing when the realtime server is down', async () => {
    mocks.trigger.mockRejectedValue(new Error('connect ECONNREFUSED'));
    await expect(
      publish('private-ops', 'order.status-changed', {
        orderId: 'o1',
        status: 'READY',
        version: 4,
        at: new Date().toISOString(),
      }),
    ).resolves.toBeUndefined();
    expect(mocks.error).toHaveBeenCalledWith(
      expect.objectContaining({ alert: 'realtime-publish' }),
      'realtime publish failed',
    );
  });

  it('publishes nothing on a machine without realtime', async () => {
    expect(isRealtimeConfigured({})).toBe(false);
    expect(
      isRealtimeConfigured({ PUSHER_APP_ID: 'a', NEXT_PUBLIC_PUSHER_KEY: 'k', PUSHER_SECRET: 's' }),
    ).toBe(true);
    vi.stubEnv('PUSHER_SECRET', '');
    try {
      await publish('private-user-1', 'notification.created', notification);
      expect(mocks.trigger).not.toHaveBeenCalled();
    } finally {
      vi.stubEnv('PUSHER_SECRET', 'secret');
    }
  });
});
