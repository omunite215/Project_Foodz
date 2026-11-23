'use client';

import {
  ArrowDown,
  BellRing,
  ChevronsLeft,
  ClipboardCheck,
  CookingPot,
  type LucideIcon,
  PackageCheck,
  TriangleAlert,
  Truck,
} from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import type { BoardColumn as Column } from '@/server/modules/board/schema';
import { Button } from '@/components/ui/button';
import {
  collapseLabel,
  COLUMN_WORDS,
  type ColumnCount,
  columnSpoken,
  countChipText,
  collapsedSuffix,
  newBelowText,
  WAITING_FOR_PICKUP,
} from '@/lib/board/text';
import { useMotion } from '@/lib/motion';
import { cn } from '@/lib/utils';

/*
 * One column of the board (F5 design 2.3): a neutral header with the name, the count and the
 * late count in words, a list that scrolls on its own from 1024 px, and "1 new order below" when
 * a new card lands out of sight. Amber and red on the board mean lateness and nothing else, so
 * headers stay neutral.
 */

export const COLUMN_ICONS: Record<Column, LucideIcon> = {
  new: BellRing,
  accepted: ClipboardCheck,
  preparing: CookingPot,
  ready: PackageCheck,
  outForDelivery: Truck,
};

export const columnHeadingId = (column: Column) => `col-${column}`;
export const columnSectionId = (column: Column) => `column-${column}`;

const COUNT_CHIP =
  'inline-flex h-7 min-w-7 items-center justify-center rounded-md bg-white px-2 text-body-5 font-semibold text-neutral-1 tabular-nums';

function LateChip({ late }: { late: number }) {
  if (late === 0) return null;
  return (
    <span className="inline-flex h-7 items-center gap-1 rounded-md bg-tag-4-bg px-2 text-body-5 font-medium whitespace-nowrap text-neutral-1">
      <TriangleAlert className="size-3.5 text-destructive" aria-hidden />
      {late} late
    </span>
  );
}

