import type { Metadata } from 'next';
import { listQueryFromSearch } from '@/server/modules/partners/review-schema';
import { listPartnerApplications } from '@/server/modules/partners/review-service';
import { AdminPage } from '@/components/admin/admin-page';
import { StaffGate } from '@/components/admin/staff-gate';
import { PartnersList } from '@/components/partner-review/partners-list';
import { partnersAccess, partnersPageMetadata } from '../staff-access';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export function generateMetadata(): Promise<Metadata> {
  return partnersPageMetadata('Partners');
}

/**
 * The Partners list (F6 design 7, A19): the first page in the HTML (A19.8), read from the
 * address leniently, so an edited URL still shows a list. KITCHEN and CONTENT_EDITOR get the
 * no-access page (A18.2); customers and couriers never reach here (the layout's 404).
 */
export default async function PartnersPage({ searchParams }: { searchParams: SearchParams }) {
  const access = await partnersAccess();
  if (access.kind === 'handledByLayout') return null;
  if (access.kind === 'noAccess') {
    return (
      <AdminPage>
        <StaffGate kind="partnersNoAccess" />
      </AdminPage>
    );
  }
  const initial = await listPartnerApplications(
    access.actor,
    listQueryFromSearch(await searchParams),
  );
  return <PartnersList initial={initial} />;
}
