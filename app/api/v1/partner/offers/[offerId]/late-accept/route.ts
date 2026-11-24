import { recordLateAccept } from '@/server/modules/delivery/service';
import { partnerRoute } from '@/server/route';

/** Accept pressed in time but sent too late (F7 P28.2): recorded, never assigns. */
export const POST = partnerRoute({
  name: 'partner.offers.late-accept',
  rateLimit: 'partner.offer-answer',
  handler: ({ actor, params, body }) => recordLateAccept(actor, params.offerId ?? '', body),
});
