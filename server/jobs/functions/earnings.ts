import 'server-only';
import { DEMO_RESET_CRON, reconcileCron } from '@/server/modules/earnings/rules';
import { reconcileEarnings, resetDemoEarnings } from '@/server/modules/earnings/service';
import { ratingTimings } from '@/server/modules/ratings/rules';
import { sendRatingReminder } from '@/server/modules/ratings/service';
import { inngest } from '../client';
import { orderDelivered, ratingSettled } from '../earnings-events';

/*
 * F9's three functions (contract §12). The reminder's 60 minutes are a durable sleep, so a
 * restart never loses or repeats it (V6); the send itself claims the order, so it goes at most
 * once whatever the job does.
 */

export const ratingReminder = inngest.createFunction(
  {
    id: 'rating-reminder',
    triggers: [orderDelivered],
    idempotency: 'event.data.orderId',
    cancelOn: [{ event: ratingSettled, match: 'data.orderId' }],
    retries: 3,
  },
  async ({ event, step }) => {
    const { reminderMinutes } = ratingTimings(process.env);
    await step.sleepUntil(
      'wait-after-delivery',
      new Date(Date.parse(event.data.deliveredAt) + reminderMinutes * 60_000),
    );
    return step.run('remind', () => sendRatingReminder(event.data.orderId));
  },
);

export const earningsReconcile = inngest.createFunction(
  { id: 'earnings-reconcile', triggers: [{ cron: reconcileCron(process.env) }], retries: 1 },
  async ({ step }) => step.run('reconcile', () => reconcileEarnings()),
);

export const demoNightlyReset = inngest.createFunction(
  { id: 'demo-nightly-reset', triggers: [{ cron: DEMO_RESET_CRON }], retries: 1 },
  async ({ step }) => step.run('reset demo earnings and ratings', () => resetDemoEarnings()),
);
