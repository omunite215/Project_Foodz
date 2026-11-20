'use client';

import { type Ref, useId } from 'react';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { MAX_NOTE_LENGTH } from '@/lib/data/cart';
import { cn } from '@/lib/utils';

/**
 * "Note for the kitchen" (F1 design 5.3): up to 200 characters with a visible count, and a quiet
 * "20 characters left" for screen readers near the end. Used on the dish page and in the cart.
 */
export function KitchenNote({
  value,
  onChange,
  disabled = false,
  placeholder,
  className,
  textareaClassName,
  textareaRef,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  textareaClassName?: string;
  textareaRef?: Ref<HTMLTextAreaElement>;
}) {
  const id = useId();
  const charactersLeft = MAX_NOTE_LENGTH - value.length;
  return (
    <div className={className}>
      <Label htmlFor={`${id}-note`} className="text-body-4 font-normal text-neutral-3">
        Note for the kitchen
      </Label>
      <Textarea
        ref={textareaRef}
        id={`${id}-note`}
        value={value}
        maxLength={MAX_NOTE_LENGTH}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          'mt-1 rounded-xl bg-white px-5 py-2.5 text-body-4 disabled:bg-neutral-7 md:text-body-4',
          textareaClassName,
        )}
      />
      <p aria-hidden className="mt-1 text-right text-caption text-muted-foreground tabular-nums">
        {value.length}/{MAX_NOTE_LENGTH}
      </p>
      <p aria-live="polite" className="sr-only">
        {charactersLeft <= 20 ? `${charactersLeft} characters left` : ''}
      </p>
    </div>
  );
}
