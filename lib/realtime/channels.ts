/**
 * Realtime channel names, shared by the server (publishing, authorizing) and the browser
 * (subscribing). Every channel is private: the server decides who may subscribe.
 */

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const SCOPED = new RegExp(`^private-(order|user|partner|track)-(${UUID})$`);

export const channels = {
  /** Status and courier location for one order: its customer, its courier and operations staff. */
  order: (orderId: string) => `private-order-${orderId}`,
  /** Notifications for one user. */
  user: (userId: string) => `private-user-${userId}`,
  /** Delivery offers for one partner. */
  partner: (partnerId: string) => `private-partner-${partnerId}`,
  /** Every order and courier, for the kitchen board and the live ops map. */
  ops: 'private-ops',
  /**
   * F8 (L10.4): a demo run's orders and deliveries, for demo staff only. Real staff never hear
   * about a demo run; the demo admin listens here as well as on `private-ops`.
   */
  opsDemo: 'private-ops-demo',
  /**
   * F8: the courier's live position for one order, from pickup to delivery. The order's customer
   * only: never staff, never a partner (L2, L9; positions for staff go on the map channels).
   */
  track: (orderId: string) => `private-track-${orderId}`,
  /** F8: real couriers' positions, for non-demo SUPPORT and ADMIN with two-factor (L3.1). */
  opsMap: 'private-ops-map',
  /** F8: demo couriers' positions, for demo accounts only (L3.2). */
  opsMapDemo: 'private-ops-map-demo',
} as const;

export type ParsedChannel =
  | { kind: 'order' | 'user' | 'partner' | 'track'; id: string }
  | { kind: 'ops' | 'opsDemo' | 'opsMap' | 'opsMapDemo' };

/** Returns null for anything that is not exactly one of the channels above. */
export function parseChannel(name: string): ParsedChannel | null {
  if (name === channels.ops) return { kind: 'ops' };
  if (name === channels.opsDemo) return { kind: 'opsDemo' };
  if (name === channels.opsMap) return { kind: 'opsMap' };
  if (name === channels.opsMapDemo) return { kind: 'opsMapDemo' };
  const match = SCOPED.exec(name);
  const kind = match?.[1];
  const id = match?.[2];
  if ((kind !== 'order' && kind !== 'user' && kind !== 'partner' && kind !== 'track') || !id) {
    return null;
  }
  return { kind, id };
}
