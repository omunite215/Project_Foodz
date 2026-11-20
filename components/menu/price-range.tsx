'use client';

import { useRanger } from '@tanstack/react-ranger';
import { Check } from 'lucide-react';
import { type KeyboardEvent, type PointerEvent, type Ref, useId, useRef, useState } from 'react';
import type { PriceBounds, PriceRange as Range } from '@/lib/menu-query';
import { cn } from '@/lib/utils';

/*
 * The price filter (F3 S6.9, S7.8, design 5.5): two handles from $6 to $25 in $1 steps. TanStack
 * Ranger gives the maths and the dragging; the names, values, keys and the tap on the track are
 * ours. Matching follows a released handle or each key press; the value text follows the drag.
 */

const PAGE_STEP = 5;

/**
 * Ranger keeps its state on a mutable instance and re-renders through its own reducer, which the
 * React Compiler can't see; this wrapper reads it fresh on every render.
 */
function usePriceRanger(options: Parameters<typeof useRanger<HTMLDivElement>>[0]) {
  'use no memo';
  const ranger = useRanger<HTMLDivElement>(options);
  return {
    handles: ranger.handles(),
    dragging: ranger.tempValues,
    percent: (value: number) => ranger.getPercentageForValue(value),
    valueAt: (clientX: number) => ranger.getValueForClientX(clientX),
  };
}

