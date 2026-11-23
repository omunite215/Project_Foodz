import 'server-only';
import { sweepAutoRefunds } from '@/server/modules/orders/payment-sync';
import { inngest } from '../client';

/** Every 5 minutes, makes the automatic refunds whose own refund job was lost or failed. */
export const orderRefundSweep = inngest.createFunction(
  { id: 'sweep-auto-refunds', triggers: [{ cron: '*/5 * * * *' }], retries: 1 },
  async ({ step }) => step.run('refund what was decided', () => sweepAutoRefunds()),
);
