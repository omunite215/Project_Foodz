'use client';

import Pusher from 'pusher-js';
import { useEffect, useEffectEvent, useState, useSyncExternalStore } from 'react';
import type { RealtimeEventName, RealtimeEvents } from './events';
import {
  isSocketState,
  type RealtimeStatus,
  realtimeStatusOf,
  type SocketState,
  type SubscriptionState,
  subscriptionErrorStatus,
} from './status';
import { createSubscriptionRegistry } from './subscriptions';

let client: Pusher | undefined;
let listen: ReturnType<typeof createSubscriptionRegistry> | undefined;

/** One connection per tab: Soketi locally (host set), Pusher Channels in production. */
function getClient() {
  if (client) return client;
  const host = process.env.NEXT_PUBLIC_PUSHER_HOST;
  const port = Number(process.env.NEXT_PUBLIC_PUSHER_PORT ?? 443);
  const useTLS = ['true', '1'].includes(process.env.NEXT_PUBLIC_PUSHER_USE_TLS ?? '');

  client = new Pusher(process.env.NEXT_PUBLIC_PUSHER_KEY ?? '', {
    cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER ?? 'mt1',
    ...(host
      ? { wsHost: host, wsPort: port, wssPort: port, forceTLS: useTLS }
      : { forceTLS: true }),
    // WebSockets only, on the one scheme the CSP allows: a plain local Soketi never falls back
    // to wss:// (which the browser would refuse), and TLS never falls back to ws://. No stats
    // calls either.
    enabledTransports: host && !useTLS ? ['ws'] : ['wss'],
    disableStats: true,
    channelAuthorization: { endpoint: '/api/realtime/auth', transport: 'ajax' },
  });
  return client;
}

function getListen() {
  listen ??= createSubscriptionRegistry(getClient());
  return listen;
}

/**
 * Calls `onEvent` whenever the server publishes `event` on `channel` (pass null to pause).
 * Subscribing to a private channel the user may not see simply never delivers events.
 */
export function useChannelEvent<E extends RealtimeEventName>(
  channel: string | null,
  event: E,
  onEvent: (data: RealtimeEvents[E]) => void,
) {
  const handle = useEffectEvent((data: unknown) =>
    // Only the server publishes (client events are disabled), so payloads match RealtimeEvents.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    onEvent(data as RealtimeEvents[E]),
  );

  useEffect(() => {
    if (!channel) return undefined;
    return getListen()(channel, event, handle);
  }, [channel, event]);
}

// ------------------------------------------------------------------ connection state

let everConnected = false;

function subscribeToSocket(onChange: () => void) {
  const connection = getClient().connection;
  const handler = ({ current }: { current: unknown }) => {
    if (current === 'connected') everConnected = true;
    onChange();
  };
  connection.bind('state_change', handler);
  return () => {
    connection.unbind('state_change', handler);
  };
}

function socketSnapshot(): SocketState {
  const state: unknown = getClient().connection.state;
  if (state === 'connected') everConnected = true;
  return isSocketState(state) ? state : 'connecting';
}

const serverSocketSnapshot = (): SocketState => 'initialized';
const ignoreSocket = () => () => {};

export interface RealtimeConnection {
  status: RealtimeStatus;
  socket: SocketState;
  /** The socket has been connected at least once in this tab. */
  everConnected: boolean;
}

/**
 * Where the live connection for `channel` stands (F5 design 2.12, 6.6): `connected`,
 * `reconnecting`, `unavailable` (not supported, refused, or never reached) or `signedOut` (the
 * subscription was refused because the session ended). Pass null while realtime isn't used;
 * the answer is then `unavailable` and nothing connects.
 */
export function useRealtimeStatus(channel: string | null): RealtimeConnection {
  const socket = useSyncExternalStore(
    channel ? subscribeToSocket : ignoreSocket,
    channel ? socketSnapshot : serverSocketSnapshot,
    serverSocketSnapshot,
  );
  const [subscription, setSubscription] = useState<{
    channel: string | null;
    state: SubscriptionState;
  }>({ channel: null, state: { kind: 'pending' } });

  useEffect(() => {
    if (!channel) return undefined;
    const register = getListen();
    const stopSucceeded = register(channel, 'pusher:subscription_succeeded', () =>
      setSubscription({ channel, state: { kind: 'subscribed' } }),
    );
    const stopFailed = register(channel, 'pusher:subscription_error', (data) =>
      setSubscription({
        channel,
        state: { kind: 'refused', status: subscriptionErrorStatus(data) },
      }),
    );
    return () => {
      stopSucceeded();
      stopFailed();
    };
  }, [channel]);

  // A channel subscribed before this component mounted already said "succeeded".
  const current =
    subscription.channel === channel
      ? subscription.state
      : channel && typeof window !== 'undefined' && getClient().channel(channel)?.subscribed
        ? ({ kind: 'subscribed' } as const)
        : ({ kind: 'pending' } as const);

  if (!channel) return { status: 'unavailable', socket, everConnected: false };
  return { status: realtimeStatusOf(socket, current, everConnected), socket, everConnected };
}
