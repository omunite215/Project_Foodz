import 'server-only';
import { expireUnpaidOrder } from '@/server/modules/orders/payment-sync';
import { inngest, orderPaymentStarted } from '../client';

/**
 * B8: sleeps until a card order's payment time is up, then cancels it (and its payment at
 * Stripe) if it is still unpaid. A payment Stripe already took places the order instead.
 */
export const orderExpiry = inngest.createFunction(
  { id: 'expire-unpaid-order', triggers: [orderPaymentStarted], retries: 6 },
  async ({ event, step }) => {
    await step.sleepUntil('wait for the payment', event.data.expiresAt);
    return step.run('expire if unpaid', () => expireUnpaidOrder(event.data.orderId));
  },
);
