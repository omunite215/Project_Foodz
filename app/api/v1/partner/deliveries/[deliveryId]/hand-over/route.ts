import { enforceRateLimit } from '@/server/security/rate-limit';
import { handOver } from '@/server/modules/tracking/service';
import { partnerRoute } from '@/server/route';

/** The delivery code (F8 P41, P42): `delivery.otp` stays the outer fence (L6.3). */
export const POST = partnerRoute({
  name: 'partner.deliveries.hand-over',
  rateLimit: 'partner.delivery-step',
  handler: async ({ actor, params, body }) => {
    await enforceRateLimit('delivery.otp', `user:${actor.userId}`);
    return handOver(actor, params.deliveryId ?? '', body);
  },
});
