'use client';

import { defaultRangeExtractor, type Range, useWindowVirtualizer } from '@tanstack/react-virtual';
import {
  Banknote,
  ChevronRight,
  CircleMinus,
  CirclePlus,
  Landmark,
  type LucideIcon,
  Package,
  Undo2,
} from 'lucide-react';
import {
  type Ref,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { EarningsDayGroup, EarningsRow, IsoDate } from '@/server/modules/earnings/schema';
import { prefersReducedMotion, useMotion } from '@/lib/motion';
import {
  dayHeader,
  deliveryRowName,
  opensSheet,
  rowAmount,
  rowFirstLine,
  rowSecondLine,
} from '@/lib/partner/earnings-text';
import { cn } from '@/lib/utils';

/*
 * The list (F9 design 1.7): the period's rows, newest first, grouped by day with what he earned
 * that day. Day headers stick under the status header and the pinned banner. Up to 40 rows it
 * renders plainly; from 40 it's virtualized on the window, with the current day's header kept
 * pinned (P55.3). Only delivery rows open a sheet.
 */

export const VIRTUAL_FROM = 40;

const ICONS: Record<EarningsRow['kind'], LucideIcon> = {
  delivery: Package,
  cancelledAfterPickup: Undo2,
  cashHandedIn: Banknote,
  added: CirclePlus,
  takenOff: CircleMinus,
  payout: Landmark,
};

export interface EarningsListHandle {
  /** Scrolls to a day's header and moves focus there (a week bar's press, P54.2). */
  showDay: (date: IsoDate) => void;
}

const HEADER_CLASS =
  'flex h-10 items-center border-b border-border bg-background px-4 text-body-5 font-semibold text-strong tabular-nums outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid';

const scrollBehavior = (): ScrollBehavior => (prefersReducedMotion() ? 'auto' : 'smooth');

export function EarningsList({
  groups,
  today,
  timeZone,
  newIds,
  onOpen,
  handleRef,
}: {
  groups: EarningsDayGroup[];
  today: IsoDate;
  timeZone: string;
  /** Rows that arrived while the tab was open: they get a short wash. */
  newIds: ReadonlySet<string>;
  onOpen: (row: EarningsRow, opener: HTMLButtonElement) => void;
  handleRef: Ref<EarningsListHandle>;
}) {
  const rowCount = groups.reduce((total, group) => total + group.rows.length, 0);
  return (
    <section aria-labelledby="list-title">
      <h2 id="list-title" className="sr-only">
        Deliveries and payments
      </h2>
      {rowCount >= VIRTUAL_FROM ? (
        <VirtualList
          groups={groups}
          today={today}
          timeZone={timeZone}
          newIds={newIds}
          onOpen={onOpen}
          handleRef={handleRef}
        />
      ) : (
        <PlainList
          groups={groups}
          today={today}
          timeZone={timeZone}
          newIds={newIds}
          onOpen={onOpen}
          handleRef={handleRef}
        />
      )}
    </section>
  );
}

type ListProps = Parameters<typeof EarningsList>[0];

function PlainList({ groups, today, timeZone, newIds, onOpen, handleRef }: ListProps) {
  useImperativeHandle(handleRef, () => ({
    showDay: (date) => {
      const group = document.getElementById(`day-group-${date}`);
      const header = document.getElementById(`day-${date}`);
      group?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
      header?.focus({ preventScroll: true });
    },
  }));
  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <div
          key={group.date}
          id={`day-group-${group.date}`}
          className="scroll-mt-[var(--partner-sticky-top,3.5rem)]"
        >
          <h3
            id={`day-${group.date}`}
            tabIndex={-1}
            className={cn(HEADER_CLASS, 'sticky top-[var(--partner-sticky-top,3.5rem)] z-10 -mx-4')}
          >
            {dayHeader(group.date, today, group.earnedCents)}
          </h3>
          <ul className="mt-2 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
            {group.rows.map((row) => (
              <li key={row.id}>
                <RowView row={row} timeZone={timeZone} isNew={newIds.has(row.id)} onOpen={onOpen} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

type Item =
  | { kind: 'header'; group: EarningsDayGroup }
  | { kind: 'row'; row: EarningsRow; first: boolean; last: boolean; date: IsoDate };

function VirtualList({ groups, today, timeZone, newIds, onOpen, handleRef }: ListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const [margin, setMargin] = useState(0);
  const [stickyTop, setStickyTop] = useState(56);
  const items = useMemo<Item[]>(
    () =>
      groups.flatMap((group) => [
        { kind: 'header' as const, group },
        ...group.rows.map((row, index) => ({
          kind: 'row' as const,
          row,
          first: index === 0,
          last: index === group.rows.length - 1,
          date: group.date,
        })),
      ]),
    [groups],
  );
  const headerIndexes = useMemo(
    () => items.flatMap((item, index) => (item.kind === 'header' ? [index] : [])),
    [items],
  );
  const activeSticky = useRef(0);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    setMargin(list.getBoundingClientRect().top + window.scrollY);
    const top = Number.parseFloat(
      getComputedStyle(list).getPropertyValue('--partner-sticky-top') || '56',
    );
    if (Number.isFinite(top)) setStickyTop(top);
  }, [items.length]);

  const rangeExtractor = useCallback(
    (range: Range) => {
      activeSticky.current =
        headerIndexes.toReversed().find((index) => range.startIndex >= index) ?? 0;
      return [...new Set([activeSticky.current, ...defaultRangeExtractor(range)])].toSorted(
        (a, b) => a - b,
      );
    },
    [headerIndexes],
  );

  // The virtualizer is read fresh on every render; nothing here is memoized around it.
  // oxlint-disable-next-line react/incompatible-library
  const virtualizer = useWindowVirtualizer({
    count: items.length,
    estimateSize: (index) => (items[index]?.kind === 'header' ? 48 : 72),
    overscan: 8,
    scrollMargin: margin,
    scrollPaddingStart: stickyTop,
    rangeExtractor,
  });

  useImperativeHandle(handleRef, () => ({
    showDay: (date) => {
      const index = items.findIndex((item) => item.kind === 'header' && item.group.date === date);
      if (index < 0) return;
      virtualizer.scrollToIndex(index, { align: 'start', behavior: scrollBehavior() });
      // The header is drawn once the list has moved there.
      setTimeout(
        () => document.getElementById(`day-${date}`)?.focus({ preventScroll: true }),
        prefersReducedMotion() ? 50 : 450,
      );
    },
  }));

  return (
    <div ref={listRef} className="relative" style={{ height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map((virtual) => {
        const item = items[virtual.index];
        if (!item) return null;
        const isActiveSticky = item.kind === 'header' && activeSticky.current === virtual.index;
        if (item.kind === 'header') {
          return (
            <div
              key={virtual.key}
              data-index={virtual.index}
              ref={virtualizer.measureElement}
              className={cn('z-10 -mx-4 pb-2', isActiveSticky ? 'sticky' : 'absolute')}
              style={
                isActiveSticky
                  ? { top: 'var(--partner-sticky-top, 3.5rem)' }
                  : {
                      top: 0,
                      left: '-1rem',
                      width: 'calc(100% + 2rem)',
                      transform: `translateY(${virtual.start - virtualizer.options.scrollMargin}px)`,
                    }
              }
            >
              <h3 id={`day-${item.group.date}`} tabIndex={-1} className={HEADER_CLASS}>
                {dayHeader(item.group.date, today, item.group.earnedCents)}
              </h3>
            </div>
          );
        }
        return (
          <div
            key={virtual.key}
            data-index={virtual.index}
            ref={virtualizer.measureElement}
            className={cn('absolute top-0 left-0 w-full', item.last && 'pb-3')}
            style={{
              transform: `translateY(${virtual.start - virtualizer.options.scrollMargin}px)`,
            }}
          >
            <div
              className={cn(
                'overflow-hidden border-x border-border bg-card',
                item.first && 'rounded-t-2xl border-t',
                item.last ? 'rounded-b-2xl border-b' : 'border-b',
              )}
            >
              <RowView
                row={item.row}
                timeZone={timeZone}
                isNew={newIds.has(item.row.id)}
                onOpen={onOpen}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RowView({
  row,
  timeZone,
  isNew,
  onOpen,
}: {
  row: EarningsRow;
  timeZone: string;
  isNew: boolean;
  onOpen: (row: EarningsRow, opener: HTMLButtonElement) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const Icon = ICONS[row.kind];
  const second = rowSecondLine(row, timeZone);
  const sheet = opensSheet(row);

  // A new row's 600 ms wash (none under reduced motion): an overlay's opacity, nothing moves.
  useMotion(
    (motion) => {
      const wash = ref.current?.querySelector('[data-wash]');
      if (!wash || motion.reduced) return;
      motion.fromTo(wash, { opacity: 1 }, { opacity: 0, duration: 0.6, ease: 'power1.out' });
    },
    { scope: ref, dependencies: [isNew] },
  );

  const content = (
    <>
      <Icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block text-body-4 font-medium text-strong [overflow-wrap:anywhere]">
          {rowFirstLine(row, timeZone)}
        </span>
        {second ? (
          // On a row's hover fill the grey line would drop under 4.5:1, so it darkens too.
          <span className="mt-0.5 block text-body-5 text-muted-foreground group-hover:text-foreground [overflow-wrap:anywhere]">
            {second}
          </span>
        ) : null}
      </span>
      <span className="text-body-3 font-semibold whitespace-nowrap text-strong tabular-nums">
        {rowAmount(row)}
      </span>
      {sheet ? (
        <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden />
      ) : null}
    </>
  );
  const rowClass = 'relative flex min-h-16 w-full items-start gap-3 px-4 py-3 text-left';
  return (
    <div ref={ref} className="relative">
      {isNew ? (
        <span
          data-wash=""
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-success-soft opacity-0"
        />
      ) : null}
      {sheet ? (
        <button
          type="button"
          onClick={(event) => onOpen(row, event.currentTarget)}
          className={cn(
            rowClass,
            'group hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid',
          )}
        >
          {/* Read as one sentence from its parts; the visible lines stay visual. */}
          <span className="sr-only">{deliveryRowName(row, timeZone)}</span>
          <span aria-hidden className="contents">
            {content}
          </span>
        </button>
      ) : (
        <div className={rowClass}>{content}</div>
      )}
    </div>
  );
}

/** Three rows' shapes inside the day card while the list loads (P59.2). */
export function ListSkeleton() {
  return (
    <div aria-hidden className="space-y-2">
      <div className="h-10" />
      <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card motion-safe:animate-pulse">
        {[0, 1, 2].map((index) => (
          <div key={index} className="flex h-16 items-start gap-3 px-4 py-3">
            <span className="mt-0.5 size-5 rounded-full bg-muted" />
            <span className="flex-1 space-y-2">
              <span className="block h-4 w-3/4 rounded bg-muted" />
              <span className="block h-3 w-1/2 rounded bg-muted" />
            </span>
            <span className="h-5 w-14 rounded bg-muted" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Skeletons only after 150 ms, then held at least 300 ms, so a quick answer never flickers. */
export function useSkeleton(loading: boolean): { show: boolean; reserve: boolean } {
  const [visibleAt, setVisibleAt] = useState<number | null>(null);
  useEffect(() => {
    if (!loading) return undefined;
    const timer = setTimeout(() => setVisibleAt(performance.now()), 150);
    return () => clearTimeout(timer);
  }, [loading]);
  useEffect(() => {
    if (loading || visibleAt === null) return undefined;
    const left = 300 - (performance.now() - visibleAt);
    const timer = setTimeout(() => setVisibleAt(null), Math.max(0, left));
    return () => clearTimeout(timer);
  }, [loading, visibleAt]);
  return { show: visibleAt !== null, reserve: loading && visibleAt === null };
}
