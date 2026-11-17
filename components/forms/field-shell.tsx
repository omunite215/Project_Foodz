import { Check } from 'lucide-react';
import type { ReactNode } from 'react';
import { FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { cn } from '@/lib/utils';

/** What a control needs to be tied to its label, hint and error. */
export interface FieldControlProps {
  id: string;
  'aria-invalid'?: true;
  'aria-describedby'?: string;
}

/** The first message from a validator's errors (strings or `{ message }` objects). */
export function errorText(errors: readonly unknown[]): string | null {
  for (const error of errors) {
    if (typeof error === 'string') return error;
    if (error && typeof error === 'object' && 'message' in error) {
      const { message } = error;
      if (typeof message === 'string') return message;
    }
  }
  return null;
}

/**
 * The error a field shows: checked when the person leaves it, then as they type once it has an
 * error, and every field once the form was submitted (design 2.6).
 */
export function visibleError(
  meta: { isBlurred: boolean; errors: readonly unknown[] },
  submitted: boolean,
  serverError?: string | null,
): string | null {
  const client = meta.isBlurred || submitted ? errorText(meta.errors) : null;
  return client ?? serverError ?? null;
}

/**
 * One field (design 2.1): a visible label, the control 8 px below, the hint and the error in
 * words. The control is described by the hint first, then the error, and is marked invalid only
 * while an error shows.
 */
export function FieldShell({
  id,
  label,
  optional = false,
  hint,
  error,
  more,
  className,
  labelClassName,
  children,
}: {
  id: string;
  label: ReactNode;
  optional?: boolean;
  hint?: ReactNode;
  error?: string | null;
  /** Under the field, after the hint and error: links like "Forgot password?". */
  more?: ReactNode;
  className?: string;
  labelClassName?: string;
  children: (control: FieldControlProps) => ReactNode;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={className}>
      <FieldLabel htmlFor={id} className={labelClassName}>
        {label}
        {optional ? <span className="text-muted-foreground"> (optional)</span> : null}
      </FieldLabel>
      <div className="mt-2">
        {children({
          id,
          ...(error ? { 'aria-invalid': true as const } : {}),
          ...(describedBy ? { 'aria-describedby': describedBy } : {}),
        })}
      </div>
      {hint ? <FieldDescription id={hintId}>{hint}</FieldDescription> : null}
      <FieldError id={errorId}>{error}</FieldError>
      {more}
    </div>
  );
}

/** "At least 10 characters", which turns green with a tick once it is met (design 2.3). */
export function NewPasswordHint({ length, className }: { length: number; className?: string }) {
  const met = length >= 10;
  return (
    <span className={cn('inline-flex items-center gap-1.5', met && 'text-brand-strong', className)}>
      {met ? <Check className="size-4" aria-hidden /> : null}
      At least 10 characters
    </span>
  );
}

/**
 * A field's blur handler that skips the check when focus is moving to this form's submit button.
 * An error appearing then would push the button down between press and release, and the press
 * would be lost; the submit checks every field anyway.
 */
export function blurField(handleBlur: () => void) {
  return (event: { relatedTarget: EventTarget | null; currentTarget: Element }) => {
    const next = event.relatedTarget;
    const form = event.currentTarget.closest('form');
    if (next instanceof HTMLButtonElement && next.type === 'submit' && form && next.form === form) {
      return;
    }
    handleBlur();
  };
}
