import type { Metadata } from 'next';
import { getLegalPage } from '@/server/modules/content/service';
import { TermsPage } from '@/components/partner/terms-page';
import { STORE_TIME_ZONE } from '@/lib/order-text';
import { readOrNull } from '@/lib/storefront-data';
import { partnerTitle } from '../state';

export const metadata: Metadata = { title: partnerTitle('Partner Terms') };

/** The Partner Terms (F6 design 4.8, U6): public, `noindex`, the plain header. */
export default async function PartnerTermsPage() {
  const terms = await readOrNull('partner terms', () => getLegalPage('partner-terms'));
  return <TermsPage terms={terms} timeZone={STORE_TIME_ZONE} />;
}
