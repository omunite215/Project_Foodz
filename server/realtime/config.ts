/**
 * Whether this machine has realtime set up. Without it nothing is published, and screens poll
 * instead (the board every 10 seconds, F5 A12.6).
 */
export function isRealtimeConfigured(env: Record<string, string | undefined> = process.env) {
  return Boolean(env.PUSHER_APP_ID && env.NEXT_PUBLIC_PUSHER_KEY && env.PUSHER_SECRET);
}
