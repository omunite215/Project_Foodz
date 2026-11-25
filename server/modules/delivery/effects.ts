import 'server-only';
import { v7 as uuidv7 } from 'uuid';
import { channels } from '@/lib/realtime/channels';
import type { OfferEndedEvent } from '@/lib/realtime/events';
import type { DeliveryStatus } from '@/server/db/enums';
import { inngest } from '@/server/jobs/client';
import {
  deliveryAssignmentEnded,
  deliveryHandedOver,
  deliveryOfferCreated,
  deliveryOfferEnded,
  dispatchRestartRequested,
} from '@/server/jobs/dispatch-events';
import { logger } from '@/server/logger';
import { publish } from '@/server/realtime/pusher';
import type { OfferEnding, OfferKind } from './schema';

/*
 * What happens after a dispatch change is committed: realtime messages (ids, status, version
 * and times only, W11.1) and the domain events the dispatch run and the expiry job listen to.
 * Each is best effort and keyed so a repeat does nothing; a failure is logged and never undoes
 * the change. The database stays the truth: a missed message is covered by the phone's poll,
 * the board's refresh and the run's re-check after a wait times out.
 */

export type DispatchEffect =
  | {
      kind: 'changed';
      orderId: string;
      status: DeliveryStatus;
      version: number;
      /** The partner who holds (or just lost) the order, told on their own channel. */
      partnerIds: readonly string[];
      at: Date;
    }
  | {
      kind: 'offerCreated';
      offerId: string;
      deliveryId: string;
      orderId: string;
      partnerId: string;
      offerKind: OfferKind;
      expiresAt: Date;
    }
  | {
      kind: 'offerEnded';
      offerId: string;
      deliveryId: string;
      orderId: string;
      partnerId: string;
      ending: OfferEnding;
      /** False when the phone ended it itself (an answer): it already knows. */
      tellPartner: boolean;
      at: Date;
    }
  | { kind: 'restart'; orderId: string; at: Date }
  | {
      kind: 'assignmentEnded';
      deliveryId: string;
      orderId: string;
      partnerId: string;
      how: 'delivered' | 'gave-back' | 'taken-off' | 'cancelled' | 'handed-over' | 'suspended';
      version: number;
      at: Date;
    }
  | { kind: 'handedOver'; orderId: string; at: Date }
  | { kind: 'couriers'; online: number; free: number; at: Date };

/** What the phone is told; an answer of its own and "too late" tell it nothing. */
const PHONE_WHY: Partial<Record<OfferEnding, OfferEndedEvent['why']>> = {
  expired: 'expired',
  declined: 'declined',
  'withdrawn-order': 'withdrawn-order',
  'withdrawn-staff': 'withdrawn-staff',
  'withdrawn-offline': 'withdrawn-offline',
  taken: 'taken',
};

async function runOne(effect: DispatchEffect) {
  switch (effect.kind) {
    case 'changed': {
      const data = {
        orderId: effect.orderId,
        status: effect.status,
        version: effect.version,
        at: effect.at.toISOString(),
      };
      await publish(channels.ops, 'delivery.changed', data);
      await publish(channels.order(effect.orderId), 'delivery.changed', data);
      await Promise.all(
        effect.partnerIds.map((partnerId) =>
          publish(channels.partner(partnerId), 'delivery.changed', data),
        ),
      );
      return;
    }
    case 'offerCreated':
      await publish(channels.partner(effect.partnerId), 'offer.created', {
        offerId: effect.offerId,
        expiresAt: effect.expiresAt.toISOString(),
      });
      await inngest.send(
        deliveryOfferCreated.create(
          {
            offerId: effect.offerId,
            deliveryId: effect.deliveryId,
            orderId: effect.orderId,
            partnerId: effect.partnerId,
            kind: effect.offerKind,
            expiresAt: effect.expiresAt.toISOString(),
          },
          { id: `delivery-offer-created-${effect.offerId}` },
        ),
      );
      return;
    case 'offerEnded': {
      const why = PHONE_WHY[effect.ending];
      if (effect.tellPartner && why) {
        await publish(channels.partner(effect.partnerId), 'offer.ended', {
          offerId: effect.offerId,
          why,
        });
      }
      await inngest.send(
        deliveryOfferEnded.create(
          {
            offerId: effect.offerId,
            deliveryId: effect.deliveryId,
            orderId: effect.orderId,
            partnerId: effect.partnerId,
            ending: effect.ending === 'too-late' ? 'expired' : effect.ending,
            at: effect.at.toISOString(),
          },
          { id: `delivery-offer-ended-${effect.offerId}` },
        ),
      );
      return;
    }
    case 'restart': {
      const eventId = uuidv7();
      await inngest.send(
        dispatchRestartRequested.create(
          { orderId: effect.orderId, eventId, at: effect.at.toISOString() },
          { id: `dispatch-restart-${eventId}` },
        ),
      );
      return;
    }
    case 'couriers':
      await publish(channels.ops, 'couriers.changed', {
        online: effect.online,
        free: effect.free,
        at: effect.at.toISOString(),
      });
      return;
    case 'assignmentEnded':
      await inngest.send(
        deliveryAssignmentEnded.create(
          {
            deliveryId: effect.deliveryId,
            orderId: effect.orderId,
            partnerId: effect.partnerId,
            how: effect.how,
            at: effect.at.toISOString(),
          },
          { id: `delivery-assignment-ended-${effect.deliveryId}-${effect.version}` },
        ),
      );
      return;
    default:
      await inngest.send(
        deliveryHandedOver.create(
          { orderId: effect.orderId, at: effect.at.toISOString() },
          { id: `delivery-handed-over-${effect.orderId}-${effect.at.getTime()}` },
        ),
      );
  }
}

/** One after another, in the order given; each failure is logged and the rest still run. */
export async function runDispatchEffects(effects: readonly DispatchEffect[]) {
  await effects.reduce(
    (previous, effect) =>
      previous.then(() =>
        runOne(effect).catch((error: unknown) => {
          logger.error({ err: error, effect: effect.kind }, 'dispatch follow-up failed');
        }),
      ),
    Promise.resolve(),
  );
}
