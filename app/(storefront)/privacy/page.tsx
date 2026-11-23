import type { Metadata } from 'next';
import { getLegalPage } from '@/server/modules/content/service';
import { LegalPage } from '@/components/legal/legal-page';
import { LegalUnavailable } from '@/components/legal/legal-unavailable';
import { readOrNull } from '@/lib/storefront-data';

export const metadata: Metadata = { title: 'Privacy Policy' };

/** The published Privacy Policy (S1.8, Decision 10). */
export default async function PrivacyPolicyPage() {
  const page = await readOrNull('privacy page', () => getLegalPage('privacy'));
  return page ? <LegalPage page={page} /> : <LegalUnavailable />;
}
