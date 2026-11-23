import 'server-only';
import { sweepUnpaidOrders } from '@/server/modules/orders/payment-sync';
import { inngest } from '../client';

/** B8: every 5 minutes, expires unpaid orders whose own expiry job was lost. */
export const orderSweep = inngest.createFunction(
  { id: 'sweep-unpaid-orders', triggers: [{ cron: '*/5 * * * *' }], retries: 1 },
  async ({ step }) => step.run('expire overdue orders', () => sweepUnpaidOrders()),
);
