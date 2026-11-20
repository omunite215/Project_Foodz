'use client';

import { SlidersHorizontal, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { useDialogHistory } from '@/lib/dialog-history';
import { plural } from '@/lib/format';
import type { PriceBounds, PriceRange as Range } from '@/lib/menu-query';
import { PricePresets, PriceRange } from './price-range';

/*
 * Price below `lg` (F3 S6.10, design 5.6): a "Filters" button in the search row opens a bottom
 * sheet on phones and a 400 px panel on tablets. Changes apply as she makes them; "Show 4
 * dishes" only closes. Back closes it, like the cart (D2).
 */

export function FiltersSheet({
  bounds,
  value,
  onChange,
  countFor,
  onClearAll,
}: {
  bounds: PriceBounds;
  value: Range;
  onChange: (range: Range) => void;
  /** How many dishes a range would show (all cuisines), for the live count. */
  countFor: (range: Range) => number;
  onClearAll: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState<Range | null>(null);
  const lowRef = useRef<HTMLDivElement>(null);
  const history = useDialogHistory('foodzFilters', open, () => setOpen(false));
  const on = value.min !== bounds.min || value.max !== bounds.max ? 1 : 0;
  const count = countFor(dragging ?? value);

  return (
    <Sheet open={open} onOpenChange={(next) => (next ? setOpen(true) : history.close())}>
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="relative size-12 shrink-0 rounded-lg border-input bg-white px-0 text-neutral-2 hover:bg-neutral-7 md:h-14 md:w-auto md:gap-2 md:px-4 md:text-button-1"
        >
          <SlidersHorizontal className="size-5" aria-hidden />
          <span className="sr-only md:hidden">{on ? `Filters, ${on} on` : 'Filters'}</span>
          <span className="hidden md:inline">{on ? `Filters (${on})` : 'Filters'}</span>
          {on ? (
            <span
              aria-hidden
              className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-strong px-1 text-caption font-semibold text-white tabular-nums md:hidden"
            >
              {on}
            </span>
          ) : null}
        </Button>
      </SheetTrigger>
      <SheetContent
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          lowRef.current?.focus();
        }}
        className="inset-x-0 bottom-0 max-h-[85dvh] rounded-t-3xl bg-white data-[state=closed]:duration-200 data-[state=closed]:slide-out-to-bottom-full data-[state=open]:duration-280 data-[state=open]:slide-in-from-bottom-full md:inset-x-auto md:inset-y-0 md:right-0 md:max-h-none md:w-[400px] md:max-w-[calc(100vw-3rem)] md:rounded-none md:data-[state=closed]:slide-out-to-bottom-0 md:data-[state=closed]:slide-out-to-right-full md:data-[state=open]:slide-in-from-bottom-0 md:data-[state=open]:slide-in-from-right-full motion-reduce:data-[state=closed]:duration-120 motion-reduce:data-[state=closed]:slide-out-to-bottom-0 motion-reduce:data-[state=open]:duration-120 motion-reduce:data-[state=open]:slide-in-from-bottom-0 motion-reduce:md:data-[state=closed]:slide-out-to-right-0 motion-reduce:md:data-[state=open]:slide-in-from-right-0"
      >
        <span
          aria-hidden
          className="mx-auto mt-3 h-1 w-10 shrink-0 rounded-full bg-neutral-5 md:hidden"
        />
        <div className="flex h-16 shrink-0 items-center justify-between px-6">
          <SheetTitle className="font-heading text-title-2 text-neutral-2">Filters</SheetTitle>
          <Button
            type="button"
            variant="ghost"
            size="icon-touch"
            aria-label="Close filters"
            onClick={history.close}
            className="-mr-2 rounded-full hover:bg-neutral-7"
          >
            <X className="size-6" aria-hidden />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
          <PriceRange
            bounds={bounds}
            value={value}
            onChange={onChange}
            onDrag={setDragging}
            lowRef={lowRef}
          />
          <PricePresets bounds={bounds} value={value} onChange={onChange} />
        </div>
        <div className="flex shrink-0 gap-3 border-t border-neutral-6 px-6 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <Button type="button" variant="ghost" size="touch" onClick={onClearAll}>
            Clear all
          </Button>
          <Button type="button" size="touch" className="flex-1" onClick={history.close}>
            Show {plural(count, 'dish', 'dishes')}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
