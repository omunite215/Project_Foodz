import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import type { UserActor } from '@/server/auth/session';
import { listQueryFromSearch } from '@/server/modules/partners/review-schema';
import { getPartnerReview } from '@/server/modules/partners/review-service';
import { AdminPage } from '@/components/admin/admin-page';
import { StaffGate } from '@/components/admin/staff-gate';
import { ApplicationPage } from '@/components/partner-review/application-page';
import { partnersAccess, partnersPageMetadata } from '../../staff-access';

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Shared by the metadata and the page; a non-UUID or a withdrawn id is "not found" (A20.1). */
const loadReview = cache((actor: UserActor, id: string) => getPartnerReview(actor, id));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const access = await partnersAccess();
  if (access.kind !== 'allowed') return partnersPageMetadata('Partner application');
  const review = await loadReview(access.actor, (await params).id);
  // A18.4: never the applicant's name in the tab.
  return { title: review ? 'Partner application' : 'Application not found' };
}

/** One application (F6 design 8): everything to decide, in the first HTML. */
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
  // The list it came from, read leniently like the list itself, for "Back to partners" (A20.1).
  return <ApplicationPage initial={review} list={listQueryFromSearch(await searchParams)} />;
}
