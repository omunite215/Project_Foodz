import type { Metadata } from 'next';
import { getEarningsReport } from '@/server/modules/earnings/service';
import type { EarningsReport } from '@/server/modules/earnings/schema';
import { storeDate } from '@/server/modules/partners/text';
import { AdminPage } from '@/components/admin/admin-page';
import { ReportNoAccess } from '@/components/earnings-report/report-gate';
import { EarningsReportPage } from '@/components/earnings-report/report-page';
import { reportQueryFromSearch } from '@/lib/admin/report-query';
import { REPORT_COPY } from '@/lib/admin/report-text';
import { STORE_TIME_ZONE } from '@/lib/order-text';
import { reportAccess, reportPageMetadata } from './access';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export function generateMetadata(): Promise<Metadata> {
  return reportPageMetadata(REPORT_COPY.title);
}

/**
 * Earnings and payouts (F9 design 3.12 to 3.15, A63): what Foodz owes each partner and what
 * each owes Foodz for a range, in the first HTML, read from the address leniently so an edited
 * URL still shows a report. ADMIN and the demo admin only (the demo admin sees demo partners'
 * figures); SUPPORT, KITCHEN and CONTENT_EDITOR get the no-access page; customers and partners
 * never reach here (the layout's 404).
 */
export default async function EarningsReportRoute({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const access = await reportAccess();
  if (access.kind === 'handledByLayout') return null;
  if (access.kind === 'noAccess') {
    return (
      <AdminPage>
        <ReportNoAccess back={access.back} />
      </AdminPage>
    );
  }
  const today = storeDate(new Date(), STORE_TIME_ZONE);
  const query = reportQueryFromSearch(await searchParams, today);
  // A failed first read still draws the page: the report says so and offers "Try again".
  const initial: EarningsReport | null = await getEarningsReport(access.actor, query).catch(
    () => null,
  );
  return <EarningsReportPage initial={initial} today={today} />;
}
