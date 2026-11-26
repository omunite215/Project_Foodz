'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type {
  EarningsDeliveryDetail,
  EarningsSummary,
  EarningsWeek,
  IsoDate,
} from '@/server/modules/earnings/schema';
import type { PartnerRatingsSummary } from '@/server/modules/ratings/schema';
import { channels } from '@/lib/realtime/channels';
import { useChannelEvent } from '@/lib/realtime/client';

/*
 * The Earnings tab's reads (F9 design 1, open item 9): the summary under its own key, one cache
 * entry per week, and a delivery's detail. `earnings.changed` (no amounts) and coming back to the
 * app refetch the summary and the current week only; a week seen before is never fetched again
 * in this visit (P54.3).
 */

const BASE = '/api/v1/partner';

export class EarningsReadError extends Error {
  constructor(readonly status: number) {
    super(`Earnings read failed (${status})`);
  }
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) throw new EarningsReadError(response.status);
  // The partner routes answer with exactly these shapes (server/modules/earnings/schema.ts).
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return (await response.json()) as T;
}

export const earningsKeys = {
  all: (partnerId: string) => ['earnings', partnerId] as const,
  summary: (partnerId: string) => ['earnings', partnerId, 'summary'] as const,
  week: (partnerId: string, weekStart: IsoDate) => ['earnings', partnerId, weekStart] as const,
  delivery: (partnerId: string, deliveryId: string) =>
    ['earnings', partnerId, 'delivery', deliveryId] as const,
  ratings: (partnerId: string) => ['partner-ratings', partnerId] as const,
};

export const fetchSummary = () => getJson<EarningsSummary>(`${BASE}/earnings/summary`);
export const fetchWeek = (weekStart: IsoDate) =>
  getJson<EarningsWeek>(`${BASE}/earnings/entries?weekStart=${encodeURIComponent(weekStart)}`);
export const fetchDelivery = (deliveryId: string) =>
  getJson<EarningsDeliveryDetail>(`${BASE}/earnings/deliveries/${encodeURIComponent(deliveryId)}`);
export const fetchRatings = () => getJson<PartnerRatingsSummary>(`${BASE}/ratings/summary`);

/** The summary from the server render, kept fresh by the events below. */
export function useEarningsSummary(partnerId: string, initial: EarningsSummary) {
  return useQuery({
    queryKey: earningsKeys.summary(partnerId),
    queryFn: fetchSummary,
    initialData: initial,
    initialDataUpdatedAt: Date.parse(initial.asOf) || undefined,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
}

/** One week's rows; the current week stays live, earlier weeks are fixed for the visit. */
export function useEarningsWeek(partnerId: string, weekStart: IsoDate, isCurrent: boolean) {
  return useQuery({
    queryKey: earningsKeys.week(partnerId, weekStart),
    queryFn: () => fetchWeek(weekStart),
    staleTime: isCurrent ? 30_000 : Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: isCurrent,
    refetchOnReconnect: isCurrent,
  });
}

export function useDeliveryDetail(partnerId: string, deliveryId: string | null) {
  return useQuery({
    queryKey: earningsKeys.delivery(partnerId, deliveryId ?? ''),
    queryFn: () => fetchDelivery(deliveryId ?? ''),
    enabled: deliveryId !== null,
    staleTime: Number.POSITIVE_INFINITY,
    retry: (count, error) =>
      !(error instanceof EarningsReadError && error.status === 404) && count < 2,
  });
}

/**
 * Live updates (P52.3, P56.3): `earnings.changed`, and his own delivery ending, refetch the
 * summary and the current week. At the store's midnight (P52.4) the summary is read again, so
 * Today starts over and yesterday's rows move under their own header.
 */
export function useEarningsLive(
  partnerId: string,
  currentWeek: IsoDate,
  nextDayAt: string | null,
  enabled = true,
) {
  const queryClient = useQueryClient();
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: earningsKeys.summary(partnerId) });
    void queryClient.invalidateQueries({ queryKey: earningsKeys.week(partnerId, currentWeek) });
  };
  const channel = enabled ? channels.partner(partnerId) : null;
  useChannelEvent(channel, 'earnings.changed', refresh);
  useChannelEvent(channel, 'delivery.changed', (event) => {
    if (event.status === 'DELIVERED' || event.status === 'CANCELLED') refresh();
  });

  useEffect(() => {
    if (!nextDayAt) return undefined;
    // Within a minute of midnight: a few seconds after it, so the server's day has turned.
    const wait = Math.max(1_000, Date.parse(nextDayAt) - Date.now() + 5_000);
    if (!Number.isFinite(wait) || wait > 2 ** 31 - 1) return undefined;
    const timer = setTimeout(() => {
      void queryClient.invalidateQueries({ queryKey: earningsKeys.all(partnerId) });
    }, wait);
    return () => clearTimeout(timer);
  }, [nextDayAt, partnerId, queryClient]);
}
