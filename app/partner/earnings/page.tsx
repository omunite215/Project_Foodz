import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import {
  EarningsScreen,
  type EarningsView,
  SuspendedEarnings,
} from '@/components/partner/earnings/earnings-screen';
import { getActor } from '@/server/auth/session';
import type { EarningsSummary } from '@/server/modules/earnings/schema';
import { getEarningsSummary } from '@/server/modules/earnings/service';
import { firstParam } from '@/lib/search-params';
import { loadPartnerState, partnerTitle, requirePartnerState } from '../state';

export async function generateMetadata(): Promise<Metadata> {
  const loaded = await loadPartnerState();
  return {
    title: partnerTitle(loaded?.state.screen === 'suspended' ? 'Your earnings' : 'Earnings'),
  };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** `?view=week&week=2026-11-09` (design 1.2); no parameter means Today. */
function viewFrom(
  search: Record<string, string | string[] | undefined>,
  summary: EarningsSummary | null,
): EarningsView {
  const current = summary?.week.start ?? '';
  const week = firstParam(search.week);
  return {
    period: firstParam(search.view) === 'week' ? 'week' : 'today',
    week: week && ISO_DATE.test(week) ? week : current,
  };
}

/**
 * `/partner/earnings` (F9 design 1): approved partners in the app, the demo partner with his
 * practice week, a suspended partner read-only (P61). The summary comes in the first HTML; the
 * list fills in after (P59.2). Everyone else sees `/partner`.
 */
export default async function PartnerEarningsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { state, userId } = await requirePartnerState('/partner/earnings');
  if (state.screen !== 'home' && state.screen !== 'suspended') redirect('/partner');
  const actor = await getActor();
  if (actor.kind !== 'user') redirect('/partner');
  // A failed read shows "Couldn't load your earnings." with "Try again", never a guess (P59.4).
  const summary = await getEarningsSummary(actor).catch(() => null);
  const view = viewFrom(await searchParams, summary);

  if (state.screen === 'suspended') {
    return <SuspendedEarnings userId={userId} summary={summary} view={view} />;
  }
  return (
    <EarningsScreen
      state={state}
      userId={userId}
      asOf={new Date().toISOString()}
      summary={summary}
      view={view}
    />
  );
}
