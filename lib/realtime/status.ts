/*
 * Where a realtime connection stands, from the socket's state and one channel's subscription.
 * Pure, so the board (F5 design 2.12) and the customer's order page (6.6) read it the same way.
 */

/** pusher-js connection states. */
export type SocketState =
  | 'initialized'
  | 'connecting'
  | 'connected'
  | 'unavailable'
  | 'failed'
  | 'disconnected';

export type SubscriptionState =
  | { kind: 'pending' }
  | { kind: 'subscribed' }
  /** The auth endpoint said no: 401 when the session ended, 403 when not allowed. */
  | { kind: 'refused'; status: number | null };

export type RealtimeStatus =
  /** Subscribed on a live socket: events arrive. */
  | 'connected'
  /** Was live, or is still starting, and pusher-js keeps trying. */
  | 'reconnecting'
  /** It can't work here: not supported, refused (403), or never reached the server. */
  | 'unavailable'
  /** The subscription was refused because the session is over (401). */
  | 'signedOut';

const SOCKET_STATES: ReadonlySet<string> = new Set([
  'initialized',
  'connecting',
  'connected',
  'unavailable',
  'failed',
  'disconnected',
]);

export const isSocketState = (value: unknown): value is SocketState =>
  typeof value === 'string' && SOCKET_STATES.has(value);

/** The HTTP status pusher-js reports with `pusher:subscription_error`, when there is one. */
export function subscriptionErrorStatus(data: unknown): number | null {
  if (typeof data !== 'object' || data === null || !('status' in data)) return null;
  const { status } = data;
  return typeof status === 'number' ? status : null;
}

export function realtimeStatusOf(
  socket: SocketState,
  subscription: SubscriptionState,
  everConnected: boolean,
): RealtimeStatus {
  if (subscription.kind === 'refused') {
    return subscription.status === 401 ? 'signedOut' : 'unavailable';
  }
  if (socket === 'failed') return 'unavailable';
  // "Unavailable" before the first connection: the server can't be reached at all (A12.6).
  if (socket === 'unavailable' && !everConnected) return 'unavailable';
  if (socket === 'connected' && subscription.kind === 'subscribed') return 'connected';
  return 'reconnecting';
}
