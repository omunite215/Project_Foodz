'use server';

import { userAction } from '@/server/action';
import { AppError } from '@/server/errors';
import {
  approveInput,
  badgeInput,
  documentLinkInput,
  partnerIdInput,
  partnerListInput,
  reinstateInput,
  rejectInput,
  reopenInput,
  sendBackInput,
  suspendInput,
} from './review-schema';
import {
  approvePartner,
  countToReview,
  getDocumentLink,
  getPartnerReview,
  getPartnerVersion,
  listPartnerApplications,
  reinstatePartner,
  rejectPartner,
  reopenPartner,
  sendBackPartner,
  suspendPartner,
} from './review-service';

/*
 * Staff review of partner applications (F6). Each action names its permission, so the wrapper
 * refuses customers, partners, KITCHEN and CONTENT_EDITOR (403), staff without two-factor
 * (TWO_FACTOR_REQUIRED) and, for decisions, the demo admin (DEMO_READ_ONLY) before anything
 * else runs. The service checks again.
 */

const READ = { partner: ['review-application'] } as const;
const DEMO_CANNOT_DECIDE = 'Read-only in the demo';

// ------------------------------------------------------------------ reads (demo admin allowed)

/** The Partners list (A19): server-side tabs, search, filters, sort and pages. */
export const partnerListAction = userAction
  .metadata({
    name: 'partners.list',
    rateLimit: 'partner.review-read',
    permission: READ,
    write: false,
  })
  .inputSchema(partnerListInput)
  .action(async ({ parsedInput, ctx }) => listPartnerApplications(ctx.actor, parsedInput));

/** The sidebar badge (A18.1), every 60 seconds. */
export const partnerBadgeAction = userAction
  .metadata({
    name: 'partners.badge',
    rateLimit: 'partner.review-read',
    permission: READ,
    write: false,
  })
  .inputSchema(badgeInput)
  .action(async ({ ctx }) => countToReview(ctx.actor));

/** One application's page data, for the 30-second refresh (A20.10). */
export const partnerReviewAction = userAction
  .metadata({
    name: 'partners.review',
    rateLimit: 'partner.review-read',
    permission: READ,
    write: false,
  })
  .inputSchema(partnerIdInput)
  .action(async ({ parsedInput, ctx }) => {
    const review = await getPartnerReview(ctx.actor, parsedInput.partnerId);
    if (!review) throw new AppError('NOT_FOUND', 'Application not found.', 404);
    return review;
  });

/** A26.5: the dialog asks for the current version as it opens. */
export const partnerVersionAction = userAction
  .metadata({
    name: 'partners.version',
    rateLimit: 'partner.review-read',
    permission: READ,
    write: false,
  })
  .inputSchema(partnerIdInput)
  .action(async ({ parsedInput, ctx }) => getPartnerVersion(ctx.actor, parsedInput));

/** A21.4: a fresh 5-minute link; 60 a minute; ID images audited. */
export const partnerDocumentLinkAction = userAction
  .metadata({
    name: 'partners.documentLink',
    rateLimit: 'partner.document-link',
    permission: READ,
    write: false,
  })
  .inputSchema(documentLinkInput)
  .action(async ({ parsedInput, ctx }) => getDocumentLink(ctx.actor, parsedInput));

// ------------------------------------------------------------------ decisions

/** A23: SUPPORT, ADMIN; a code when the last check is over 10 minutes old (A27). */
export const approvePartnerAction = userAction
  .metadata({
    name: 'partners.approve',
    rateLimit: 'partner.decide',
    permission: READ,
    demoMessage: DEMO_CANNOT_DECIDE,
  })
  .inputSchema(approveInput)
  .action(async ({ parsedInput, ctx }) => approvePartner(ctx.actor, parsedInput));

/** A24.2: SUPPORT, ADMIN; no code. */
export const sendBackPartnerAction = userAction
  .metadata({
    name: 'partners.sendBack',
    rateLimit: 'partner.decide',
    permission: READ,
    demoMessage: DEMO_CANNOT_DECIDE,
  })
  .inputSchema(sendBackInput)
  .action(async ({ parsedInput, ctx }) => sendBackPartner(ctx.actor, parsedInput));

/** A24.6: SUPPORT, ADMIN; no code. */
export const rejectPartnerAction = userAction
  .metadata({
    name: 'partners.reject',
    rateLimit: 'partner.decide',
    permission: READ,
    demoMessage: DEMO_CANNOT_DECIDE,
  })
  .inputSchema(rejectInput)
  .action(async ({ parsedInput, ctx }) => rejectPartner(ctx.actor, parsedInput));

/** A25: SUPPORT, ADMIN; a code when stale; 20 an hour (alert at the 6th). */
export const suspendPartnerAction = userAction
  .metadata({
    name: 'partners.suspend',
    rateLimit: 'partner.suspend',
    permission: { partner: ['suspend'] },
    demoMessage: DEMO_CANNOT_DECIDE,
  })
  .inputSchema(suspendInput)
  .action(async ({ parsedInput, ctx }) => suspendPartner(ctx.actor, parsedInput));

/** A25.3: ADMIN only; a code when stale. */
export const reinstatePartnerAction = userAction
  .metadata({
    name: 'partners.reinstate',
    rateLimit: 'partner.reinstate',
    permission: { partner: ['reinstate'] },
    demoMessage: DEMO_CANNOT_DECIDE,
  })
  .inputSchema(reinstateInput)
  .action(async ({ parsedInput, ctx }) => reinstatePartner(ctx.actor, parsedInput));

/** A28: ADMIN only, while the files exist; no code. */
export const reopenPartnerAction = userAction
  .metadata({
    name: 'partners.reopen',
    rateLimit: 'partner.decide',
    permission: { partner: ['reinstate'] },
    demoMessage: DEMO_CANNOT_DECIDE,
  })
  .inputSchema(reopenInput)
  .action(async ({ parsedInput, ctx }) => reopenPartner(ctx.actor, parsedInput));
