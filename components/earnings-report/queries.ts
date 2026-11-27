'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { earningsReportAction } from '@/server/modules/earnings/actions';
import type { EarningsReport, EarningsReportQuery } from '@/server/modules/earnings/schema';
import { ReadError } from '@/components/partner-review/queries';
import { callAction } from '@/lib/action-result';

/*
 * The payouts report in the browser (F9 design 3.12): the server's first page answers its own
 * address; every other range, filter, sort or page is read through the action, keeping the rows
 * on screen meanwhile. Read again when the tab comes back.
 */

export const reportKeys = {
  all: ['earnings', 'report'] as const,
  report: (query: EarningsReportQuery) => ['earnings', 'report', query] as const,
};

export { ReadError };

async function readReport(query: EarningsReportQuery): Promise<EarningsReport> {
  const outcome = await callAction(() => earningsReportAction(query));
  if (!outcome.ok) throw new ReadError(outcome.error);
  return outcome.data;
}

const sameQuery = (a: EarningsReportQuery, b: EarningsReportQuery) =>
  JSON.stringify(a) === JSON.stringify(b);

export function useEarningsReport(
  query: EarningsReportQuery,
  initial: EarningsReport | null,
  enabled: boolean,
) {
  const seed = initial && sameQuery(initial.query, query) ? initial : null;
  return useQuery<EarningsReport>({
    queryKey: reportKeys.report(query),
    queryFn: () => readReport(query),
    initialData: seed ?? undefined,
    initialDataUpdatedAt: seed ? Date.parse(seed.asOf) : undefined,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: enabled,
    enabled,
    retry: false,
  });
}
