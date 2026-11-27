'use client';

import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  EarningsReport,
  EarningsReportQuery,
  IsoDate,
} from '@/server/modules/earnings/schema';
import { AdminPage, useSessionPhase } from '@/components/admin/admin-page';
import { useCsvDownload } from '@/components/admin/csv-button';
import { SignedOutOverlay } from '@/components/admin/signed-out-overlay';
import { useStaffShell } from '@/components/admin/staff-shell-context';
import { exportBody, reportHref, reportQueryFromSearch } from '@/lib/admin/report-query';
import { REPORT_COPY, reportFileName, resultCountWords } from '@/lib/admin/report-text';
import { announce } from '@/lib/announce';
import { ReadError, useEarningsReport } from './queries';
import { type Navigate, ReportView } from './report-view';

/*
 * The payouts report's page (F9 design 3.12): the server's first page, then kept in the
 * browser. Range, filter, search, sort and page live in the address; a change keeps the rows on
 * screen with the busy bar while the next answer comes, a page change shows skeleton rows, and
 * a changed range, filter or search announces the new count once.
 */

const CSV_ENDPOINT = '/admin/partners/earnings/export';

const navigateTo: Navigate = (query, mode = 'push') => {
  const href = reportHref(query);
  if (mode === 'push') window.history.pushState(null, '', href);
  else window.history.replaceState(null, '', href);
};

/** True after `flag` has held for 150 ms, then for at least 300 ms (F1 skeleton rule). */
function useSkeletonFlag(flag: boolean) {
  const [shown, setShown] = useState(false);
  const since = useRef(0);
  useEffect(() => {
    if (flag) {
      const timer = setTimeout(() => {
        since.current = Date.now();
        setShown(true);
      }, 150);
      return () => clearTimeout(timer);
    }
    const hold = Math.max(0, 300 - (Date.now() - since.current));
    const timer = setTimeout(() => setShown(false), shown ? hold : 0);
    return () => clearTimeout(timer);
  }, [flag, shown]);
  return shown;
}

const countKeyOf = (query: EarningsReportQuery) =>
  JSON.stringify({ from: query.from, to: query.to, filter: query.filter, q: query.q });

export function EarningsReportPage({
  initial,
  today,
}: {
  /** The server's read of this address; null when it couldn't be read. */
  initial: EarningsReport | null;
  /** The store's date in the server's render, for the presets. */
  today: IsoDate;
}) {
  const shell = useStaffShell();
  const params = useSearchParams();
  const [signedOut, setSignedOut] = useState(false);
  const sessionEnded = useSessionPhase(shell.sessionExpiresAt) === 'ended';
  const query = useMemo(
    () => reportQueryFromSearch(Object.fromEntries(params.entries()), today),
    [params, today],
  );
  const report = useEarningsReport(query, initial, !signedOut && !sessionEnded);
  const result = report.data ?? initial;
  const showingRef = useRef<HTMLParagraphElement>(null);

  const pending = report.isFetching && (report.isPlaceholderData || !report.data);
  const pageChanging = pending && result !== null && result.page !== query.page;
  const skeleton = useSkeletonFlag(pageChanging || (pending && result === null));
  const failed = report.isError && (report.isPlaceholderData || !report.data);

  // The session ended under the report: it stops asking and shows the sign-in cover.
  const signedOutNow =
    report.error instanceof ReadError && report.error.failure.code === 'UNAUTHENTICATED';
  if (signedOutNow && !signedOut) setSignedOut(true);

  // A changed range, filter or search reads the new count once; sorts and pages don't.
  const announced = useRef(countKeyOf(query));
  useEffect(() => {
    if (report.isPlaceholderData || !report.data) return;
    const key = countKeyOf(report.data.query);
    if (key === announced.current) return;
    announced.current = key;
    announce(resultCountWords(report.data.total));
  }, [report.data, report.isPlaceholderData]);

  const body = useCallback(() => exportBody(query), [query]);
  const csv = useCsvDownload({
    endpoint: CSV_ENDPOINT,
    body,
    fallbackFileName: reportFileName(query.from, query.to),
  });

  return (
    <AdminPage title={REPORT_COPY.title}>
      <div inert={signedOut || undefined}>
        <ReportView
          query={query}
          result={result}
          today={today}
          navigate={navigateTo}
          busy={pending && !pageChanging && result !== null}
          skeleton={skeleton}
          failed={failed}
          onRetry={() => void report.refetch()}
          csv={{ pending: csv.pending, error: csv.error, onPress: () => void csv.download() }}
          showingRef={showingRef}
        />
      </div>
      {signedOut || sessionEnded ? <SignedOutOverlay /> : null}
    </AdminPage>
  );
}
