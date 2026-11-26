import 'server-only';
import { channels } from '@/lib/realtime/channels';
import type { OrderChangedEvent } from '@/lib/realtime/events';
import { runAsSystem } from '@/server/db/context';
import type { OrderStatus } from '@/server/db/enums';
import { isBoardStatus } from '@/server/modules/board/schema';
import { publish } from '@/server/realtime/pusher';
import { findOrderChange, isDemoRunOrder } from './repo';

/*
 * Realtime messages about an order (F5 contract 5), sent after the change is committed. They
 * carry the id, status, version and time only; screens fetch the rest through the authorized
 * data layer. The order's own channel and its customer's channel hear every status or payment
 * change; the staff board hears orders that are on it, join it or leave it, never orders
 * waiting for payment or failed.
 */

export interface OrderChangeNote {
  orderId: string;
  /** The server time of the change (the step time for a status change). */
  at: string;
  /** The status before the change, when it changed: an order leaving the board is announced. */
  fromStatus?: OrderStatus | null;
}

/** Whether the staff board hears about this change. */
export function concernsBoard(status: OrderStatus, fromStatus?: OrderStatus | null) {
  return isBoardStatus(status) || (fromStatus ? isBoardStatus(fromStatus) : false);
}

/**
 * F8 (L10.4): the staff channel that hears about an order. A demo run's order goes to demo staff
 * only, never to real staff browsers (not even its id and status).
 */
export async function staffChannelOf(orderId: string): Promise<string> {
  const demoRun = await runAsSystem('staff channel', (ctx) => isDemoRunOrder(ctx, orderId));
  return demoRun ? channels.opsDemo : channels.ops;
}

export async function publishOrderChange(note: OrderChangeNote) {
  const order = await runAsSystem('order change', (ctx) => findOrderChange(ctx, note.orderId));
  if (!order) return;
  const event: OrderChangedEvent = {
    orderId: order.id,
    status: order.status,
    version: order.version,
    at: note.at,
  };
  await Promise.all([
    publish(channels.order(order.id), 'order.status-changed', event),
    publish(channels.user(order.userId), 'order.status-changed', event),
    ...(concernsBoard(order.status, note.fromStatus)
      ? [publish(await staffChannelOf(order.id), 'order.board-changed', event)]
      : []),
  ]);
}
