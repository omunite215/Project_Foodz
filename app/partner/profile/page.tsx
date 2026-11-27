import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ProfileScreen } from '@/components/partner/profile-screen';
import { partnerTitle, requirePartnerState } from '../state';

export const metadata: Metadata = { title: partnerTitle('Profile') };

/** `/partner/profile` (F6 design 6.7): approved partners only; everyone else sees `/partner`. */
export default async function PartnerProfilePage() {
  const { state, userId } = await requirePartnerState('/partner/profile');
  if (state.screen !== 'home') redirect('/partner');
  return <ProfileScreen state={state} userId={userId} asOf={new Date().toISOString()} />;
}
