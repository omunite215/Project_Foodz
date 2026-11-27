import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import type { UserActor } from '@/server/auth/session';
import { getPartnerEarnings } from '@/server/modules/earnings/service';
import type { PartnerReview } from '@/server/modules/partners/review-schema';
import { listQueryFromSearch } from '@/server/modules/partners/review-schema';
import { getPartnerReview } from '@/server/modules/partners/review-service';
import { getPartnerRatings } from '@/server/modules/ratings/service';
import { AdminPage } from '@/components/admin/admin-page';
import { StaffGate } from '@/components/admin/staff-gate';
import {
  ApplicationPage,
  type PartnerSectionsData,
} from '@/components/partner-review/application-page';
import { type PartnerSection, SECTION_TITLES, sectionOf } from '@/lib/admin/earnings-text';
import { firstParam } from '@/lib/search-params';
import { partnersAccess, partnersPageMetadata } from '../../staff-access';

type Search = Record<string, string | string[] | undefined>;
type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Search>;
};

/** Shared by the metadata and the page; a non-UUID or a withdrawn id is "not found" (A20.1). */
const loadReview = cache((actor: UserActor, id: string) => getPartnerReview(actor, id));

/** F9 3.3: approved and suspended partners get Earnings, Ratings and Application. */
const hasSections = (review: PartnerReview) =>
  review.status === 'APPROVED' || review.status === 'SUSPENDED';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const dateParam = (search: Search, key: string) => {
  const value = firstParam(search[key]);
  return value && ISO_DATE.test(value) ? value : null;
};

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const access = await partnersAccess();
  if (access.kind !== 'allowed') return partnersPageMetadata('Partner application');
  const review = await loadReview(access.actor, (await params).id);
  if (!review) return { title: 'Application not found' };
  // A18.4: never the partner's name in the tab.
  if (!hasSections(review)) return { title: 'Partner application' };
  const view = sectionOf(firstParam((await searchParams).view));
  return { title: SECTION_TITLES[view] };
}

async function loadSection(
  actor: UserActor,
  partnerId: string,
  view: PartnerSection,
  search: Search,
): Promise<PartnerSectionsData> {
  const sections: PartnerSectionsData = { view, earnings: null, ratings: null };
  if (view === 'earnings') {
    // The list's own page and sort stay in the address too, so the ledger's have their own names.
    const page = Number.parseInt(firstParam(search.entriesPage) ?? '1', 10);
    sections.earnings = await getPartnerEarnings(actor, {
      partnerId,
      // Arriving from the report carries its range (design 3.3).
      from: dateParam(search, 'from'),
      to: dateParam(search, 'to'),
      page: Number.isFinite(page) && page > 0 ? page : 1,
      dir: firstParam(search.entriesDir) === 'asc' ? 'asc' : 'desc',
    }).catch(() => null);
  } else if (view === 'ratings') {
    sections.ratings = await getPartnerRatings(actor, { partnerId, cursor: null }).catch(
      () => null,
    );
  }
  return sections;
}

/** One application (F6 design 8), or a partner's three sections (F9 design 3.3), in the first HTML. */
export default async function PartnerApplicationPage({ params, searchParams }: Props) {
  const access = await partnersAccess();
  if (access.kind === 'handledByLayout') return null;
  if (access.kind === 'noAccess') {
    return (
      <AdminPage>
        <StaffGate kind="partnersNoAccess" />
      </AdminPage>
    );
  }
  const review = await loadReview(access.actor, (await params).id);
  if (!review) notFound();
  const search = await searchParams;
  const sections = hasSections(review)
    ? await loadSection(access.actor, review.partnerId, sectionOf(firstParam(search.view)), search)
    : null;
  // The list it came from, read leniently like the list itself, for "Back to partners" (A20.1).
  return (
    <ApplicationPage initial={review} list={listQueryFromSearch(search)} sections={sections} />
  );
}
