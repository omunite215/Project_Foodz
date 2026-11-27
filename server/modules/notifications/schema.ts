import { z } from 'zod';
import { PARTNER_NOTICE_TYPES } from '@/lib/realtime/events';

/** Links point inside the site only: a path, never another host. */
const internalPath = z
  .string()
  .max(300)
  .regex(/^\/(?![/\\])\S*$/, 'Must be a path on this site, like /orders/123');

export const notifyInput = z
  .object({
    userId: z.uuid(),
    /** Machine-readable kind, for filtering and preferences: order.ready, refund.approved, ... */
    type: z
      .string()
      .regex(/^[a-z]+(?:[.-][a-z]+)*$/)
      .max(50),
    title: z.string().trim().min(1).max(120),
    body: z.string().trim().min(1).max(500),
    link: internalPath.optional(),
    /** Also send it by email (from a background job, with retries). */
    email: z.boolean().default(false),
    /**
     * An order notice (F5 S6.1): which order and step it is about, so the browser can keep it
     * off that order's page and the orders list.
     */
    order: z
      .object({
        orderId: z.uuid(),
        orderNumber: z.string().min(1).max(20),
        status: z.enum(['accepted', 'ready', 'pickedUp', 'delivered', 'cancelled', 'rate']),
      })
      .strict()
      .optional(),
    /** Partner news (F6 design 11): the pending screen acts on `type` without reading text. */
    partner: z
      .object({ type: z.enum(PARTNER_NOTICE_TYPES) })
      .strict()
      .optional(),
  })
  .strict();

export type NotifyInput = z.input<typeof notifyInput>;

export const listNotificationsInput = z
  .object({
    unreadOnly: z.boolean().default(false),
    limit: z.int().min(1).max(50).default(20),
  })
  .strict();

export const markReadInput = z.object({ ids: z.array(z.uuid()).min(1).max(100) }).strict();
