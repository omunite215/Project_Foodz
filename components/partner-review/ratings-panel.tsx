'use client';

import { type InfiniteData, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { Info, Star } from 'lucide-react';
import { type Ref, useEffect, useId } from 'react';
import { partnerRatingsAction } from '@/server/modules/ratings/actions';
import type { PartnerRatingsPage, StaffRatingRow, TagCount } from '@/server/modules/ratings/schema';
import { SubmitButton } from '@/components/forms/submit-button';
import { FormAlert } from '@/components/forms/form-alert';
import { Button } from '@/components/ui/button';
import { callAction } from '@/lib/action-result';
import {
  appFigureLine,
  baselineLine,
  ratingsCount,
  showingRatings,
  shownWords,
  SPREAD_NOTE,
  spreadSr,
  tagChip,
} from '@/lib/admin/earnings-text';
import { cn } from '@/lib/utils';
import { ReadError } from './queries';
import { type ModerationChange, StaffRatingItem } from './rating-moderation';

/*
 * The partner page's Ratings section (F9 design 3.10): the current figure (staff see it live;
 * the partner's own app moves only after 5 new ratings), the spread, 30 days of tags, then
 * every rating, newest first, 20 at a time, each with the comment, who excluded it and why.
 */

export const ratingsKey = (partnerId: string) => ['partners', 'ratings', partnerId] as const;

type Pages = InfiniteData<PartnerRatingsPage, string | null>;

async function readRatings(partnerId: string, cursor: string | null) {
  const outcome = await callAction(() => partnerRatingsAction({ partnerId, cursor }));
  if (!outcome.ok) throw new ReadError(outcome.error);
  if (!outcome.data) throw new ReadError({ code: 'NOT_FOUND', message: 'Not found' });
  return outcome.data;
}

/** The row as it now reads after this staff member's own change, before the refetch lands. */
function patched(row: StaffRatingRow, change: ModerationChange): StaffRatingRow {
  const excluded = change.status === 'excluded' ? change.excluded : null;
  return {
    ...row,
    excluded,
    actions: { ...row.actions, exclude: !excluded, include: Boolean(excluded) },
  };
}

function Summary({ page, name }: { page: PartnerRatingsPage; name: string }) {
  const { summary } = page;
  if (summary.count === 0 && summary.baselineCount === 0) {
    return (
      <div className="rounded-2xl border border-neutral-6 bg-white p-5">
        <p className="text-body-4 text-neutral-2">No ratings yet.</p>
      </div>
    );
  }
  const max = Math.max(1, ...page.spread.map((entry) => entry.count));
  const spreadId = `${page.partnerId}-spread`;
  const tagsId = `${page.partnerId}-tags`;
  return (
    <div className="space-y-5 rounded-2xl border border-neutral-6 bg-white p-5">
      <div>
        {summary.average !== null ? (
          <p className="flex items-center gap-2">
            <span className="text-h4 leading-none font-semibold text-neutral-1 tabular-nums">
              {summary.average.toFixed(1)}
            </span>
            <Star className="size-6 fill-tag-6 text-warning-strong" aria-hidden />
            <span className="sr-only">out of 5</span>
          </p>
        ) : null}
        <p className="mt-1 text-body-4 text-neutral-2">{ratingsCount(summary.count)}</p>
        <p className="mt-1 text-body-5 text-neutral-3">{shownWords(summary.shownToCustomers)}</p>
        <p className="mt-1 text-body-5 text-neutral-3">{appFigureLine(name)}</p>
        {summary.baselineCount > 0 ? (
          <p className="mt-1 flex gap-2 text-body-5 text-neutral-2">
            <Info className="mt-0.5 size-4 shrink-0 text-neutral-3" aria-hidden />
            {baselineLine(summary.baselineCount)}
          </p>
        ) : null}
        {summary.baselineCount > 0 && page.rows.length === 0 ? (
          <p className="mt-1 text-body-5 text-neutral-3">{SPREAD_NOTE}</p>
        ) : null}
      </div>
      <section aria-labelledby={spreadId}>
        <h3 id={spreadId} className="text-body-5 font-semibold text-neutral-1">
          Spread
        </h3>
        <ul className="mt-2 space-y-1.5">
          {page.spread.map((entry) => (
            <li
              key={entry.stars}
              className="grid grid-cols-[2.75rem_minmax(0,1fr)_2.5rem] items-center gap-2 text-body-5 text-neutral-1 tabular-nums"
            >
              <span aria-hidden>{entry.stars} ★</span>
              <span aria-hidden className="h-2 overflow-hidden rounded-full bg-neutral-7">
                <span
                  className="block h-full rounded-full bg-tag-6"
                  style={{ width: `${(entry.count / max) * 100}%` }}
                />
              </span>
              <span aria-hidden>· {entry.count}</span>
              <span className="sr-only">{spreadSr(entry.stars, entry.count)}</span>
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby={tagsId}>
        <h3 id={tagsId} className="text-body-5 font-semibold text-neutral-1">
          Tags, last 30 days
        </h3>
        <TagGroup label="Liked" tags={page.tags30d.liked} />
        <TagGroup label="Mentioned" tags={page.tags30d.mentioned} />
      </section>
    </div>
  );
}

function TagGroup({ label, tags }: { label: string; tags: readonly TagCount[] }) {
  return (
    <div className="mt-2">
      <p className="text-body-5 text-neutral-3">{label}</p>
      {tags.length ? (
        <ul className="mt-1 flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <li
              key={tag.tag}
              className="inline-flex h-6 items-center rounded-md bg-neutral-7 px-2 text-caption font-medium text-neutral-1 tabular-nums"
            >
              {tagChip(tag)}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-body-5 text-neutral-2">Nothing in the last 30 days.</p>
      )}
    </div>
  );
}

export function PartnerRatingsPanel({
  initial,
  partnerId,
  partnerName,
  timeZone,
  offline,
  enabled,
  headingRef,
  onSignedOut,
}: {
  initial: PartnerRatingsPage | null;
  partnerId: string;
  partnerName: string;
  timeZone: string;
  offline: boolean;
  enabled: boolean;
  headingRef: Ref<HTMLHeadingElement>;
  onSignedOut: () => void;
}) {
  const titleId = useId();
  const listId = useId();
  const queryClient = useQueryClient();
  const query = useInfiniteQuery<
    PartnerRatingsPage,
    Error,
    Pages,
    readonly string[],
    string | null
  >({
    queryKey: ratingsKey(partnerId),
    queryFn: ({ pageParam }) => readRatings(partnerId, pageParam),
    initialPageParam: null,
    getNextPageParam: (last) => last.nextCursor,
    initialData: initial ? { pages: [initial], pageParams: [null] } : undefined,
    staleTime: 5_000,
    refetchOnWindowFocus: enabled,
    enabled,
    retry: false,
  });
  const failure = query.error instanceof ReadError ? query.error.failure : null;
  useEffect(() => {
    if (failure?.code === 'UNAUTHENTICATED') onSignedOut();
  }, [failure, onSignedOut]);

  const pages = query.data?.pages ?? [];
  const first = pages[0];
  const rows = pages.flatMap((page) => page.rows);

  const changed = (row: StaffRatingRow, change: ModerationChange | null) => {
    if (change) {
      queryClient.setQueryData<Pages>(ratingsKey(partnerId), (data) =>
        data
          ? {
              ...data,
              pages: data.pages.map((page) => ({
                ...page,
                rows: page.rows.map((item) => (item.id === row.id ? patched(item, change) : item)),
              })),
            }
          : data,
      );
    }
    void queryClient.invalidateQueries({ queryKey: ratingsKey(partnerId) });
  };

  const heading = (
    <h2
      id={titleId}
      ref={headingRef}
      tabIndex={-1}
      className="text-body-3 font-semibold text-neutral-1 outline-none"
    >
      Ratings
    </h2>
  );

  if (!first) {
    return (
      <section aria-labelledby={titleId} className="space-y-6">
        {heading}
        {query.isError ? (
          <FormAlert
            variant="error"
            action={
              <Button
                type="button"
                variant="outline"
                size="touch"
                className="bg-white"
                onClick={() => void query.refetch()}
              >
                Try again
              </Button>
            }
          >
            We couldn&apos;t load ratings. Try again.
          </FormAlert>
        ) : (
          <div aria-busy className="h-32 rounded-2xl bg-neutral-7 motion-safe:animate-skeleton" />
        )}
      </section>
    );
  }

  if (first.hiddenForDemo) {
    return (
      <section aria-labelledby={titleId} className="space-y-6">
        {heading}
        <p className="text-body-5 text-neutral-3">Ratings are hidden for demo staff.</p>
      </section>
    );
  }

  const nothing = first.summary.count === 0 && first.summary.baselineCount === 0;
  return (
    <section aria-labelledby={titleId} className="space-y-6">
      {heading}
      <div className="space-y-6 xl:grid xl:grid-cols-[360px_minmax(0,1fr)] xl:items-start xl:gap-8 xl:space-y-0">
        <Summary page={first} name={partnerName} />
        {nothing ? null : (
          <section aria-labelledby={listId}>
            <h3 id={listId} className="text-body-4 font-semibold text-neutral-1">
              All ratings
            </h3>
            <p className="text-body-5 text-neutral-3">Newest first</p>
            {rows.length === 0 ? (
              <p className="mt-3 rounded-2xl border border-neutral-6 bg-white px-4 py-8 text-center text-body-5 text-neutral-3">
                No rated deliveries yet.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-neutral-6 rounded-2xl border border-neutral-6 bg-white">
                {rows.map((row) => (
                  <li key={row.id} className={cn('p-4')}>
                    <StaffRatingItem
                      row={row}
                      timeZone={timeZone}
                      offline={offline}
                      withOrder
                      onChanged={changed}
                      onSignedOut={onSignedOut}
                    />
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-3">
              {query.hasNextPage ? (
                <SubmitButton
                  type="button"
                  variant="outline"
                  className="bg-white"
                  pending={query.isFetchingNextPage}
                  pendingLabel="Loading…"
                  onClick={() => void query.fetchNextPage()}
                >
                  Show more ratings
                </SubmitButton>
              ) : null}
              {rows.length > 0 ? (
                <p className="text-body-5 text-neutral-3 tabular-nums">
                  {showingRatings(rows.length, first.total)}
                </p>
              ) : null}
            </div>
          </section>
        )}
      </div>
    </section>
  );
}
