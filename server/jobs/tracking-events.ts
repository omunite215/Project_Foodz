import 'server-only';
import { eventType } from 'inngest';
import { z } from 'zod';

/*
 * F8's domain events. Payloads carry ids, times and money only: never a position, a code, an
 * address or a phone. The jobs read everything else themselves.
 */

const instant = z.iso.datetime();

/** A courier accepted (F7): the per-delivery estimate loop starts (L4.1, L11.1). */
export const deliveryTrackingStarted = eventType('delivery.tracking-started', {
  schema: z
    .object({ deliveryId: z.uuid(), orderId: z.uuid(), version: z.int().min(0), at: instant })
    .strict(),
});

/** He strayed 150 m from the route: the loop re-plans now instead of at its next tick. */
export const deliveryReplanRequested = eventType('delivery.replan-requested', {
  schema: z.object({ deliveryId: z.uuid(), at: instant }).strict(),
});

/** "Isn't answering" (or "ask to wait"): the 5-minute mark is a durable sleep keyed by `since`. */
export const deliveryNoAnswerStarted = eventType('delivery.no-answer-started', {
  schema: z.object({ deliveryId: z.uuid(), orderId: z.uuid(), since: instant }).strict(),
});

/** L7.3: once per delivery, for F9's ledger and F5's notice. */
export const deliveryDelivered = eventType('delivery.delivered', {
  schema: z
    .object({
      deliveryId: z.uuid(),
      orderId: z.uuid(),
      partnerId: z.uuid(),
      payCents: z.int().min(0),
      tipCents: z.int().min(0),
      cashCents: z.int().min(0),
      how: z.enum(['code', 'staff-confirmed', 'admin-override', 'demo']),
      at: instant,
    })
    .strict(),
});

/** A54.1: the demo admin started a run; the run is keyed by its id and serialized. */
export const demoDeliveryRequested = eventType('demo.delivery-requested', {
  schema: z.object({ runId: z.uuid(), requestedBy: z.uuid(), at: instant }).strict(),
});
