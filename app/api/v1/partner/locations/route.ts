import { recordLocations } from '@/server/modules/partners/service';
import { partnerRoute } from '@/server/route';

/** Up to 50 points from the device that went online (F6 P10.3, P11.2, P16): one request every 2 s. */
export const POST = partnerRoute({
  name: 'partner.locations',
  rateLimit: 'partner.location',
  handler: ({ actor, sessionId, body }) => recordLocations(actor, sessionId, body),
});
