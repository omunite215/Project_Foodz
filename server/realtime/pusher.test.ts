import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  trigger: vi.fn<(channel: string, event: string, data: unknown) => Promise<Response>>(),
  warn: vi.fn<(...args: unknown[]) => void>(),
}));
vi.mock('pusher', () => ({
  default: class {
    trigger = mocks.trigger;
  },
}));
vi.mock('@/server/logger', () => ({ logger: { warn: mocks.warn } }));

const { publish } = await import('./pusher');

const notification = {
  id: 'n1',
  title: 'Order on its way',
  body: 'Riley picked it up',
  link: null,
};

beforeEach(() => {
  mocks.trigger.mockReset();
  mocks.warn.mockReset();
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
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  it('logs a rejection that comes back as 200 with an error body (Soketi)', async () => {
    mocks.trigger.mockResolvedValue(
      new Response('{"error":"The secret authentication failed","code":401}'),
    );
    await publish('private-user-1', 'notification.created', notification);
    expect(mocks.warn).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'private-user-1' }),
      'realtime publish rejected',
    );
  });

  it('logs instead of throwing when the realtime server is down', async () => {
    mocks.trigger.mockRejectedValue(new Error('connect ECONNREFUSED'));
    await expect(
      publish('private-ops', 'order.status-changed', {
        orderId: 'o1',
        status: 'READY',
        at: new Date().toISOString(),
      }),
    ).resolves.toBeUndefined();
    expect(mocks.warn).toHaveBeenCalledWith(expect.anything(), 'realtime publish failed');
  });
});
