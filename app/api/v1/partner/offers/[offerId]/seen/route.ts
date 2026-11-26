import { markOfferSeen } from '@/server/modules/delivery/service';
import { partnerRoute } from '@/server/route';

/** The offer card is on screen (F7 W7.4). */
export const POST = partnerRoute({
  name: 'partner.offers.seen',
  rateLimit: 'partner.offer-answer',
  handler: ({ actor, sessionId, params }) => markOfferSeen(actor, params.offerId ?? '', sessionId),
});
