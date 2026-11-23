import { Check, type LucideIcon } from 'lucide-react';
import type { ReactNode, Ref } from 'react';
import { cn } from '@/lib/utils';

/*
 * One choice in a group of cards (F4 design 2.7, D8): addresses, payment methods and saved cards.
 * A native radio carries the state, so a group is one Tab stop with arrow keys inside it. The
 * chosen card shows a 2 px border, a tint and a filled check: never colour alone (S13.3).
 */

export interface RadioCardProps {
  name: string;
  value: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: string) => void;
  /** The full spoken reading, when the visible text alone would read badly. */
  label?: string;
  describedBy?: string;
  icon?: LucideIcon;
  /** Right-hand column (fee and distance). */
  aside?: ReactNode;
  /** A row under the label, inside the same card (instructions and Edit on the chosen address). */
  extra?: ReactNode;
  /** Beside the label, never inside it (Remove on an expired card). */
  beside?: ReactNode;
  inputRef?: Ref<HTMLInputElement>;
  className?: string;
  labelClassName?: string;
  children: ReactNode;
}

export function RadioCard({
  name,
  value,
  checked,
  disabled = false,
  onChange,
  label,
  describedBy,
  icon: Icon,
  aside,
  extra,
  beside,
  inputRef,
  className,
  labelClassName,
  children,
}: RadioCardProps) {
  return (
    <div
      data-radio-card
      className={cn(
        'group/card rounded-xl border border-neutral-6 bg-white hover:border-neutral-5',
        'has-[input:checked]:border-2 has-[input:checked]:border-brand-strong has-[input:checked]:bg-brand-soft',
        'has-[input:disabled]:bg-neutral-7 has-[input:disabled]:hover:border-neutral-6',
        beside && 'flex items-center',
        className,
      )}
    >
      <label
        className={cn(
          'flex min-h-16 min-w-0 flex-1 cursor-pointer items-start gap-3 rounded-xl p-4 group-has-[input:checked]/card:p-[15px]',
          'has-[input:disabled]:cursor-not-allowed',
          'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring has-[:focus-visible]:outline-solid',
          labelClassName,
        )}
      >
        <input
          ref={inputRef}
          type="radio"
          name={name}
          value={value}
          checked={checked}
          disabled={disabled}
          aria-label={label}
          aria-describedby={describedBy}
          onChange={() => onChange(value)}
          className="peer sr-only"
        />
        <span
          aria-hidden
          className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-2 border-input bg-white peer-checked:border-brand-strong peer-checked:bg-brand-strong peer-disabled:border-neutral-5 [&>svg]:hidden peer-checked:[&>svg]:block"
        >
          <Check className="size-3 text-white" strokeWidth={3} />
        </span>
        {Icon ? (
          <span
            aria-hidden
            className="hidden size-10 shrink-0 items-center justify-center rounded-full bg-neutral-7 group-has-[input:checked]/card:bg-white min-[400px]:flex"
          >
            <Icon className="size-5 text-neutral-2" />
          </span>
        ) : null}
        <span className="min-w-0 flex-1">{children}</span>
        {aside ? <span className="shrink-0 text-right">{aside}</span> : null}
      </label>
      {beside}
      {extra}
    </div>
  );
}
