import 'server-only';
import { eventType } from 'inngest';
import { z } from 'zod';

/*
 * Domain events of the order lifecycle (F5). Payloads carry ids, statuses and instants only;
 * each job reads the order itself. F4's `order.refund-requested` and `order.email-requested`
 * carry the refund and the cancellation email for staff cancellations too.
 */

const status = z.enum([
  'PENDING_PAYMENT',
  'PLACED',
  'ACCEPTED',
  'PREPARING',
  'READY',
  'PICKED_UP',
  'DELIVERED',
  'CANCELLED',
  'FAILED',
]);

/**
 * A kitchen step whose customer notice waits out the undo window (A4.8, S6.1-S6.3). Sent with
 * the event id `order-step-notice-<eventId>`; the job sleeps until `dueAt`, then sends the
 * notice unless the step was undone, overtaken or cancelled, at most once per order and step.
 */
export const orderStepNoticeRequested = eventType('order.step-notice-requested', {
  schema: z
    .object({
      orderId: z.uuid(),
      step: z.enum(['accepted', 'ready']),
      eventId: z.uuid(),
      dueAt: z.iso.datetime(),
    })
    .strict(),
});

/** The kitchen committed (B5). Nothing listens in F5. */
export const orderAccepted = eventType('order.accepted', {
  schema: z.object({ orderId: z.uuid(), eventId: z.uuid(), at: z.iso.datetime() }).strict(),
});

/** "Mark ready": F7's dispatch trigger (A4.5). Nothing listens in F5. */
export const orderReady = eventType('order.ready', {
  schema: z.object({ orderId: z.uuid(), eventId: z.uuid(), at: z.iso.datetime() }).strict(),
});

/** Undo or Move back: F7 cancels a dispatch started for a status the order has left. */
export const orderStatusReverted = eventType('order.status-reverted', {
  schema: z
    .object({
      orderId: z.uuid(),
      from: status,
      to: status,
      eventId: z.uuid(),
      at: z.iso.datetime(),
    })
    .strict(),
});

/** Any cancellation after the order was placed (B5): F7 stops dispatch. */
export const orderCancelled = eventType('order.cancelled', {
  schema: z
    .object({
      orderId: z.uuid(),
      by: z.enum(['customer', 'staff', 'system']),
      at: z.iso.datetime(),
    })
    .strict(),
});
