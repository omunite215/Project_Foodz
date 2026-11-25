import { reportProblem } from '@/server/modules/tracking/service';
import { partnerRoute } from '@/server/route';

/** A problem at the door (F8 P43). */
export const POST = partnerRoute({
  name: 'partner.deliveries.problem',
  rateLimit: 'partner.problem',
  handler: ({ actor, params, body }) => reportProblem(actor, params.deliveryId ?? '', body),
});
