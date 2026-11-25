import 'server-only';
import { parseChannel } from '@/lib/realtime/channels';
import { can, isStaff, type Role } from '@/server/auth/roles';
import { runAs } from '@/server/db/context';
import { isOrderVisible, isOwnOrder, partnerIdOfUser } from './repo';

export interface Subscriber {
  userId: string;
  role: Role;
  isDemo: boolean;
  twoFactorEnabled: boolean;
}

/** Operations staff (kitchen, support, admin) who may watch every order. */
function isOperations(subscriber: Subscriber) {
  if (!isStaff(subscriber.role) || !can(subscriber.role, { order: ['read-any'] })) return false;
  // Same rule as requirePermission: staff need two-factor; the read-only demo admin may watch.
  return subscriber.twoFactorEnabled || subscriber.isDemo;
}

/** Decides whether a signed-in user may subscribe to a realtime channel. Deny by default. */
export async function canSubscribe(subscriber: Subscriber, channelName: string): Promise<boolean> {
  const channel = parseChannel(channelName);
  if (!channel) return false;

  switch (channel.kind) {
    case 'user':
      return channel.id === subscriber.userId;
    case 'ops':
      return isOperations(subscriber);
    case 'partner': {
      if (subscriber.role !== 'partner') return false;
      const partnerId = await runAs(actorOf(subscriber), (ctx) =>
        partnerIdOfUser(ctx, subscriber.userId),
      );
      return partnerId === channel.id;
    }
    case 'order':
      if (isStaff(subscriber.role)) return isOperations(subscriber);
      // F8 L9.1: partners stay off order channels; a partner's own order as a customer is fine.
      if (subscriber.role === 'partner') {
        return runAs(actorOf(subscriber), (ctx) => isOwnOrder(ctx, channel.id, subscriber.userId));
      }
      return runAs(actorOf(subscriber), (ctx) => isOrderVisible(ctx, channel.id));
    case 'track':
      // F8 L2: the courier's live position goes to the order's customer only, never staff.
      if (isStaff(subscriber.role)) return false;
      return runAs(actorOf(subscriber), (ctx) => isOwnOrder(ctx, channel.id, subscriber.userId));
    case 'opsMap':
      // F8 L3.1: real couriers for non-demo support and admin with two-factor; never the kitchen.
      return (
        isStaff(subscriber.role) &&
        can(subscriber.role, { delivery: ['track-any'] }) &&
        !subscriber.isDemo &&
        subscriber.twoFactorEnabled
      );
    case 'opsMapDemo':
      // F8 L3.2: demo couriers for demo staff only.
      return (
        isStaff(subscriber.role) &&
        can(subscriber.role, { delivery: ['track-any'] }) &&
        subscriber.isDemo
      );
    default:
      return false;
  }
}

const actorOf = (subscriber: Subscriber) =>
  ({
    kind: 'user',
    userId: subscriber.userId,
    role: subscriber.role,
    isDemo: subscriber.isDemo,
  }) as const;
