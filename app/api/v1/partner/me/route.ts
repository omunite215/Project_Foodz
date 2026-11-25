import { getMyPartnerState } from '@/server/modules/partners/service';
import { partnerRoute } from '@/server/route';

/** The partner's state for refetches after events and on returning to the app (F6 B3). */
export const GET = partnerRoute({
  name: 'partner.me',
  rateLimit: 'partner.me',
  handler: ({ actor, sessionId }) => getMyPartnerState(actor, { sessionId }),
});
