import { checkCode } from '@/server/modules/tracking/service';
import { withCodeFence } from '@/server/modules/tracking/code-fence';
import { partnerRoute } from '@/server/route';

/**
 * The delivery code (F8 P41, P42): `delivery.otp` stays the outer fence (L6.3), fail-closed,
 * and keeps a point only for a wrong try (gate S9).
 */
export const POST = partnerRoute({
  name: 'partner.deliveries.hand-over',
  rateLimit: 'partner.delivery-step',
  handler: ({ actor, params, body }) =>
    withCodeFence(actor.userId, () => checkCode(actor, params.deliveryId ?? '', body)),
});
