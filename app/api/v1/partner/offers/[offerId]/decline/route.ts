import { declineOffer } from '@/server/modules/delivery/service';
import { partnerRoute } from '@/server/route';

/** Decline (F7 P23): no reason asked. */
export const POST = partnerRoute({
  name: 'partner.offers.decline',
  rateLimit: 'partner.offer-answer',
  handler: ({ actor, sessionId, params, body }) =>
    declineOffer(actor, params.offerId ?? '', body, sessionId),
});
