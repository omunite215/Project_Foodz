import 'server-only';
import { deliverAccountEmail } from '@/server/modules/notifications/account-email';
import { accountEmailRequested, inngest } from '../client';

export const accountEmail = inngest.createFunction(
  { id: 'send-account-email', triggers: [accountEmailRequested], retries: 4 },
  async ({ event, step }) => step.run('send email', () => deliverAccountEmail(event.data.sealed)),
);
