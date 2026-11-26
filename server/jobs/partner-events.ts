import 'server-only';
import { eventType } from 'inngest';
import { z } from 'zod';

/*
 * Domain events of partner applications and availability (F6). Payloads carry ids, kinds and
 * instants only: never a name, a reason's text, a position or the ID number. Each job reads
 * what it needs itself.
 */

const instant = z.iso.datetime();

/**
 * One partner email (B17, design 11), sent once per application event: the event id is
 * `partner-email-<eventId>`, so a retried caller sends nothing new. The job reads the reviewer's
 * text from the history row, never from this payload.
 */
export const partnerEmailRequested = eventType('partner.email-requested', {
  schema: z
    .object({
      partnerId: z.uuid(),
      /** The `partner_application_events` row the email reports. */
      eventId: z.uuid(),
      kind: z.enum([
        'received',
        'sent-back',
        'approved',
        'rejected',
        'reopened',
        'suspended',
        'reinstated',
      ]),
    })
    .strict(),
});

/** Approved: F7 may offer orders once the partner goes online. Nothing listens in F6. */
export const partnerApproved = eventType('partner.approved', {
  schema: z.object({ partnerId: z.uuid(), at: instant }).strict(),
});

/** Suspended: F7 withdraws open offers; F8 decides what happens to a delivery in progress. */
export const partnerSuspended = eventType('partner.suspended', {
  schema: z.object({ partnerId: z.uuid(), wasOnline: z.boolean(), at: instant }).strict(),
});

/** Went online (B22): F7 may start offering. Nothing listens in F6. */
export const partnerWentOnline = eventType('partner.went-online', {
  schema: z.object({ partnerId: z.uuid(), at: instant }).strict(),
});

/** Went offline for any reason (B11): F7 withdraws open offers. Nothing listens in F6. */
export const partnerWentOffline = eventType('partner.went-offline', {
  schema: z
    .object({
      partnerId: z.uuid(),
      reason: z.enum([
        'self',
        'no-location',
        'kitchen-closed',
        'other-device',
        'suspended',
        'signed-out',
        'demo-other-visitor',
        'missed-offers',
      ]),
      at: instant,
    })
    .strict(),
});

/** A session ended (sign-out): if it was sharing a location, the partner goes offline (B9). */
export const partnerSessionEnded = eventType('partner.session-ended', {
  schema: z.object({ userId: z.uuid(), sessionId: z.uuid() }).strict(),
});
