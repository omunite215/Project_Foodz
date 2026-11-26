import { sendPracticeOffer } from '@/server/modules/delivery/service';
import { partnerRoute } from '@/server/route';

/** A practice offer for the demo partner (F7 P34); never a real order. */
export const POST = partnerRoute({
  name: 'partner.practice-offers',
  rateLimit: 'partner.practice-offer',
  rateLimitBy: 'session',
  handler: ({ actor, sessionId }) => sendPracticeOffer(actor, sessionId),
});
