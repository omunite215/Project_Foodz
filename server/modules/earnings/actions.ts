'use server';

import { userAction } from '@/server/action';
import {
  adjustEarningsInput,
  earningsReportInput,
  openMoneyDialogInput,
  partnerEarningsInput,
  recordCashInput,
  recordPayoutInput,
} from './schema';
import {
  adjustEarnings,
  getEarningsReport,
  getPartnerEarnings,
  openMoneyDialog,
  recordCashHandIn,
  recordPayout,
} from './service';

/*
 * Staff earnings actions (contract §2, §5). Each names its permission, so the wrapper refuses
 * customers, partners, KITCHEN and CONTENT_EDITOR (403), staff without two-factor and, for the
 * money actions, the demo admin (DEMO_READ_ONLY) before anything else runs. The service checks
 * again and asks for step-up on adjustments and payouts.
 */

const DEMO_READ_ONLY = 'Read-only in the demo';

/** The partner page's Earnings section (A59). */
export const partnerEarningsAction = userAction
  .metadata({
    name: 'earnings.partner',
    rateLimit: 'earnings.staff-read',
    permission: { earnings: ['read'] },
    write: false,
  })
  .inputSchema(partnerEarningsInput)
  .action(async ({ parsedInput, ctx }) => getPartnerEarnings(ctx.actor, parsedInput));

/** A67.2: a money dialog's key, version and limits as it opens. */
export const openMoneyDialogAction = userAction
  .metadata({
    name: 'earnings.dialog',
    rateLimit: 'earnings.staff-read',
    permission: { earnings: ['read'] },
    write: false,
  })
  .inputSchema(openMoneyDialogInput)
  .action(async ({ parsedInput, ctx }) => openMoneyDialog(ctx.actor, parsedInput));

/** A60: cash handed in at the counter. */
export const recordCashHandInAction = userAction
  .metadata({
    name: 'earnings.record-cash',
    rateLimit: 'earnings.cash-record',
    permission: { earnings: ['record-cash'] },
    demoMessage: DEMO_READ_ONLY,
  })
  .inputSchema(recordCashInput)
  .action(async ({ parsedInput, ctx }) => recordCashHandIn(ctx.actor, parsedInput));

/** A61: a bonus or an adjustment, with step-up. */
export const adjustEarningsAction = userAction
  .metadata({
    name: 'earnings.adjust',
    rateLimit: 'earnings.adjust',
    permission: { earnings: ['adjust'] },
    demoMessage: DEMO_READ_ONLY,
  })
  .inputSchema(adjustEarningsInput)
  .action(async ({ parsedInput, ctx }) => adjustEarnings(ctx.actor, parsedInput));

/** A62: a payout made outside Foodz, with step-up. */
export const recordPayoutAction = userAction
  .metadata({
    name: 'earnings.payout',
    rateLimit: 'earnings.payout',
    permission: { earnings: ['payout'] },
    demoMessage: DEMO_READ_ONLY,
  })
  .inputSchema(recordPayoutInput)
  .action(async ({ parsedInput, ctx }) => recordPayout(ctx.actor, parsedInput));

/** A63: the payouts report, ADMIN only (the demo admin reads demo partners). */
export const earningsReportAction = userAction
  .metadata({
    name: 'earnings.report',
    rateLimit: 'earnings.staff-read',
    permission: { earnings: ['report'] },
    write: false,
  })
  .inputSchema(earningsReportInput)
  .action(async ({ parsedInput, ctx }) => getEarningsReport(ctx.actor, parsedInput));
