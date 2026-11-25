'use server';

import { userAction } from '@/server/action';
import {
  markWelcomedInput,
  submitApplicationInput,
  updateApplicationInput,
  withdrawApplicationInput,
} from './schema';
import { markWelcomed, submitApplication, updateApplication, withdrawApplication } from './service';

/*
 * The applicant's actions (F6 P5, P6, P7). They name no permission in the wrapper, because
 * staff must hear `NOT_A_CUSTOMER` rather than a bare 403 (P1.6): the service refuses staff,
 * then checks `partner: apply`. `write: true` refuses the shared demo accounts first. Going
 * online and sending locations are REST routes under /api/v1/partner (B3).
 */

const DEMO_CANT_APPLY =
  "The demo account can't apply. Sign in as the demo partner to see the partner app.";

/** "Send application" (P5.4): 5 an hour per account. */
export const submitApplicationAction = userAction
  .metadata({
    name: 'partners.submit',
    rateLimit: 'partner.apply',
    write: true,
    demoMessage: DEMO_CANT_APPLY,
  })
  .inputSchema(submitApplicationInput)
  .action(async ({ parsedInput, ctx }) =>
    submitApplication(ctx.actor, parsedInput, { ip: ctx.request.ip }),
  );

/** "Save changes" while pending or sent back (P6.3, P6.5): 20 an hour. */
export const updateApplicationAction = userAction
  .metadata({
    name: 'partners.update',
    rateLimit: 'partner.application-edit',
    write: true,
    demoMessage: DEMO_CANT_APPLY,
  })
  .inputSchema(updateApplicationInput)
  .action(async ({ parsedInput, ctx }) => updateApplication(ctx.actor, parsedInput));

/** "Withdraw application" (P6.4). */
export const withdrawApplicationAction = userAction
  .metadata({
    name: 'partners.withdraw',
    rateLimit: 'partner.withdraw',
    write: true,
    demoMessage: DEMO_CANT_APPLY,
  })
  .inputSchema(withdrawApplicationInput)
  .action(async ({ ctx }) => withdrawApplication(ctx.actor));

/** "Go to the app" on the welcome (P7.2): approved partners only. */
export const markWelcomedAction = userAction
  .metadata({
    name: 'partners.welcomed',
    rateLimit: 'action.default',
    permission: { partner: ['deliver'] },
  })
  .inputSchema(markWelcomedInput)
  .action(async ({ ctx }) => markWelcomed(ctx.actor));
