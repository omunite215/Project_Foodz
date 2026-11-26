import { pickUp } from '@/server/modules/tracking/service';
import { partnerRoute } from '@/server/route';

/** "Picked up" (F8 P38): the order is on its way and the delivery code is made. */
export const POST = partnerRoute({
  name: 'partner.deliveries.picked-up',
  rateLimit: 'partner.delivery-step',
  handler: ({ actor, params, body }) => pickUp(actor, params.deliveryId ?? '', body),
});
