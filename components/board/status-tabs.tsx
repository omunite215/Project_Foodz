'use client';

import { type KeyboardEvent, useRef } from 'react';
import type { BoardColumn } from '@/server/modules/board/schema';
import { type ColumnCount, tabText } from '@/lib/board/text';
import { cn } from '@/lib/utils';
import { columnSectionId } from './board-column';

/*
 * The phone board's status tabs (F5 design 2.3, A16.3): "New 2", "Preparing 2 · 1 late", one
 * Tab stop, arrow keys move between them. The list scrolls sideways; the page never does.
 * Shown below 768 px only; the columns stay in the page, one at a time.
 */

export const tabId = (column: BoardColumn) => `tab-${column}`;

export function StatusTabs({
  columns,
  counts,
  selected,
  onSelect,
}: {
  columns: readonly BoardColumn[];
  counts: Record<BoardColumn, ColumnCount>;
  selected: BoardColumn;
  onSelect: (column: BoardColumn) => void;
}) {
  const refs = useRef(new Map<BoardColumn, HTMLButtonElement>());

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const index = columns.indexOf(selected);
    const next =
      event.key === 'ArrowRight'
        ? columns[(index + 1) % columns.length]
        : event.key === 'ArrowLeft'
          ? columns[(index - 1 + columns.length) % columns.length]
          : event.key === 'Home'
            ? columns[0]
            : event.key === 'End'
              ? columns.at(-1)
              : undefined;
    if (!next) return;
    event.preventDefault();
    onSelect(next);
    refs.current.get(next)?.focus();
  }

  return (
    <div
      role="tablist"
      aria-label="Order status"
      className="sticky top-14 z-20 flex overflow-x-auto border-b border-neutral-6 bg-background px-2 md:hidden"
    >
      {columns.map((column) => {
        const current = column === selected;
        return (
          <button
            key={column}
            ref={(element) => {
              if (element) refs.current.set(column, element);
              else refs.current.delete(column);
            }}
            id={tabId(column)}
            type="button"
            role="tab"
            aria-selected={current}
            aria-controls={columnSectionId(column)}
            tabIndex={current ? 0 : -1}
            onClick={() => onSelect(column)}
            onKeyDown={onKeyDown}
            className={cn(
              'relative h-11 shrink-0 px-3 text-body-5 font-medium whitespace-nowrap tabular-nums focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid',
              current
                ? 'text-neutral-1 after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-brand-strong'
                : 'text-neutral-3',
            )}
          >
            {tabText(column, counts[column])}
          </button>
        );
      })}
    </div>
  );
}
