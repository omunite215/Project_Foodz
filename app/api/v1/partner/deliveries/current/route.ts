import { getCurrentDelivery } from '@/server/modules/delivery/service';
import { partnerRoute } from '@/server/route';

/** The order the caller holds, or null (F7 P29). */
export const GET = partnerRoute({
  name: 'partner.deliveries.current',
  rateLimit: 'partner.offer-current',
  handler: ({ actor }) => getCurrentDelivery(actor),
});
