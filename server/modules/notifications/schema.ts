import { z } from 'zod';

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
