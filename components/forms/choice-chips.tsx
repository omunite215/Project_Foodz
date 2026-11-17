import { Check, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { FieldLegend, FieldSet } from '@/components/ui/field';

export interface Choice<T extends string> {
  value: T;
  label: string;
  icon: LucideIcon;
}

/**
 * Chips on native radios (design 2.7): one Tab stop, arrow keys move, and they work before the
 * page's scripts load. The chosen chip gets a thicker border, a tint and a tick, so colour is
 * never the only cue.
 */
export function ChoiceChips<T extends string>({
  name,
  legend,
  choices,
  value,
  onChange,
  children,
}: {
  name: string;
  legend: string;
  choices: readonly Choice<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Shown under the chips (a field the choice reveals). */
  children?: ReactNode;
}) {
  return (
    <FieldSet>
      <FieldLegend>{legend}</FieldLegend>
      <div className="mt-2 flex flex-wrap gap-2">
        {choices.map((choice) => {
          const Icon = choice.icon;
          return (
            <label
              key={choice.value}
              className="group relative inline-flex h-11 cursor-pointer items-center gap-2 rounded-lg border border-input bg-white px-4 text-body-4 text-neutral-2 has-[:checked]:border-2 has-[:checked]:border-brand-strong has-[:checked]:bg-brand-soft has-[:checked]:px-[15px] has-[:checked]:text-neutral-1 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring has-[:focus-visible]:outline-solid"
            >
              <input
                type="radio"
                name={name}
                value={choice.value}
                checked={value === choice.value}
                onChange={() => onChange(choice.value)}
                className="sr-only"
              />
              <Icon className="size-4" aria-hidden />
              {choice.label}
              <Check
                className="hidden size-4 text-brand-strong group-has-[:checked]:block"
                aria-hidden
              />
            </label>
          );
        })}
      </div>
      {children}
    </FieldSet>
  );
}

/** A native checkbox in a full-width 44 px row (design 2.7). */
export function CheckboxRow({
  id,
  label,
  checked,
  disabled,
  onChange,
  describedBy,
}: {
  id: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  describedBy?: string;
}) {
  return (
    <label
      htmlFor={id}
      className="flex min-h-11 cursor-pointer items-center gap-3 text-body-4 text-neutral-2 has-[:disabled]:cursor-not-allowed"
    >
      <span className="relative flex size-5 shrink-0">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.checked)}
          className="peer size-5 shrink-0 cursor-pointer appearance-none rounded-md border-2 border-input bg-white checked:border-brand-strong checked:bg-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid disabled:cursor-not-allowed disabled:border-neutral-6 disabled:bg-neutral-7 disabled:checked:border-neutral-4 disabled:checked:bg-neutral-4"
        />
        <Check
          className="pointer-events-none absolute inset-0.5 hidden size-3.5 text-white peer-checked:block"
          strokeWidth={3}
          aria-hidden
        />
      </span>
      {label}
    </label>
  );
}
