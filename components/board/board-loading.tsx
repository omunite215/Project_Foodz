'use client';

import type { BoardColumn } from '@/server/modules/board/schema';
import { AdminPage } from '@/components/admin/admin-page';
import { useStaffShell } from '@/components/admin/staff-shell-context';
import { COLUMN_WORDS } from '@/lib/board/text';
import { cn } from '@/lib/utils';
import { COLUMN_ICONS } from './board-column';

/*
 * Navigating into the board (F5 design, States): the real chrome, the column headers as text
 * and two skeleton cards per column, with one label for screen readers. The board itself is in
 * the first HTML of a full load, so this shows only for navigation.
 */

const KITCHEN_COLUMNS: BoardColumn[] = ['new', 'accepted', 'preparing', 'ready'];
const FULL_COLUMNS: BoardColumn[] = [...KITCHEN_COLUMNS, 'outForDelivery'];

export function BoardLoading() {
  const shell = useStaffShell();
  const columns = shell.frame === 'kitchen' ? KITCHEN_COLUMNS : FULL_COLUMNS;
  return (
    <AdminPage
      title="Order board"
      className="lg:h-dvh lg:overflow-hidden"
      mainClassName="lg:min-h-0"
    >
      <div
        aria-busy
        className="flex flex-col gap-3 px-4 pt-20 pb-4 md:flex-row md:overflow-x-hidden lg:grid lg:flex-1 xl:gap-4 xl:px-6"
        style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(12.5rem, 1fr))` }}
      >
        <span className="sr-only">Loading the order board</span>
        {columns.map((column, index) => {
          const Icon = COLUMN_ICONS[column];
          return (
            <div
              key={column}
              className={cn(
                'flex flex-col rounded-2xl bg-neutral-7 md:w-[calc((100%-0.75rem)/2)] md:shrink-0 lg:w-auto',
                index > 0 && 'max-md:hidden',
              )}
            >
              <p className="flex min-h-14 items-center gap-2 px-3 py-2.5 text-body-3 font-semibold text-neutral-1">
                <Icon className="size-5 text-neutral-3" aria-hidden />
                {COLUMN_WORDS[column]}
              </p>
              <div className="space-y-2 px-2 pb-2">
                <div
                  aria-hidden
                  className="h-48 rounded-xl bg-white motion-safe:animate-skeleton"
                />
                <div
                  aria-hidden
                  className="h-48 rounded-xl bg-white motion-safe:animate-skeleton"
                />
              </div>
            </div>
          );
        })}
      </div>
    </AdminPage>
  );
}
