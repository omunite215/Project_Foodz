'use client';

import { Check } from 'lucide-react';
import { type ReactNode, useRef } from 'react';
import { useMotion } from '@/lib/motion';
import { cn } from '@/lib/utils';

/**
 * A reserved one-line slot under a button for its result ("Saved", "Sent…"), so nothing jumps
 * when it fills (design States). A success tick pops in; under reduced motion it simply appears.
 * The words are announced by the caller.
 */
export function StatusLine({
  tone,
  children,
  id,
  className,
}: {
  tone?: 'success' | 'error' | 'neutral' | null;
  children?: ReactNode;
  id?: string;
  className?: string;
}) {
  const ref = useRef<HTMLParagraphElement>(null);
  const success = tone === 'success' && Boolean(children);

  useMotion(
    (motion) => {
      if (!success || motion.reduced) return;
      motion.fromTo(
        '[data-status-check]',
        { scale: 0.6, opacity: 0 },
        { scale: 1, opacity: 1, duration: 0.25, ease: 'back.out(2)' },
      );
    },
    { scope: ref, dependencies: [success, children] },
  );

  return (
    <p
      ref={ref}
      id={id}
      className={cn(
        'mt-3 flex min-h-6 items-start gap-1.5 text-body-5',
        tone === 'error'
          ? 'text-destructive'
          : tone === 'success'
            ? 'text-neutral-2'
            : 'text-neutral-3',
        className,
      )}
    >
      {success ? (
        <Check data-status-check className="mt-0.5 size-4 shrink-0 text-brand-strong" aria-hidden />
      ) : null}
      {children}
    </p>
  );
}
