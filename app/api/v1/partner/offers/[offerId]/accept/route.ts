import { acceptOffer } from '@/server/modules/delivery/service';
import { partnerRoute } from '@/server/route';

/** Accept (F7 P22, W6): atomic in the database; a repeat answers the same. */
export const POST = partnerRoute({
  name: 'partner.offers.accept',
  rateLimit: 'partner.offer-answer',
  handler: ({ actor, sessionId, params }) => acceptOffer(actor, params.offerId ?? '', sessionId),
});
