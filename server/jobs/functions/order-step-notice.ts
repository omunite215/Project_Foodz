import 'server-only';
import { sendOrderStepNotice } from '@/server/modules/orders/notices';
import { orderStepNoticeRequested } from '../board-events';
import { inngest } from '../client';

/**
 * F5 S6.1 to S6.3: the customer's Accepted or Ready notice, once the board's undo window and
 * its grace have passed. Sent with the event id `order-step-notice-<eventId>`, so a repeated
 * request runs once; the order's `notified_steps` claim makes the notice once per order and step
 * however often the step is redone. An undone, overtaken or cancelled step sends nothing.
 */
export const orderStepNotice = inngest.createFunction(
  { id: 'send-order-step-notice', triggers: [orderStepNoticeRequested], retries: 3 },
  async ({ event, step }) => {
    await step.sleepUntil('wait out the undo window', event.data.dueAt);
    return step.run('notify unless undone', () =>
      sendOrderStepNotice({
        orderId: event.data.orderId,
        step: event.data.step,
        eventId: event.data.eventId,
      }),
    );
  },
);
