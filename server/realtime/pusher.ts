import 'server-only';
import Pusher from 'pusher';
import type { RealtimeEventName, RealtimeEvents } from '@/lib/realtime/events';
import { logger } from '@/server/logger';

/** Soketi locally (PUSHER_HOST set), Pusher Channels in production (cluster). */
function createPusher() {
  const base = {
    appId: process.env.PUSHER_APP_ID ?? '',
    key: process.env.NEXT_PUBLIC_PUSHER_KEY ?? '',
    secret: process.env.PUSHER_SECRET ?? '',
    useTLS: process.env.PUSHER_USE_TLS === 'true' || process.env.PUSHER_USE_TLS === '1',
  };
  return process.env.PUSHER_HOST
    ? new Pusher({ ...base, host: process.env.PUSHER_HOST, port: process.env.PUSHER_PORT })
    : new Pusher({ ...base, cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER ?? 'mt1' });
}

let pusher: Pusher | undefined;
const getPusher = () => (pusher ??= createPusher());

/**
 * Sends an event to everyone subscribed to a channel. Realtime updates are a convenience on
 * top of data that is already saved, so a failure is logged instead of failing the request.
 */
export async function publish<E extends RealtimeEventName>(
  channel: string,
  event: E,
  data: RealtimeEvents[E],
) {
  try {
    const response = await getPusher().trigger(channel, event, data);
    // Soketi reports some rejections (a wrong secret, for one) as 200 with an error body.
    const body = await response.text();
    if (body.includes('"error"')) {
      logger.warn({ channel, event, response: body.slice(0, 200) }, 'realtime publish rejected');
    }
  } catch (error) {
    logger.warn({ err: error, channel, event }, 'realtime publish failed');
  }
}

/** Signs a subscription the server has already decided to allow. */
export function signSubscription(socketId: string, channel: string) {
  return getPusher().authorizeChannel(socketId, channel);
}
