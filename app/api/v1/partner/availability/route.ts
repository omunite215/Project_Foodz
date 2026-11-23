import { setAvailability } from '@/server/modules/partners/service';
import { partnerRoute } from '@/server/route';

/** Go online with the first point, or offline (F6 P9.9, P12.1). 30 changes in 10 minutes. */
export const PUT = partnerRoute({
  name: 'partner.availability',
  rateLimit: 'partner.availability',
  handler: ({ actor, sessionId, body }) => setAvailability(actor, sessionId, body),
});
