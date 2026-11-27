import { getMyRatingsSummary } from '@/server/modules/ratings/service';
import { partnerRoute } from '@/server/route';

/** F9 P58: his average up to the end of yesterday and tag counts; never one rating. */
export const GET = partnerRoute({
  name: 'partner.ratings-summary',
  rateLimit: 'earnings.read',
  handler: ({ actor }) => getMyRatingsSummary(actor),
});