/** "2 new orders below": scrolls to the first one and focuses its heading (A2.2). */
function NewBelowPill({ count, onShow }: { count: number; onShow: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useMotion(
    (motion) => {
      if (!ref.current) return;
      motion.from(ref.current, { y: 8, opacity: 0, duration: motion.reduced ? 0.12 : 0.2 });
    },
    { scope: ref },
  );
  return (
    <button
      ref={ref}
      type="button"
      onClick={onShow}
      className="mx-auto flex h-11 shrink-0 items-center gap-2 rounded-full bg-neutral-1 px-4 text-body-5 font-medium text-white shadow-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid"
    >
      <ArrowDown className="size-4" aria-hidden />
      {newBelowText(count)}
    </button>
  );
}

/**
 * New cards that landed below what the column shows, until they have been scrolled into view.
 * The list is the scroller from 1024 px; below that the page scrolls.
 */
function useNewBelow(listRef: React.RefObject<HTMLUListElement | null>, newIds: readonly string[]) {
  const [below, setBelow] = useState<string[]>([]);

  useEffect(() => {
    const list = listRef.current;
    if (!list || newIds.length === 0) return undefined;
    const scroller = getComputedStyle(list).overflowY === 'auto' ? list : null;
    const observer = new IntersectionObserver(
      (entries) => {
        setBelow((current) => {
          let next = current;
          for (const entry of entries) {
            const id = entry.target.getAttribute('data-card-id') ?? '';
            const rootBottom = entry.rootBounds?.bottom ?? window.innerHeight;
            if (entry.isIntersecting) next = next.filter((item) => item !== id);
            else if (entry.boundingClientRect.top >= rootBottom && !next.includes(id))
              next = [...next, id];
          }
          return next;
        });
      },
      { root: scroller, threshold: 0.25 },
    );
    for (const id of newIds) {
      const item = list.querySelector(`[data-card-id="${CSS.escape(id)}"]`);
      if (item) observer.observe(item);
    }
    return () => observer.disconnect();
  }, [listRef, newIds]);

  return below.filter((id) => newIds.includes(id));
}

export function BoardColumn({
  column,
  count,
  collapsed,
  collapsible,
  hiddenOnPhone,
  tabPanel,
  newIds,
  empty,
  onToggle,
  onShowNew,
  className,
  children,
}: {
  column: Column;
  count: ColumnCount;
  collapsed: boolean;
  collapsible: boolean;
  /** At phone width only the chosen tab's column shows (design 2.3). */
  hiddenOnPhone: boolean;
  /** At phone width the column is the chosen tab's panel. */
  tabPanel: boolean;
  /** New cards in this column, for "1 new order below". */
  newIds: readonly string[];
  /** The empty board shows one message across the columns instead of their lists. */
  empty: 'column' | 'board' | null;
  onToggle: () => void;
  onShowNew: (id: string) => void;
  className?: string;
  children: ReactNode;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const below = useNewBelow(listRef, newIds);
  const Icon = COLUMN_ICONS[column];

  if (collapsed) {
    return (
      <section
        id={columnSectionId(column)}
        aria-labelledby={columnHeadingId(column)}
        className={cn('max-md:hidden md:w-14 md:shrink-0 lg:w-auto lg:min-w-0', className)}
      >
        <h2 id={columnHeadingId(column)} tabIndex={-1} className="sr-only">
          {columnSpoken(column, count)}
        </h2>
        <button
          type="button"
          aria-expanded="false"
          onClick={onToggle}
          className="flex h-full min-h-60 w-14 flex-col items-center gap-3 rounded-2xl bg-neutral-7 py-3 text-neutral-1 hover:bg-neutral-6 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid"
        >
          <span className="sr-only">Expand </span>
          <Icon className="size-5 text-neutral-3" aria-hidden />
          <span aria-hidden className={COUNT_CHIP}>
            {countChipText(count)}
          </span>
          {count.late > 0 ? (
            <span
              aria-hidden
              className="flex size-7 items-center justify-center rounded-full bg-tag-4-bg"
            >
              <TriangleAlert className="size-3.5 text-destructive" />
            </span>
          ) : null}
          <span className="rotate-180 text-body-5 font-semibold whitespace-nowrap [writing-mode:vertical-rl]">
            {COLUMN_WORDS[column]}
          </span>
          <span className="sr-only">{collapsedSuffix(count)}</span>
        </button>
      </section>
    );
  }

  return (
    <section
      id={columnSectionId(column)}
      aria-labelledby={columnHeadingId(column)}
      role={tabPanel ? 'tabpanel' : undefined}
      className={cn(
        'flex min-w-0 flex-col rounded-2xl bg-neutral-7 lg:min-h-0',
        hiddenOnPhone && 'max-md:hidden',
        className,
      )}
    >
      {/* Two fixed rows, so first cards start at the same height in every column (2.3): the
          name and the collapse button, then the chips and Ready's subtitle. */}
      <header className="sticky top-0 z-10 rounded-t-2xl bg-neutral-7 px-3 py-2 max-md:static">
        <div className="flex min-h-12 items-center gap-2">
          <Icon className="size-5 shrink-0 text-neutral-3" aria-hidden />
          <h2
            id={columnHeadingId(column)}
            tabIndex={-1}
            className="min-w-0 rounded-md text-body-3 font-semibold text-neutral-1 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid"
          >
            <span aria-hidden>{COLUMN_WORDS[column]}</span>
            <span className="sr-only">{columnSpoken(column, count)}</span>
          </h2>
          {collapsible ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-kitchen"
              aria-expanded="true"
              aria-label={collapseLabel(column)}
              onClick={onToggle}
              className="-my-1 ml-auto shrink-0 text-neutral-3 max-md:hidden"
            >
              <ChevronsLeft className="size-5" aria-hidden />
            </Button>
          ) : null}
        </div>
        <div className="flex min-h-7 flex-wrap items-center gap-x-2 gap-y-1 pb-1 pl-7">
          <span aria-hidden className={COUNT_CHIP}>
            {countChipText(count)}
          </span>
          <span aria-hidden className="contents">
            <LateChip late={count.late} />
          </span>
          {column === 'ready' ? (
            <p className="text-caption text-neutral-3">{WAITING_FOR_PICKUP}</p>
          ) : null}
        </div>
      </header>
      {empty === 'board' ? null : (
        <ul
          ref={listRef}
          className="flex-1 space-y-2 overscroll-contain px-2 pb-24 lg:overflow-y-auto lg:pb-2 lg:[scrollbar-gutter:stable]"
        >
          {empty === 'column' ? (
            <li className="px-3 py-6 text-center text-body-5 text-neutral-3">Nothing here</li>
          ) : (
            children
          )}
          {below.length > 0 ? (
            <li className="sticky bottom-2 flex justify-center">
              <NewBelowPill count={below.length} onShow={() => onShowNew(below[0] ?? '')} />
            </li>
          ) : null}
        </ul>
      )}
    </section>
  );
}
