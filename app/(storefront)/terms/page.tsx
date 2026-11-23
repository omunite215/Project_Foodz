import type { Metadata } from 'next';
import { getLegalPage } from '@/server/modules/content/service';
import { LegalPage } from '@/components/legal/legal-page';
import { LegalUnavailable } from '@/components/legal/legal-unavailable';
import { readOrNull } from '@/lib/storefront-data';

export const metadata: Metadata = { title: 'Terms and Conditions' };

/** The published Terms (S1.8, Decision 10). */
export default async function TermsPage() {
  const page = await readOrNull('terms page', () => getLegalPage('terms'));
  return page ? <LegalPage page={page} /> : <LegalUnavailable />;
}
