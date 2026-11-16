import 'server-only';
import { sendNotificationEmail } from '@/server/modules/notifications/service';
import { inngest, notificationEmailRequested } from '../client';

export const notificationEmail = inngest.createFunction(
  { id: 'send-notification-email', triggers: [notificationEmailRequested], retries: 4 },
  async ({ event, step }) =>
    step.run('send email', () => sendNotificationEmail(event.data.notificationId)),
);
