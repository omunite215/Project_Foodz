import { reportNoAnswer } from '@/server/modules/tracking/service';
import { partnerRoute } from '@/server/route';

/** "Tell Foodz nobody answered" once the 5-minute wait is up (F8 P43.3). */
export const POST = partnerRoute({
  name: 'partner.deliveries.no-answer-report',
  rateLimit: 'partner.delivery-step',
  handler: ({ actor, params }) => reportNoAnswer(actor, params.deliveryId ?? ''),
});
