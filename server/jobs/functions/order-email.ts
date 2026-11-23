import 'server-only';
import { deliverOrderEmail } from '@/server/modules/orders/effects';
import { inngest, orderEmailRequested } from '../client';

/** One order email (receipt, cancellation, refund), sent once per change (B17). */
export const orderEmail = inngest.createFunction(
  { id: 'send-order-email', triggers: [orderEmailRequested], retries: 4 },
  async ({ event, step }) => step.run('send email', () => deliverOrderEmail(event.data)),
);
