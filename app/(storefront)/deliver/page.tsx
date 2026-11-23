import type { Metadata } from 'next';
import { getActor } from '@/server/auth/session';
import { getMyPartnerState } from '@/server/modules/partners/service';
import { DeliverLanding, type DeliverVisitor } from '@/components/partner/deliver-landing';
import { readOrNull } from '@/lib/storefront-data';

export const metadata: Metadata = {
  title: 'Deliver with Foodz',
  description: 'Go online when it suits you, from our kitchen at 88 Harbor Street, Boston.',
};

/** Who is visiting, for the call to action (F6 design 1.3). */
async function visitor(): Promise<DeliverVisitor> {
  const actor = await getActor();
  if (actor.kind !== 'user') return 'guest';
  const state = await readOrNull('partner state', () => getMyPartnerState(actor));
  switch (state?.screen) {
    case 'gate':
      if (state.gate === 'staff') return 'staff';
      return state.gate === 'demoCustomer' ? 'demoCustomer' : 'unconfirmed';
    case 'pending':
    case 'sentBack':
    case 'rejected':
      return 'applicant';
    case 'welcome':
    case 'home':
    case 'suspended':
      return 'partner';
    default:
      return 'customer';
  }
}

/**
 * `/deliver` (F6 design 1.2): the storefront's landing for delivery partners, indexable, light
 * only. It promises no pay figures (P1.2) and never says whether someone was rejected or
 * suspended; that's on `/partner`.
 */
export default async function DeliverPage() {
  return <DeliverLanding visitor={await visitor()} />;
}
