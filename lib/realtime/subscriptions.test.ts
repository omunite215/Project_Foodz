import { describe, expect, it, vi } from 'vitest';
import { type ChannelClient, createSubscriptionRegistry } from './subscriptions';

function fakeClient() {
  const bound = new Map<string, Set<(data: unknown) => void>>();
  const subscribed = new Set<string>();
  const unsubscribe = vi.fn<(channel: string) => void>(
    (channel) => void subscribed.delete(channel),
  );
  const client: ChannelClient = {
    subscribe: (channel) => {
      subscribed.add(channel);
      return {
        bind: (event, callback) => {
          const key = `${channel}:${event}`;
          bound.set(key, (bound.get(key) ?? new Set()).add(callback));
        },
        unbind: (event, callback) => bound.get(`${channel}:${event}`)?.delete(callback),
      };
    },
    unsubscribe,
  };
  const emit = (channel: string, event: string, data: unknown) => {
    for (const callback of bound.get(`${channel}:${event}`) ?? []) callback(data);
  };
  return { client, subscribed, unsubscribe, emit };
}

describe('subscription registry', () => {
  it('delivers events to every listener of a channel', () => {
    const { client, emit } = fakeClient();
    const listen = createSubscriptionRegistry(client);
    const badge = vi.fn<(data: unknown) => void>();
    const page = vi.fn<(data: unknown) => void>();

    listen('private-user-1', 'notification.created', badge);
    listen('private-user-1', 'notification.created', page);
    emit('private-user-1', 'notification.created', { id: 'n1' });

    expect(badge).toHaveBeenCalledWith({ id: 'n1' });
    expect(page).toHaveBeenCalledWith({ id: 'n1' });
  });

  it('stays subscribed until the last listener stops', () => {
    const { client, subscribed, emit } = fakeClient();
    const listen = createSubscriptionRegistry(client);
    const badge = vi.fn<(data: unknown) => void>();
    const page = vi.fn<(data: unknown) => void>();

    const stopBadge = listen('private-user-1', 'notification.created', badge);
    const stopPage = listen('private-user-1', 'notification.created', page);

    stopPage();
    expect(subscribed.has('private-user-1')).toBe(true);
    emit('private-user-1', 'notification.created', {});
    expect(page).not.toHaveBeenCalled();
    expect(badge).toHaveBeenCalledTimes(1);

    stopBadge();
    expect(subscribed.has('private-user-1')).toBe(false);
  });

  it('ignores a second stop call', () => {
    const { client, unsubscribe } = fakeClient();
    const listen = createSubscriptionRegistry(client);
    const stopFirst = listen('private-ops', 'order.status-changed', () => {});
    listen('private-ops', 'order.status-changed', () => {});

    stopFirst();
    stopFirst();

    expect(unsubscribe).not.toHaveBeenCalled();
  });
});
