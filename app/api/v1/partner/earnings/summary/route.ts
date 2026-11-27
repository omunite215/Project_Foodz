import { getEarningsSummary } from '@/server/modules/earnings/service';
import { partnerRoute } from '@/server/route';

/** F9 P52–P56: today, this week and the cash card, for the Earnings tab. */
export const GET = partnerRoute({
  name: 'partner.earnings-summary',
  rateLimit: 'earnings.read',
  handler: ({ actor }) => getEarningsSummary(actor),
});
