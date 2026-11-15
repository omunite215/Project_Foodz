/**
 * Realtime channel names, shared by the server (publishing, authorizing) and the browser
 * (subscribing). Every channel is private: the server decides who may subscribe.
 */

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const SCOPED = new RegExp(`^private-(order|user|partner)-(${UUID})$`);

export const channels = {
  /** Status and courier location for one order: its customer, its courier and operations staff. */
  order: (orderId: string) => `private-order-${orderId}`,
  /** Notifications for one user. */
  user: (userId: string) => `private-user-${userId}`,
  /** Delivery offers for one partner. */
  partner: (partnerId: string) => `private-partner-${partnerId}`,
  /** Every order and courier, for the kitchen board and the live ops map. */
  ops: 'private-ops',
} as const;

export type ParsedChannel = { kind: 'order' | 'user' | 'partner'; id: string } | { kind: 'ops' };

/** Returns null for anything that is not exactly one of the channels above. */
export function parseChannel(name: string): ParsedChannel | null {
  if (name === channels.ops) return { kind: 'ops' };
  const match = SCOPED.exec(name);
  const kind = match?.[1];
  const id = match?.[2];
  if ((kind !== 'order' && kind !== 'user' && kind !== 'partner') || !id) return null;
  return { kind, id };
}
