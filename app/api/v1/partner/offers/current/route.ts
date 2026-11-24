import { getCurrentOffer } from '@/server/modules/delivery/service';
import { partnerRoute } from '@/server/route';

/** The open offer, if any (F7 P28.6): the phone's 5-second poll and its catch-up on reconnect. */
export const GET = partnerRoute({
  name: 'partner.offers.current',
  rateLimit: 'partner.offer-current',
  handler: ({ actor, sessionId }) => getCurrentOffer(actor, sessionId),
});
