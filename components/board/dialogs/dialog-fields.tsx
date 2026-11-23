'use client';

import { Check, Info } from 'lucide-react';
import { type ReactNode, useId } from 'react';
import type { z } from 'zod';
import type { BoardCardLine } from '@/server/modules/board/schema';
import { STAFF_NOTE_MAX } from '@/server/modules/board/schema';
import { FieldError, FieldLegend, FieldSet } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { dishChoiceLabels } from '@/lib/board/text';
import { cn } from '@/lib/utils';

/*
 * The fields the board's dialogs share (F5 design 3.1): reasons as a native radio fieldset,
 * dish ticks and plain tick boxes in 48 px rows, the note for staff with its counter, and the
 * "what will happen" box. Errors show under their field in words; the first invalid field
 * takes focus on submit.
 */

/**
 * Field errors from the module's zod schema for a form's values: `{ reason: "Choose a
 * reason." }`, one message per field (the first), for TanStack Form's form-level validator.
 */
export function zodFieldErrors(schema: z.ZodType, value: unknown): Record<string, string> | null {
  const result = schema.safeParse(value);
  if (result.success) return null;
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = String(issue.path[0] ?? '');
    if (key && !(key in fields)) fields[key] = issue.message;
  }
  return Object.keys(fields).length ? fields : null;
}

/**
 * After a submit with problems: the first invalid field takes focus (A6.3). Radios carry
 * `data-invalid`, since `aria-invalid` isn't allowed on a radio; their fieldset is described by
 * the error.
 */
export function focusFirstProblem(form: HTMLFormElement | null, frames = 10) {
  requestAnimationFrame(() => {
    const field = form?.querySelector<HTMLElement>('[aria-invalid="true"], [data-invalid="true"]');
    if (field) field.focus();
    else if (frames > 0) focusFirstProblem(form, frames - 1);
  });
}

export function ReasonFieldset<T extends string>({
  name,
  legend = 'Reason',
  reasons,
  labels,
  value,
  error,
  onChange,
  renderAfter,
}: {
  name: string;
  legend?: string;
  reasons: readonly T[];
  labels: Record<T, string>;
  /** The chosen reason, or '' before one is chosen. */
  value: string;
  error: string | null;
  onChange: (value: T) => void;
  /** Shown right under a reason when it is chosen (the dish ticks under "A dish is unavailable"). */
  renderAfter?: (reason: T) => ReactNode;
}) {
  const id = useId();
  const errorId = error ? `${id}-error` : undefined;
  return (
    <FieldSet aria-describedby={errorId}>
      <FieldLegend className="text-body-4 font-medium text-neutral-1">{legend}</FieldLegend>
      <div className="mt-2 space-y-1">
        {reasons.map((reason, index) => (
          <div key={reason}>
            <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg px-3 text-body-4 text-neutral-1 has-[:checked]:bg-brand-soft has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring has-[:focus-visible]:outline-solid">
              <input
                type="radio"
                name={name}
                value={reason}
                checked={value === reason}
                onChange={() => onChange(reason)}
                data-invalid={error && index === 0 ? 'true' : undefined}
                className="size-5 shrink-0 accent-brand-strong outline-none"
              />
              {labels[reason]}
            </label>
            {value === reason ? renderAfter?.(reason) : null}
          </div>
        ))}
      </div>
      <FieldError id={errorId}>{error}</FieldError>
    </FieldSet>
  );
}

/** A native tick box in a 48 px row. */
export function TickRow({
  id,
  checked,
  onChange,
  invalid,
  describedBy,
  children,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  invalid?: boolean;
  describedBy?: string;
  children: ReactNode;
}) {
  return (
    <label
      htmlFor={id}
      className="flex min-h-12 cursor-pointer items-center gap-3 text-body-4 text-neutral-1"
    >
      <span className="relative flex size-5 shrink-0">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className="peer size-5 shrink-0 cursor-pointer appearance-none rounded-md border-2 border-input bg-white checked:border-brand-strong checked:bg-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid aria-invalid:border-destructive"
        />
        <Check
          className="pointer-events-none absolute inset-0.5 hidden size-3.5 text-white peer-checked:block"
          strokeWidth={3}
          aria-hidden
        />
      </span>
      <span className="min-w-0 [overflow-wrap:anywhere]">{children}</span>
    </label>
  );
}

/** "Which dishes?" under "A dish is unavailable" (design 3.2 step 2). */
export function DishTicks({
  lines,
  value,
  error,
  onChange,
}: {
  lines: readonly BoardCardLine[];
  value: readonly string[];
  error: string | null;
  onChange: (lineIds: string[]) => void;
}) {
  const id = useId();
  const labels = dishChoiceLabels(lines);
  const errorId = error ? `${id}-error` : undefined;
  return (
    <FieldSet className="pt-1 pl-8" aria-describedby={errorId}>
      <FieldLegend className="text-body-5 font-medium text-neutral-2">Which dishes?</FieldLegend>
      <div className="mt-1">
        {lines.map((line, index) => (
          <TickRow
            key={line.id}
            id={`${id}-${line.id}`}
            checked={value.includes(line.id)}
            invalid={Boolean(error) && index === 0}
            onChange={(checked) =>
              onChange(checked ? [...value, line.id] : value.filter((item) => item !== line.id))
            }
          >
            {labels.get(line.id)}
            {line.soldOut ? (
              <span className="ml-2 inline-flex h-6 items-center rounded-md bg-tag-4-bg px-2 align-middle text-caption font-medium">
                Already sold out
              </span>
            ) : null}
          </TickRow>
        ))}
      </div>
      <FieldError id={errorId}>{error}</FieldError>
    </FieldSet>
  );
}

/** "Note for staff (optional)", required for "Other" (design 3.1). */
export function StaffNoteField({
  required,
  value,
  error,
  onChange,
  onBlur,
}: {
  required: boolean;
  value: string;
  error: string | null;
  onChange: (value: string) => void;
  onBlur: () => void;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div>
      <label htmlFor={id} className="block text-body-4 font-medium text-neutral-1">
        {required ? 'Note for staff' : 'Note for staff (optional)'}
      </label>
      <Textarea
        id={id}
        value={value}
        rows={3}
        maxLength={STAFF_NOTE_MAX * 2}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        aria-invalid={error ? true : undefined}
        aria-describedby={[hintId, errorId].filter(Boolean).join(' ')}
        className="mt-2 max-h-[9.5rem] min-h-[5.25rem] rounded-xl bg-white px-4 py-3 text-body-4 text-neutral-1"
      />
      <div className="mt-2 flex items-start justify-between gap-3">
        <p id={hintId} className="text-body-5 text-muted-foreground">
          Only staff see this note.
        </p>
        <span
          aria-hidden
          className={cn(
            'text-caption tabular-nums',
            value.length > STAFF_NOTE_MAX ? 'text-destructive' : 'text-neutral-3',
          )}
        >
          {value.length}/{STAFF_NOTE_MAX}
        </span>
      </div>
      <FieldError id={errorId}>{error}</FieldError>
    </div>
  );
}

/** The grey "what will happen" box. */
export function OutcomeBox({ lines }: { lines: readonly string[] }) {
  return (
    <div className="flex gap-2 rounded-xl bg-neutral-7 p-4 text-body-5 text-neutral-1">
      <Info className="mt-0.5 size-4 shrink-0 text-neutral-3" aria-hidden />
      {lines.length === 1 ? (
        <p>{lines[0]}</p>
      ) : (
        <ul className="space-y-1.5">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
