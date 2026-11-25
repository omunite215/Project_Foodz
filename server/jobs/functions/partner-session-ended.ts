import 'server-only';
import { partnerSignedOut } from '@/server/modules/partners/service';
import { inngest } from '../client';
import { partnerSessionEnded } from '../partner-events';

/** B9: signing out of the session that shares the location takes the partner offline. */
export const partnerSessionEndedJob = inngest.createFunction(
  { id: 'partner-session-ended', triggers: [partnerSessionEnded], retries: 2 },
  async ({ event, step }) =>
    step.run('go offline', () => partnerSignedOut(event.data.userId, event.data.sessionId)),
);
