import type { Metadata } from 'next';
import { getActor } from '@/server/auth/session';
import { getSavedCardsPage } from '@/server/modules/payments/service';
import { AccountPageHead } from '@/components/account/settings-card';
import { SavedCards } from '@/components/cards/saved-cards';

export const metadata: Metadata = { title: 'Saved cards' };

/** The cards saved at Stripe for paying faster (F4 design 5, S6.13, S6.14). */
export default async function SavedCardsPage() {
  const actor = await getActor();
  if (actor.kind !== 'user') return null;
  const page = await getSavedCardsPage(actor);
  return (
    <>
      <AccountPageHead
        title="Saved cards"
        subtitle="We keep only the brand, the last 4 digits and the expiry date. Your full card number stays with our payment provider, Stripe. You can save up to 5."
      />
      <SavedCards page={page} />
    </>
  );
}
