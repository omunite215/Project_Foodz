import 'server-only';
import { deliverPartnerEmail } from '@/server/modules/partners/service';
import { inngest } from '../client';
import { partnerEmailRequested } from '../partner-events';

/** One partner email per application event (F6 B17); the event id makes a repeat a no-op. */
export const partnerEmail = inngest.createFunction(
  { id: 'send-partner-email', triggers: [partnerEmailRequested], retries: 4 },
  async ({ event, step }) => step.run('send email', () => deliverPartnerEmail(event.data)),
);
