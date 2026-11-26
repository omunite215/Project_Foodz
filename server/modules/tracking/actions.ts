'use server';

import { userAction } from '@/server/action';
import {
  askToWaitInput,
  cancelUnreachableInput,
  confirmHandoverInput,
  startDemoDeliveryInput,
} from './schema';
import {
  askToWait,
  cancelUnreachable,
  confirmHandover,
  getOpsMap,
  startDemoDelivery,
} from './service';

/*
 * F8's staff actions (contract §5). The wrapper checks the session, the permission, two-factor
 * for staff, the demo rule and the rate limit; the services check again and audit in the same
 * transaction.
 */

const DEMO_CANNOT = 'Read-only in the demo';
const CONFIRM = { delivery: ['confirm-handover'] } as const;

export const opsMapAction = userAction
  .metadata({
    name: 'tracking.opsMap',
    rateLimit: 'tracking.map',
    permission: { delivery: ['track-any'] },
    write: false,
  })
  .action(async ({ ctx }) => getOpsMap(ctx.actor));

export const confirmHandoverAction = userAction
  .metadata({
    name: 'tracking.confirmHandover',
    rateLimit: 'tracking.confirm',
    permission: CONFIRM,
    demoMessage: DEMO_CANNOT,
  })
  .inputSchema(confirmHandoverInput)
  .action(async ({ parsedInput, ctx }) => confirmHandover(ctx.actor, parsedInput));

export const askToWaitAction = userAction
  .metadata({
    name: 'tracking.askToWait',
    rateLimit: 'tracking.confirm',
    permission: CONFIRM,
    demoMessage: DEMO_CANNOT,
  })
  .inputSchema(askToWaitInput)
  .action(async ({ parsedInput, ctx }) => askToWait(ctx.actor, parsedInput));

export const cancelUnreachableAction = userAction
  .metadata({
    name: 'tracking.cancelUnreachable',
    rateLimit: 'tracking.confirm',
    permission: CONFIRM,
    demoMessage: DEMO_CANNOT,
  })
  .inputSchema(cancelUnreachableInput)
  .action(async ({ parsedInput, ctx }) => cancelUnreachable(ctx.actor, parsedInput));

/** The demo admin's "Run a demo delivery": allowed for demo accounts only (the service checks). */
export const startDemoDeliveryAction = userAction
  .metadata({
    name: 'tracking.demoRun',
    rateLimit: 'tracking.demo-run',
    permission: { delivery: ['track-any'] },
    write: false,
  })
  .inputSchema(startDemoDeliveryInput)
  .action(async ({ ctx }) => startDemoDelivery(ctx.actor));
