import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import {
  ApplicationScreens,
  type ScreenNotice,
  SuspendedScreen,
  WelcomeScreen,
} from '@/components/partner/application-screens';
import { ApplyGate } from '@/components/partner/apply-gate';
import { PartnerHome } from '@/components/partner/home/partner-home';
import { getActor } from '@/server/auth/session';
import { getCurrentDeliveryF8 } from '@/server/modules/tracking/service';
import { deliverTitle, pickUpTitle } from '@/lib/partner/offer-text';
import { STORE_TIME_ZONE } from '@/lib/order-text';
import { firstParam } from '@/lib/search-params';
import { loadPartnerState, partnerTitle, requirePartnerState } from './state';

export async function generateMetadata(): Promise<Metadata> {
  const loaded = await loadPartnerState();
  const screen = loaded?.state.screen;
  if (loaded?.state.screen === 'home') {
    // F7: "Pick up order 1042 | Foodz Partner" while he holds an order.
    const held = loaded.state.dispatch.delivery;
    if (!held) return { title: partnerTitle('Home') };
    return {
      title: partnerTitle(
        held.status === 'PICKED_UP'
          ? deliverTitle(held.orderNumber)
          : pickUpTitle(held.orderNumber),
      ),
    };
  }
  if (screen === 'pending' || screen === 'sentBack' || screen === 'rejected') {
    return { title: partnerTitle('Your application') };
  }
  if (screen === 'gate' && loaded?.state.screen === 'gate' && loaded.state.gate === 'staff') {
    return { title: partnerTitle('Apply to deliver') };
  }
  return { title: partnerTitle(null) };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const noticeOf = (value: string | undefined): ScreenNotice =>
  value === 'saved' || value === 'decided' || value === 'sent' ? value : null;

/**
 * `/partner` (F6 design 5, 6): the server picks the screen from the application's state, so
 * nothing renders and then switches (P17.6). Customers without an application, and gates other
 * than staff, go to the form's address.
 */
export default async function PartnerPage({ searchParams }: { searchParams: SearchParams }) {
  const { state, userId } = await requirePartnerState('/partner');
  const notice = noticeOf(firstParam((await searchParams).done));

  switch (state.screen) {
    case 'gate':
      if (state.gate === 'staff') return <ApplyGate state={state} />;
      redirect('/partner/apply');
    case 'apply':
      redirect('/partner/apply');
    case 'pending':
    case 'sentBack':
    case 'rejected':
      return (
        <ApplicationScreens
          state={state}
          userId={userId}
          timeZone={STORE_TIME_ZONE}
          notice={notice}
        />
      );
    case 'welcome':
      return <WelcomeScreen firstName={state.firstName} />;
    case 'suspended':
      return (
        <SuspendedScreen since={state.since} reason={state.reason} timeZone={STORE_TIME_ZONE} />
      );
    default: {
      // F7 P29.5, P17.6: the pick-up or deliver screen is in the first HTML when he holds an
      // order, with F8's stage, route and steps.
      const actor = state.dispatch.delivery ? await getActor() : null;
      const delivery =
        actor?.kind === 'user' ? await getCurrentDeliveryF8(actor).catch(() => null) : null;
      return <PartnerHome state={state} asOf={new Date().toISOString()} delivery={delivery} />;
    }
  }
}
