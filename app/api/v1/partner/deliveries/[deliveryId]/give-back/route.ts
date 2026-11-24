import { giveBack } from '@/server/modules/delivery/service';
import { partnerRoute } from '@/server/route';

/** Give an order back before pickup (F7 P30). */
export const POST = partnerRoute({
  name: 'partner.deliveries.give-back',
  rateLimit: 'partner.give-back',
  handler: ({ actor, params, body }) => giveBack(actor, params.deliveryId ?? '', body),
});
