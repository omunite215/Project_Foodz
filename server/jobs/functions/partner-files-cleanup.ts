import 'server-only';
import { deleteExpiredPartnerFiles } from '@/server/modules/partners/service';
import { inngest } from '../client';

/** P7.8, P15.6: daily, rejected applicants' files on their reapply date, unsent uploads after a day. */
export const partnerFilesCleanup = inngest.createFunction(
  {
    id: 'partner-files-cleanup',
    triggers: [{ cron: 'TZ=America/New_York 30 3 * * *' }],
    retries: 2,
  },
  async ({ step }) => step.run('delete expired partner files', () => deleteExpiredPartnerFiles()),
);
