'use client';

import { Ban, Check, CircleExclamationPoint, Search } from 'lucide-react';
import { type FormEvent, type ReactNode, useId, useRef, useState } from 'react';
import { normalizeOrderNumber } from '@/server/modules/board/schema';
import { useSlowPending } from '@/components/forms/submit-button';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Toggle } from '@/components/ui/toggle';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { announce } from '@/lib/announce';
import type { BoardFilters } from '@/lib/board/model';
import { cn } from '@/lib/utils';

/*
 * The board's toolbar (F5 design 2.2): Find order, the filter chips, "Clear filters" and the
 * "Sold out" button with its count. It wraps into rows on phones; at base the store chip and
 * "Keep screen on" come first.
 */

const CHIP =
  'h-12 gap-1.5 rounded-full border border-input bg-white px-4 text-body-5 font-medium text-neutral-2 hover:bg-neutral-7 data-[state=on]:border-2 data-[state=on]:border-brand-strong data-[state=on]:bg-brand-soft data-[state=on]:px-[15px] data-[state=on]:text-neutral-1';

function ChipCheck() {
  return (
    <Check
      className="hidden size-4 text-brand-strong group-data-[state=on]/toggle:block"
      aria-hidden
    />
  );
}

export type FindOutcome =
  | { kind: 'shown' }
  | { kind: 'none'; message: string }
  | { kind: 'error'; message: string };

/** "Find order" (A11.1): "1042", "#1042" and " s1101 " all work. */
export function FindOrder({
  onFind,
  offline,
}: {
  onFind: (number: string) => Promise<FindOutcome>;
  offline: boolean;
}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  const [bubble, setBubble] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const slow = useSlowPending(pending);
  const bubbleId = `${id}-bubble`;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    if (offline) {
      setBubble("You're offline.");
      announce("You're offline.");
      return;
    }
    const number = normalizeOrderNumber(value);
    if (!number) {
      const message = 'Enter an order number, like 1042.';
      setBubble(message);
      announce(message);
      return;
    }
    setPending(true);
    const outcome = await onFind(number);
    setPending(false);
    if (outcome.kind === 'shown') {
      setBubble(null);
      return;
    }
    setBubble(outcome.message);
    announce(outcome.message);
  }

  return (
    <search className="relative flex flex-wrap max-md:w-full">
      <form
        noValidate
        onSubmit={(event) => void submit(event)}
        className="flex items-center gap-2 max-md:w-full max-md:flex-wrap"
      >
        <label
          htmlFor={`${id}-input`}
          className="text-body-5 font-medium whitespace-nowrap text-neutral-2"
        >
          Find order
        </label>
        <input
          ref={inputRef}
          id={`${id}-input`}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setBubble(null);
          }}
          inputMode="text"
          autoComplete="off"
          enterKeyHint="search"
          spellCheck={false}
          placeholder="1042"
          aria-describedby={bubble ? bubbleId : undefined}
          aria-invalid={bubble ? true : undefined}
          className="h-12 w-36 min-w-0 rounded-lg border border-input bg-white px-3 text-body-4 text-neutral-1 tabular-nums placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid max-md:flex-1 lg:w-40"
        />
        <Button type="submit" variant="outline" size="icon-kitchen" aria-label="Find">
          {slow ? (
            <Spinner className="size-5 motion-reduce:animate-none" />
          ) : (
            <Search className="size-5" aria-hidden />
          )}
        </Button>
        {bubble ? (
          <p
            id={bubbleId}
            className="absolute top-full left-0 z-20 mt-1 flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-body-5 text-neutral-1 shadow-raised max-md:relative max-md:top-auto max-md:w-full max-md:shadow-none"
          >
            <CircleExclamationPoint className="size-4 shrink-0 text-destructive" aria-hidden />
            {bubble}
          </p>
        ) : null}
      </form>
    </search>
  );
}

export function BoardFiltersBar({
  filters,
  onChange,
}: {
  filters: BoardFilters;
  onChange: (filters: BoardFilters) => void;
}) {
  const active = filters.late || filters.pay !== null;
  return (
    <>
      <Toggle
        pressed={filters.late}
        onPressedChange={(late) => onChange({ ...filters, late })}
        className={CHIP}
      >
        <ChipCheck />
        Late only
      </Toggle>
      <ToggleGroup
        type="single"
        aria-label="Payment"
        value={filters.pay ?? ''}
        onValueChange={(value) =>
          onChange({ ...filters, pay: value === 'cash' || value === 'card' ? value : null })
        }
        className="gap-2"
      >
        <ToggleGroupItem value="cash" className={CHIP}>
          <ChipCheck />
          Cash
        </ToggleGroupItem>
        <ToggleGroupItem value="card" className={CHIP}>
          <ChipCheck />
          Card
        </ToggleGroupItem>
      </ToggleGroup>
      {active ? (
        <Button
          type="button"
          variant="ghost"
          size="kitchen"
          onClick={() => onChange({ late: false, pay: null })}
          className="text-button-2 underline underline-offset-4"
        >
          Clear filters
        </Button>
      ) : null}
    </>
  );
}

/** "Sold out" with its count (KITCHEN, ADMIN, demo): opens the dish availability sheet. */
export function SoldOutButton({ count, onOpen }: { count: number; onOpen: () => void }) {
  return (
    <Button type="button" variant="outline" size="kitchen" onClick={onOpen} className="md:ml-auto">
      <Ban className="size-5" aria-hidden />
      {/* Named from its text, which holds the visible words: "Sold out dishes, 2". */}
      Sold out<span className="sr-only"> dishes{count > 0 ? ',' : ''}</span>
      {count > 0 ? (
        <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-md bg-tag-4-bg px-1.5 text-caption font-semibold text-neutral-1 tabular-nums">
          {count}
        </span>
      ) : null}
    </Button>
  );
}

export function BoardToolbar({
  phoneRow,
  children,
  className,
}: {
  /** At base only: the store chip and "Keep screen on" first (design 2.2). */
  phoneRow?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex min-h-16 flex-wrap items-center gap-2 px-4 py-2 lg:gap-3 lg:px-6',
        className,
      )}
    >
      {phoneRow ? (
        <div className="flex w-full flex-wrap items-center gap-2 md:hidden">{phoneRow}</div>
      ) : null}
      {children}
    </div>
  );
}
