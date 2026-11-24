import 'server-only';
import { eventType } from 'inngest';
import { z } from 'zod';

/*
 * Domain events of dispatch (F7). Payloads carry ids, kinds and instants only: never a name,
 * a position or an address. The dispatch run (`dispatch-order`) is started by F5's
 * `order.ready` and cancelled by F5's `order.cancelled` and `order.status-reverted` and by
 * `delivery.handed-over`, each matched on `orderId`.
 */

const instant = z.iso.datetime();

/**
 * An offer was made (automatic or staff). Starts its own `expire-offer` run, which sleeps
 * until `expiresAt` plus the grace and expires it if nobody answered. Event id
 * `offer-created-<offerId>`.
 */
export const deliveryOfferCreated = eventType('delivery.offer.created', {
  schema: z
    .object({
      offerId: z.uuid(),
      deliveryId: z.uuid(),
      orderId: z.uuid(),
      partnerId: z.uuid(),
      kind: z.enum(['auto', 'staff']),
      expiresAt: instant,
    })
    .strict(),
});

/**
 * An offer ended, for any reason. The dispatch run waits for this (matched on `offerId`) and
 * then makes the next offer, or ends when it was accepted. Event id `offer-ended-<offerId>`.
 */
export const deliveryOfferEnded = eventType('delivery.offer.ended', {
  schema: z
    .object({
      offerId: z.uuid(),
      deliveryId: z.uuid(),
      orderId: z.uuid(),
      partnerId: z.uuid(),
      ending: z.enum([
        'accepted',
        'declined',
        'expired',
        'withdrawn-offline',
        'withdrawn-order',
        'withdrawn-staff',
        'taken',
      ]),
      at: instant,
    })
    .strict(),
});

/** A partner became offerable (went online, or an assignment ended): sweeping runs wake (W5.3). */
export const dispatchPartnerAvailable = eventType('dispatch.partner-available', {
  schema: z.object({ partnerId: z.uuid(), at: instant }).strict(),
});

/** An assignment ended (delivered, given back, taken off, cancelled, handed over, suspended). */
export const deliveryAssignmentEnded = eventType('delivery.assignment-ended', {
  schema: z
    .object({
      deliveryId: z.uuid(),
      orderId: z.uuid(),
      partnerId: z.uuid(),
      how: z.enum(['delivered', 'gave-back', 'taken-off', 'cancelled', 'handed-over', 'suspended']),
      at: instant,
    })
    .strict(),
});

/**
 * F5's manual hand-over by another way (A41.3): cancels the dispatch run like a cancellation.
 * "Picked up by the assigned courier" does not send it.
 */
export const deliveryHandedOver = eventType('delivery.handed-over', {
  schema: z.object({ orderId: z.uuid(), at: instant }).strict(),
});

/**
 * "Find a courier" (A39.4) and the take-off restart (A38.2): starts a new dispatch run for an
 * order that is READY with no run, with no start delay. Event id `dispatch-restart-<eventId>`.
 */
export const dispatchRestartRequested = eventType('dispatch.restart-requested', {
  schema: z.object({ orderId: z.uuid(), eventId: z.uuid(), at: instant }).strict(),
});
