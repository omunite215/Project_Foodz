'use client';

import { type RefObject, useId } from 'react';
import { FieldError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

/*
 * The step-up code (F5 design 3.3 step 4, A7.10): asked before a cancellation gives money back
 * after the kitchen accepted, at most every 10 minutes. F2's code field, with the swap to a
 * backup code.
 */

export type StepUpMethod = 'totp' | 'backup';

const REFUND_HINT = 'We ask for a code before giving money back, at most every 10 minutes.';

export function StepUpField({
  method,
  value,
  error,
  disabled,
  inputRef,
  onChange,
  onSwap,
  hint = REFUND_HINT,
}: {
  method: StepUpMethod;
  value: string;
  error: string | null;
  /** Locked after five wrong codes. */
  disabled: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  onChange: (value: string) => void;
  onSwap: () => void;
  /** Why a code is asked for here; the board's refund wording by default. */
  hint?: string;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = error ? `${id}-error` : undefined;
  const totp = method === 'totp';
  return (
    <div>
      <label htmlFor={id} className="block text-body-4 font-medium text-neutral-1">
        {totp ? '6-digit code from your authenticator app' : 'Backup code'}
      </label>
      <Input
        ref={inputRef}
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete="one-time-code"
        inputMode={totp ? 'numeric' : 'text'}
        maxLength={totp ? 9 : 32}
        disabled={disabled}
        data-select-on-focus=""
        aria-invalid={error ? true : undefined}
        aria-describedby={[hintId, errorId].filter(Boolean).join(' ')}
        className="mt-2 h-14 text-center text-title-2 font-medium tracking-[0.35em] tabular-nums md:max-w-[320px]"
      />
      <p id={hintId} className="mt-2 text-body-5 text-muted-foreground">
        {hint}
      </p>
      <FieldError id={errorId}>{error}</FieldError>
      <button
        type="button"
        onClick={onSwap}
        disabled={disabled}
        className="mt-2 inline-flex min-h-11 items-center text-body-5 font-medium text-neutral-1 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid disabled:text-neutral-3"
      >
        {totp ? 'Use a backup code instead' : 'Use your authenticator app instead'}
      </button>
    </div>
  );
}
