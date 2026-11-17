'use client';

import { type ComponentProps, type ReactNode, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

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
 * presses. After 300 ms of waiting it shows a spinner and its pending label.
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
  const inactive = pending || blocked;

  return (
    <Button
      type={type}
      size="touch"
      aria-disabled={inactive || undefined}
      onClick={(event) => {
        if (inactive) {
          event.preventDefault();
          if (blocked && !pending) onBlockedPress?.();
          return;
        }
        onClick?.(event);
      }}
      className={cn(inactive && 'cursor-not-allowed', className)}
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
