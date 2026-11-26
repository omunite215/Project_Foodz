import { getEarningsWeek } from '@/server/modules/earnings/service';
import { partnerRoute } from '@/server/route';

/** F9 P54–P55: one week's bars and rows (`?weekStart=2026-11-16`). */
export const GET = partnerRoute({
  name: 'partner.earnings-entries',
  rateLimit: 'earnings.read',
  handler: ({ actor, query }) => getEarningsWeek(actor, query),
});
