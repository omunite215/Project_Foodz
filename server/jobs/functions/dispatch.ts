import 'server-only';
import { dispatchTimings } from '@/server/modules/delivery/rules';
import {
  expireOffer,
  openSearch,
  partnerLeaving,
  searchTurn,
} from '@/server/modules/delivery/service';
import { takeOfflineForMissedOffers } from '@/server/modules/partners/service';
import { orderCancelled, orderReady, orderStatusReverted } from '../board-events';
import { inngest } from '../client';
import { type DispatchStep, runDispatch } from '../dispatch-run';
import {
  deliveryAssignmentEnded,
  deliveryHandedOver,
  deliveryOfferCreated,
  deliveryOfferEnded,
  dispatchPartnerAvailable,
  dispatchRestartRequested,
} from '../dispatch-events';
import { partnerSuspended, partnerWentOffline, partnerWentOnline } from '../partner-events';

/*
 * F7's four functions (contract §6). The run for one order is serialized by its order id and
 * keyed by the "Mark ready" (or restart) event, so a repeat of the same event starts nothing;
 * cancelling, moving back or handing the order over another way cancels it.
 */

export const dispatchOrder = inngest.createFunction(
  {
    id: 'dispatch-order',
    triggers: [orderReady, dispatchRestartRequested],
    idempotency: 'event.data.eventId',
    concurrency: { key: 'event.data.orderId', limit: 1 },
    cancelOn: [
      { event: orderCancelled, match: 'data.orderId' },
      { event: orderStatusReverted, match: 'data.orderId' },
      { event: deliveryHandedOver, match: 'data.orderId' },
    ],
    retries: 3,
  },
  async ({ event, step }) => {
    const durable: DispatchStep = {
      open: (id, work) => step.run(id, work),
      turn: (id, work) => step.run(id, work),
      sleepUntil: (id, at) => step.sleepUntil(id, at),
      waitForOfferEnd: (id, offerId, timeout) =>
        step.waitForEvent(id, {
          event: deliveryOfferEnded,
          timeout,
          if: `async.data.offerId == ${JSON.stringify(offerId)}`,
        }),
      waitForPartner: (id, seconds) =>
        step.waitForEvent(id, { event: dispatchPartnerAvailable, timeout: `${seconds}s` }),
    };
    return runDispatch(
      durable,
      {
        orderId: event.data.orderId,
        eventId: event.data.eventId,
        at: event.data.at,
        restart: event.name === dispatchRestartRequested.name,
      },
      { openSearch, searchTurn },
      dispatchTimings(process.env),
    );
  },
);

/** W4.2: one per offer; closes it at the end plus the grace, by the database's clock. */
export const expireOfferJob = inngest.createFunction(
  {
    id: 'expire-offer',
    triggers: [deliveryOfferCreated],
    idempotency: 'event.data.offerId',
    retries: 4,
  },
  async ({ event, step }) => {
    const { graceSeconds } = dispatchTimings(process.env);
    await step.sleepUntil(
      'wait for the end',
      new Date(Date.parse(event.data.expiresAt) + graceSeconds * 1000),
    );
    let result = await step.run('expire', () => expireOffer(event.data.offerId));
    if (result.outcome === 'not-due') {
      // The job's clock ran a little ahead of the database's.
      await step.sleep('settle', '2s');
      result = await step.run('expire again', () => expireOffer(event.data.offerId));
    }
    if (result.outcome === 'expired' && result.takeOffline) {
      const { partnerId } = result;
      await step.run('take offline after three misses', () =>
        takeOfflineForMissedOffers(partnerId),
      );
    }
    return result;
  },
);

/** A39.3, W5.3: a partner coming online or ending an order wakes escalated searches. */
export const dispatchWake = inngest.createFunction(
  { id: 'dispatch-wake', triggers: [partnerWentOnline, deliveryAssignmentEnded], retries: 2 },
  async ({ event, step }) =>
    step.sendEvent(
      'wake searches',
      dispatchPartnerAvailable.create({ partnerId: event.data.partnerId, at: event.data.at }),
    ),
);

/** The backstop for the synchronous offline and suspension hooks (W7.1, A25). */
export const withdrawOnOffline = inngest.createFunction(
  { id: 'withdraw-on-offline', triggers: [partnerWentOffline, partnerSuspended], retries: 3 },
  async ({ event, step }) =>
    step.run('withdraw', () =>
      partnerLeaving(
        event.data.partnerId,
        event.name === partnerSuspended.name ? 'suspended' : 'offline',
      ),
    ),
);
