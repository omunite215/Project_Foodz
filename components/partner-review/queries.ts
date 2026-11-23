'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  partnerBadgeAction,
  partnerListAction,
  partnerReviewAction,
} from '@/server/modules/partners/review-actions';
import {
  BADGE_REFRESH_MS,
  LIST_REFRESH_MS,
  type PartnerBadge,
  type PartnerListQuery,
  type PartnerListResult,
  type PartnerReview,
  REVIEW_REFRESH_MS,
} from '@/server/modules/partners/review-schema';
import { type ActionFailure, callAction } from '@/lib/action-result';

/*
 * The staff review's server reads in the browser (F6 A18.1, A19.10, A20.10): the sidebar badge
 * every 60 s, the list every 60 s and when the tab comes back, one application every 30 s. Each
 * keeps what it last showed while it asks again, so nothing flashes.
 */

export const partnerKeys = {
  all: ['partners'] as const,
  badge: ['partners', 'badge'] as const,
  list: (query: PartnerListQuery) => ['partners', 'list', query] as const,
  review: (partnerId: string) => ['partners', 'review', partnerId] as const,
};

/** A failed read, with the server's code kept for the screens that care (404, signed out). */
export class ReadError extends Error {
  readonly failure: ActionFailure;
  constructor(failure: ActionFailure) {
    super(failure.message);
    this.name = 'ReadError';
    this.failure = failure;
  }
}

async function read<T>(run: () => Promise<{ data?: T } | undefined>): Promise<T> {
  const outcome = await callAction(run);
  if (!outcome.ok) throw new ReadError(outcome.error);
  return outcome.data;
}

export function usePartnerBadge(enabled: boolean) {
  return useQuery<PartnerBadge>({
    queryKey: partnerKeys.badge,
    queryFn: () => read(() => partnerBadgeAction({})),
    enabled,
    refetchInterval: BADGE_REFRESH_MS,
    refetchIntervalInBackground: false,
    retry: false,
  });
}

export function usePartnerList(
  query: PartnerListQuery,
  initial: PartnerListResult | null,
  enabled: boolean,
) {
  // The server's first page answers its own address only, never another tab or page.
  const seed = initial && JSON.stringify(initial.query) === JSON.stringify(query) ? initial : null;
  return useQuery<PartnerListResult>({
    queryKey: partnerKeys.list(query),
    queryFn: () => read(() => partnerListAction(query)),
    initialData: seed ?? undefined,
    initialDataUpdatedAt: seed ? Date.parse(seed.asOf) : undefined,
    staleTime: 5_000,
    placeholderData: keepPreviousData,
    refetchInterval: enabled ? LIST_REFRESH_MS : false,
    refetchOnWindowFocus: enabled,
    enabled,
    retry: false,
  });
}

export function usePartnerReview(initial: PartnerReview, enabled: boolean) {
  return useQuery<PartnerReview>({
    queryKey: partnerKeys.review(initial.partnerId),
    queryFn: () => read(() => partnerReviewAction({ partnerId: initial.partnerId })),
    initialData: initial,
    initialDataUpdatedAt: Date.parse(initial.asOf),
    staleTime: 5_000,
    refetchInterval: enabled ? REVIEW_REFRESH_MS : false,
    refetchOnWindowFocus: enabled,
    enabled,
    retry: false,
  });
}
