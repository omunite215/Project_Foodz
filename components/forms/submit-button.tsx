'use client';

import { type ComponentProps, type ReactNode, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useHydrated } from '@/lib/use-hydrated';
import { cn } from '@/lib/utils';

/**
 * How a control that can't be used right now looks (design 2.5): never like an active one. The
 * same grey as a sold-out dish's button. Its reason is shown nearby.
 */
export const BLOCKED_BUTTON_CLASS =
  'cursor-not-allowed border-neutral-6 bg-neutral-6 text-neutral-3 hover:bg-neutral-6 hover:text-neutral-3';

/** Pending labels appear only once a request has taken this long, so quick answers never flash. */
export const PENDING_LABEL_DELAY_MS = 300;

/** True once `pending` has lasted `delay` ms; false again as soon as it ends. */
export function useSlowPending(pending: boolean, delay = PENDING_LABEL_DELAY_MS) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!pending) return undefined;
    const timer = setTimeout(() => setSlow(true), delay);
    return () => {
      clearTimeout(timer);
      setSlow(false);
    };
  }, [pending, delay]);
  return pending && slow;
}

/**
 * A submit button that never sends twice (design 2.5): while pending, or while blocked for a
 * reason shown nearby, it is aria-disabled (it stays focusable and in the tab order) and ignores
 * presses. After 300 ms of waiting it shows a spinner and its pending label; while blocked it
 * is grey.
 *
 * Its forms are sent by the page's scripts. Until they run, a submit button is disabled, so a
 * press (or Enter in a field) on a page that is still loading never sends the form the browser's
 * own way, with what was typed in the address. It keeps its look meanwhile, so nothing flickers.
 */
export function SubmitButton({
  pending,
  pendingLabel,
  blocked = false,
  onBlockedPress,
  children,
  className,
  onClick,
  type = 'submit',
  ...props
}: Omit<ComponentProps<typeof Button>, 'disabled'> & {
  pending: boolean;
  pendingLabel: ReactNode;
  /** Can't be used right now; pass the reason's id as aria-describedby. */
  blocked?: boolean;
  /** A press while blocked (to repeat the reason aloud). */
  onBlockedPress?: () => void;
}) {
  const slow = useSlowPending(pending);
  const hydrated = useHydrated();
  const inactive = pending || blocked;
  const loading = type === 'submit' && !hydrated;

  return (
    <Button
      type={type}
      size="touch"
      disabled={loading || undefined}
      aria-disabled={inactive || undefined}
      onClick={(event) => {
        if (inactive) {
          event.preventDefault();
          if (blocked && !pending) onBlockedPress?.();
          return;
        }
        onClick?.(event);
      }}
      // The blocked look comes after the caller's classes, so it wins over their colours.
      className={cn(
        inactive && 'cursor-not-allowed',
        loading && 'disabled:opacity-100',
        className,
        blocked && !pending && BLOCKED_BUTTON_CLASS,
      )}
      {...props}
    >
      {slow ? (
        <>
          <Spinner aria-hidden />
          {pendingLabel}
        </>
      ) : (
        children
      )}
    </Button>
  );
}
