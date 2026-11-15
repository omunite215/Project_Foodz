import 'server-only';
import { parseChannel } from '@/lib/realtime/channels';
import { can, isStaff, type Role } from '@/server/auth/roles';
import { runAs } from '@/server/db/context';
import { isOrderVisible, partnerIdOfUser } from './repo';

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
      // The customer who placed it and the courier assigned to it: exactly who RLS lets read it.
      return runAs(actorOf(subscriber), (ctx) => isOrderVisible(ctx, channel.id));
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
