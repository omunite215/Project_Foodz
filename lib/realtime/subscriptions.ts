/** The part of the pusher-js client the registry needs; small enough to fake in tests. */
export interface ChannelClient {
  subscribe(channel: string): {
    bind(event: string, callback: (data: unknown) => void): unknown;
    unbind(event: string, callback: (data: unknown) => void): unknown;
  };
  unsubscribe(channel: string): void;
}

/**
 * Several components can listen to the same channel (a badge and a page, say). The channel is
 * subscribed on the first listener and left only when the last one goes away.
 */
export function createSubscriptionRegistry(client: ChannelClient) {
  const listeners = new Map<string, number>();

  return function listen(channel: string, event: string, callback: (data: unknown) => void) {
    listeners.set(channel, (listeners.get(channel) ?? 0) + 1);
    const subscription = client.subscribe(channel);
    subscription.bind(event, callback);

    let active = true;
    return function stop() {
      if (!active) return;
      active = false;
      subscription.unbind(event, callback);
      const remaining = (listeners.get(channel) ?? 1) - 1;
      if (remaining > 0) {
        listeners.set(channel, remaining);
      } else {
        listeners.delete(channel);
        client.unsubscribe(channel);
      }
    };
  };
}
