import 'server-only';
import { eventType } from 'inngest';
import { z } from 'zod';

/*
 * F9's domain events. Payloads carry ids, times and outcomes only: never a comment, a name or an
 * amount. The jobs read what they need themselves.
 */

const instant = z.iso.datetime();

/**
 * An order was delivered, however it was handed over (courier code, staff, own driver, the
 * customer collecting it): the rating reminder starts its 60 minutes (V6). Sent once per order
 * (`order-delivered-<orderId>`).
 */
export const orderDelivered = eventType('order.delivered', {
  schema: z.object({ orderId: z.uuid(), deliveredAt: instant, at: instant }).strict(),
});

/** The customer rated or skipped: the reminder for that order is cancelled (S3.1, S4.2). */
export const ratingSettled = eventType('rating.settled', {
  schema: z.object({ orderId: z.uuid(), how: z.enum(['rated', 'skipped']), at: instant }).strict(),
});
