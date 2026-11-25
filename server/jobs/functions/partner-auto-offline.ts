import 'server-only';
import { sweepIdlePartners } from '@/server/modules/partners/service';
import { inngest } from '../client';

/** B8: every minute, partners with no location for 10 minutes, or idle after closing, go offline. */
export const partnerAutoOffline = inngest.createFunction(
  { id: 'partner-auto-offline', triggers: [{ cron: '* * * * *' }], retries: 1 },
  async ({ step }) => step.run('take idle partners offline', () => sweepIdlePartners()),
);
