'use client';

import { Check } from 'lucide-react';
import { useId } from 'react';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { MAX_FLAVORS } from '@/lib/data/cart';
import { cn } from '@/lib/utils';

/**
 * "Extra flavor" (F1 design 5.3): the dish's own flavors as 44 px toggles that wrap, at most 5.
 * Used on the dish page and in the cart's line editor.
 */
export function FlavorToggles({
  flavors,
  value,
  onChange,
  disabled = false,
  titleAs: Title = 'h2',
  className,
}: {
  /** What the dish offers. */
  flavors: readonly string[];
  value: readonly string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
  /** A heading on the dish page; plain text inside the cart, where it would break the outline. */
  titleAs?: 'h2' | 'p';
  className?: string;
}) {
  const id = useId();
  const full = value.length >= MAX_FLAVORS;
  if (flavors.length === 0) return null;

  return (
    <div className={className}>
      <Title id={`${id}-title`} className="text-body-4 text-neutral-3">
        Extra flavor
      </Title>
      <p id={`${id}-help`} className="text-body-5 text-muted-foreground">
        {full ? 'You can pick up to 5.' : 'Optional. Pick what you’d like more of (up to 5).'}
      </p>
      <ToggleGroup
        type="multiple"
        value={[...value]}
        onValueChange={(next) => onChange(next.slice(0, MAX_FLAVORS))}
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-help`}
        disabled={disabled}
        className="mt-2 w-full flex-wrap justify-start"
      >
        {flavors.map((flavor) => {
          const on = value.includes(flavor);
          return (
            <ToggleGroupItem
              key={flavor}
              value={flavor}
              disabled={disabled || (full && !on)}
              className={cn(
                'h-11 rounded-lg border border-input bg-white px-4 text-body-5 font-normal text-neutral-2 hover:bg-neutral-7 aria-pressed:border-2 aria-pressed:border-brand-strong aria-pressed:bg-brand-soft aria-pressed:text-neutral-1 data-[state=on]:bg-brand-soft',
              )}
            >
              {on ? <Check className="size-4" aria-hidden /> : null}
              {flavor}
            </ToggleGroupItem>
          );
        })}
      </ToggleGroup>
    </div>
  );
}
