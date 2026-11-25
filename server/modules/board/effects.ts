import 'server-only';
import { channels } from '@/lib/realtime/channels';
import {
  orderAccepted,
  orderCancelled,
  orderReady,
  orderStatusReverted,
  orderStepNoticeRequested,
} from '@/server/jobs/board-events';
import { inngest } from '@/server/jobs/client';
import type { OrderStatus } from '@/server/db/enums';
import { logger } from '@/server/logger';
import { type OrderChange, orderChanged } from '@/server/modules/delivery/service';
import { issueCodeForOrder } from '@/server/modules/tracking/service';
import { expireMenuCache } from '@/server/modules/menu/cache';
import { type OrderEffect, runEffects } from '@/server/modules/orders/effects';
import { STEP_NOTICE_DELAY_MS } from '@/server/modules/orders/progress-schema';
import { publish } from '@/server/realtime/pusher';

/*
 * What happens after a board change is committed (F5 contract 4, 5, 8): realtime messages,
 * the customer's notices and emails, the refund job, the domain events, and the menu cache for
 * "86 it". Each is best effort and keyed so a repeat does nothing; a failure is logged and never
 * undoes the change. Only the transaction that made a change returns its effects, so a replay
 * runs none.
 */

export type BoardEffect =
  | { kind: 'order'; effect: OrderEffect }
  | { kind: 'stepNotice'; orderId: string; step: 'accepted' | 'ready'; eventId: string; at: Date }
  | { kind: 'accepted' | 'ready'; orderId: string; eventId: string; at: Date }
  | {
      kind: 'reverted';
      orderId: string;
      from: OrderStatus;
      to: OrderStatus;
      eventId: string;
      at: Date;
    }
  | { kind: 'cancelled'; orderId: string; at: Date }
  /** F7 (contract §14): what the order's change does to its delivery. */
  | { kind: 'dispatch'; orderId: string; change: OrderChange }
  | { kind: 'dish'; dishId: string; available: boolean; at: Date };

async function runOne(effect: BoardEffect) {
  switch (effect.kind) {
    case 'order':
      await runEffects([effect.effect]);
      return;
    case 'stepNotice':
      // Waits out the undo window and its grace (A4.8): an undone step sends nothing.
      await inngest.send(
        orderStepNoticeRequested.create(
          {
            orderId: effect.orderId,
            step: effect.step,
            eventId: effect.eventId,
            dueAt: new Date(effect.at.getTime() + STEP_NOTICE_DELAY_MS).toISOString(),
          },
          { id: `order-step-notice-${effect.eventId}` },
        ),
      );
      return;
    case 'accepted':
    case 'ready': {
      const type = effect.kind === 'accepted' ? orderAccepted : orderReady;
      await inngest.send(
        type.create(
          { orderId: effect.orderId, eventId: effect.eventId, at: effect.at.toISOString() },
          { id: `order-${effect.kind}-${effect.eventId}` },
        ),
      );
      return;
    }
    case 'reverted':
      if (effect.from === 'READY') await orderChanged(effect.orderId, 'moved-back');
      if (effect.from === 'PICKED_UP' && effect.to === 'READY') {
        await orderChanged(effect.orderId, 'moved-back-from-out');
      }
      await inngest.send(
        orderStatusReverted.create(
          {
            orderId: effect.orderId,
            from: effect.from,
            to: effect.to,
            eventId: effect.eventId,
            at: effect.at.toISOString(),
          },
          { id: `order-reverted-${effect.eventId}` },
        ),
      );
      return;
    case 'cancelled':
      await orderChanged(effect.orderId, 'cancelled');
      await inngest.send(
        orderCancelled.create(
          { orderId: effect.orderId, by: 'staff', at: effect.at.toISOString() },
          { id: `order-cancelled-${effect.orderId}` },
        ),
      );
      return;
    case 'dispatch':
      await orderChanged(effect.orderId, effect.change);
      // F8 A51.1: a courier kept by ADMIN's override still hands over with a code.
      if (effect.change === 'picked-up-by-courier') await issueCodeForOrder(effect.orderId);
      return;
    case 'dish':
      expireMenuCache();
      await publish(channels.ops, 'menu.availability-changed', {
        dishId: effect.dishId,
        available: effect.available,
        at: effect.at.toISOString(),
      });
      return;
    default:
      return;
  }
}

/** One after another, in the order given; each failure is logged and the rest still run. */
export async function runBoardEffects(effects: readonly BoardEffect[]) {
  await effects.reduce(
    (previous, effect) =>
      previous.then(() =>
        runOne(effect).catch((error: unknown) => {
          logger.error({ err: error, effect: effect.kind }, 'board follow-up failed');
        }),
      ),
    Promise.resolve(),
  );
}
