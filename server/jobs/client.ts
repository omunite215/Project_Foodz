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
