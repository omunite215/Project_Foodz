'use client';

import Pusher from 'pusher-js';
import { useEffect, useEffectEvent } from 'react';
import type { RealtimeEventName, RealtimeEvents } from './events';
import { createSubscriptionRegistry } from './subscriptions';

let listen: ReturnType<typeof createSubscriptionRegistry> | undefined;

/** One connection per tab: Soketi locally (host set), Pusher Channels in production. */
function getListen() {
  if (listen) return listen;
  const host = process.env.NEXT_PUBLIC_PUSHER_HOST;
  const port = Number(process.env.NEXT_PUBLIC_PUSHER_PORT ?? 443);
  const useTLS = ['true', '1'].includes(process.env.NEXT_PUBLIC_PUSHER_USE_TLS ?? '');

  const client = new Pusher(process.env.NEXT_PUBLIC_PUSHER_KEY ?? '', {
    cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER ?? 'mt1',
    ...(host
      ? { wsHost: host, wsPort: port, wssPort: port, forceTLS: useTLS }
      : { forceTLS: true }),
    // WebSockets only: no fallback transports or stats calls to hosts the CSP does not allow.
    enabledTransports: ['ws', 'wss'],
    disableStats: true,
    channelAuthorization: { endpoint: '/api/realtime/auth', transport: 'ajax' },
  });
  listen = createSubscriptionRegistry(client);
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