export function PriceRange({
  bounds,
  value,
  onChange,
  onDrag,
  lowRef,
  inline = false,
}: {
  bounds: PriceBounds;
  value: Range;
  /** A handle released, a key pressed, the track tapped. */
  onChange: (range: Range) => void;
  /** The values while dragging (for the live count in the Filters sheet). */
  onDrag?: (range: Range | null) => void;
  lowRef?: Ref<HTMLDivElement>;
  /** In the desktop toolbar: the track row lines up with the search field. */
  inline?: boolean;
}) {
  'use no memo';
  const id = useId();
  const trackRef = useRef<HTMLDivElement>(null);
  const ranger = usePriceRanger({
    getRangerElement: () => trackRef.current,
    values: [value.min, value.max],
    min: bounds.min,
    max: bounds.max,
    stepSize: 1,
    onChange: (instance) => {
      const [low = bounds.min, high = bounds.max] = instance.sortedValues;
      onDrag?.(null);
      onChange({ min: low, max: high });
    },
    onDrag: (instance) => {
      const [low = bounds.min, high = bounds.max] = instance.tempValues ?? [];
      onDrag?.({ min: Math.min(low, high), max: Math.max(low, high) });
    },
  });

  // A change waits for the page to pass it back; key presses in the meantime build on it.
  const [sent, setSent] = useState<{ from: Range; to: Range } | null>(null);
  const waiting = sent !== null && sent.from.min === value.min && sent.from.max === value.max;
  const range = waiting && sent ? sent.to : value;

  const [shownLow = range.min, shownHigh = range.max] = ranger.dragging ?? [range.min, range.max];
  const low = Math.min(shownLow, shownHigh);
  const high = Math.max(shownLow, shownHigh);

  const move = (which: 0 | 1, next: number) => {
    const clamped =
      which === 0
        ? Math.max(bounds.min, Math.min(next, range.max))
        : Math.min(bounds.max, Math.max(next, range.min));
    const moved = which === 0 ? { min: clamped, max: range.max } : { min: range.min, max: clamped };
    if (moved.min === range.min && moved.max === range.max) return;
    setSent({ from: value, to: moved });
    onChange(moved);
  };

  const onKeyDown = (which: 0 | 1) => (event: KeyboardEvent<HTMLDivElement>) => {
    const current = which === 0 ? range.min : range.max;
    const steps: Record<string, number> = {
      ArrowLeft: -1,
      ArrowDown: -1,
      ArrowRight: 1,
      ArrowUp: 1,
      PageDown: -PAGE_STEP,
      PageUp: PAGE_STEP,
    };
    let next: number | null = null;
    if (event.key in steps) next = current + (steps[event.key] ?? 0);
    else if (event.key === 'Home') next = bounds.min;
    else if (event.key === 'End') next = bounds.max;
    if (next === null) return;
    event.preventDefault();
    move(which, next);
  };

  // A tap on the track moves the nearer handle there.
  const onTrackDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && event.target.closest('[role="slider"]')) return;
    const at = Math.round(ranger.valueAt(event.clientX));
    const which = Math.abs(at - range.min) <= Math.abs(at - range.max) ? 0 : 1;
    move(which, at);
  };

  const names = ['Lowest price', 'Highest price'] as const;
  const handleValues = [low, high];

  return (
    <fieldset aria-labelledby={`${id}-label`} className="min-w-0">
      <div className="flex items-baseline justify-between">
        <span id={`${id}-label`} className="text-body-4 text-neutral-3">
          Price
        </span>
        <span aria-hidden className="text-body-4 font-medium text-neutral-1 tabular-nums">
          ${low} – ${high}
        </span>
      </div>
      <div
        ref={trackRef}
        onPointerDown={onTrackDown}
        className={cn('relative mt-3 touch-none', inline ? 'h-11 lg:mt-2 lg:h-15' : 'h-11')}
      >
        <span
          aria-hidden
          className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-neutral-6"
        />
        <span
          aria-hidden
          className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-brand-strong"
          style={{
            left: `${ranger.percent(low)}%`,
            width: `${ranger.percent(high) - ranger.percent(low)}%`,
          }}
        />
        {ranger.handles.map((handle, index) => {
          const which = index === 0 ? 0 : 1;
          const shown = handleValues[which] ?? handle.value;
          return (
            <div
              key={names[which]}
              ref={which === 0 ? lowRef : undefined}
              // Two handles on one track: a native range input has one.
              // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
              role="slider"
              tabIndex={0}
              aria-label={names[which]}
              aria-valuemin={which === 0 ? bounds.min : range.min}
              aria-valuemax={which === 0 ? range.max : bounds.max}
              aria-valuenow={which === 0 ? range.min : range.max}
              aria-valuetext={`$${which === 0 ? range.min : range.max}`}
              onKeyDown={onKeyDown(which)}
              onMouseDown={handle.onMouseDownHandler}
              onTouchStart={handle.onTouchStart}
              style={{ left: `${ranger.percent(shown)}%` }}
              className={cn(
                'absolute top-1/2 size-6 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border-2 border-brand-strong bg-white shadow-card outline-none before:absolute before:-inset-2.5 before:content-[""] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid',
                handle.isActive && 'cursor-grabbing motion-safe:scale-110',
              )}
            />
          );
        })}
      </div>
    </fieldset>
  );
}

/** Exact values without fine dragging (B12): "Under $10", "Under $15", "Under $20". */
export function PricePresets({
  bounds,
  value,
  onChange,
}: {
  bounds: PriceBounds;
  value: Range;
  onChange: (range: Range) => void;
}) {
  const presets = [10, 15, 20].filter((top) => top > bounds.min && top < bounds.max);
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {presets.map((top) => {
        const pressed = value.min === bounds.min && value.max === top;
        return (
          <button
            key={top}
            type="button"
            aria-pressed={pressed}
            onClick={() =>
              onChange(
                pressed ? { min: bounds.min, max: bounds.max } : { min: bounds.min, max: top },
              )
            }
            className={cn(
              'inline-flex h-11 items-center gap-2 rounded-lg border border-input bg-white px-4 text-body-5 text-neutral-2 outline-none hover:bg-neutral-7 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid',
              pressed &&
                'border-2 border-brand-strong bg-brand-soft text-neutral-1 hover:bg-brand-soft',
            )}
          >
            {pressed ? <Check className="size-4" aria-hidden /> : null}
            Under ${top}
          </button>
        );
      })}
    </div>
  );
}
