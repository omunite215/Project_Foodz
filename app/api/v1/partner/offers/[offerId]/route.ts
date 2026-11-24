import { getOffer } from '@/server/modules/delivery/service';
import { partnerRoute } from '@/server/route';

/** One open offer of the caller's (F7 P33.1); anything else answers 404. */
export const GET = partnerRoute({
  name: 'partner.offers.detail',
  rateLimit: 'partner.offer-current',
  handler: ({ actor, sessionId, params }) => getOffer(actor, params.offerId ?? '', sessionId),
});
