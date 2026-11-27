import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { RatingsScreen } from '@/components/partner/earnings/ratings-screen';
import { getActor } from '@/server/auth/session';
import { getStoreStatus } from '@/server/modules/menu/service';
import { getMyRatingsSummary } from '@/server/modules/ratings/service';
import { partnerTitle, requirePartnerState } from '../../state';

export const metadata: Metadata = { title: partnerTitle('Your ratings') };

/**
 * `/partner/profile/ratings` (F9 design 1.12): approved partners and the demo partner; everyone
 * else sees `/partner`. The published summary comes in the first HTML.
 */
export default async function PartnerRatingsPage() {
  const { state, userId } = await requirePartnerState('/partner/profile/ratings');
  if (state.screen !== 'home') redirect('/partner');
  const actor = await getActor();
  if (actor.kind !== 'user') redirect('/partner');
  const [summary, phone] = await Promise.all([
    getMyRatingsSummary(actor).catch(() => null),
    getStoreStatus()
      .then((status) => status.store.phone)
      .catch(() => null),
  ]);
  return (
    <RatingsScreen
      state={state}
      userId={userId}
      asOf={new Date().toISOString()}
      summary={summary}
      kitchenPhone={phone}
    />
  );
}
