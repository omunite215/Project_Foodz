import 'server-only';
import { eventType, Inngest } from 'inngest';
import { z } from 'zod';
import { logger } from '@/server/logger';

/**
 * Background jobs run on Inngest: the local dev server in Docker, Inngest Cloud in production.
 *
 * Dev mode skips request signing, so it is never allowed on Vercel, even if INNGEST_DEV is set
 * by mistake. Everywhere else, cloud mode needs INNGEST_SIGNING_KEY and rejects any request
 * to /api/inngest without a valid signature.
 */
export function isInngestDevMode(env: Record<string, string | undefined> = process.env) {
  return env.INNGEST_DEV === '1' && !env.VERCEL;
}

export const inngest = new Inngest({
  id: 'foodz',
  isDev: isInngestDevMode(),
  logger,
});

// ------------------------------------------------------------------ events

export const uploadReceived = eventType('upload.received', {
  schema: z.object({ uploadId: z.uuid() }),
});

export const notificationEmailRequested = eventType('notification.email-requested', {
  schema: z.object({ notificationId: z.uuid() }),
});

/** An account email (confirm, reset, ...). The payload is encrypted: it holds an address and a link. */
export const accountEmailRequested = eventType('account.email-requested', {
  schema: z.object({ sealed: z.string().min(1).max(8000) }),
});

// Orders (F4). Payloads carry ids and amounts only; the jobs read everything else themselves.

/** A card order is waiting for its payment until `expiresAt` (B8). */
export const orderPaymentStarted = eventType('order.payment-started', {
  schema: z.object({ orderId: z.uuid(), expiresAt: z.iso.datetime() }).strict(),
});

/** Foodz decided to refund a card payment in full (cancellation, late payment, mismatch). */
export const orderRefundRequested = eventType('order.refund-requested', {
  schema: z.object({ orderId: z.uuid() }).strict(),
});

/** One order email, sent once per change (the event id is the order, the kind and the change). */
export const orderEmailRequested = eventType('order.email-requested', {
  schema: z
    .object({
      orderId: z.uuid(),
      kind: z.enum([
        'receipt',
        'receipt-late',
        'cancelled',
        'refunded',
        'late-refund',
        'mismatch-refund',
      ]),
      refundCents: z.int().min(0).optional(),
      at: z.iso.datetime().optional(),
    })
    .strict(),
});
