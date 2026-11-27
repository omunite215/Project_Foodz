import { getEarningsDelivery } from '@/server/modules/earnings/service';
import { partnerRoute } from '@/server/route';

/** F9 P55.2: one paid delivery's steps and pay; 404 for anything he wasn't paid for. */
export const GET = partnerRoute({
  name: 'partner.earnings-delivery',
  rateLimit: 'earnings.read',
  handler: ({ actor, params }) => getEarningsDelivery(actor, params),
});
