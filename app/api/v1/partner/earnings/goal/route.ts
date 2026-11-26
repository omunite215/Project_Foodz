import { setEarningsGoal } from '@/server/modules/earnings/service';
import { partnerRoute } from '@/server/route';

/** F9 P53: the partner's own daily goal, `{ cents: number | null }`. */
export const PUT = partnerRoute({
  name: 'partner.earnings-goal',
  rateLimit: 'earnings.goal',
  handler: ({ actor, body }) => setEarningsGoal(actor, body),
});
