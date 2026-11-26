import { getCurrentDeliveryF8 } from '@/server/modules/tracking/service';
import { partnerRoute } from '@/server/route';

/** The order the caller holds with its stage, route and steps, or null (F7 P29, F8 B3). */
export const GET = partnerRoute({
  name: 'partner.deliveries.current',
  rateLimit: 'partner.offer-current',
  handler: ({ actor }) => getCurrentDeliveryF8(actor),
});
