import 'server-only';
import { processAutoRefund } from '@/server/modules/orders/payment-sync';
import { inngest, orderRefundRequested } from '../client';

/**
 * Refunds a card payment Foodz decided to give back (a cancellation, a late payment, a payment
 * that didn't match its order). Stripe's idempotency key makes a retry refund once.
 */
export const orderRefund = inngest.createFunction(
  { id: 'refund-order', triggers: [orderRefundRequested], retries: 6 },
  async ({ event, step }) => step.run('refund', () => processAutoRefund(event.data.orderId)),
);
