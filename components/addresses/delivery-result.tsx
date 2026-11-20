'use client';

import { Bike, CircleCheck, CircleExclamationPoint, MapPinOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useMotion } from '@/lib/motion';
import { cn } from '@/lib/utils';

export type DeliveryState =
  | { kind: 'idle' }
  /** `check` numbers each request, so a new one waits its own 150 ms. */
  | { kind: 'checking'; check: number }
  | { kind: 'inside'; text: string }
  | { kind: 'outside'; text: string }
  | { kind: 'failed' };

export const DELIVERY_RESULT_ID = 'delivery-result';
export const CHECK_FAILED_TEXT = "We couldn't check delivery for this address.";

const LOOKS = {
  idle: 'bg-neutral-7',
  checking: 'bg-neutral-7',
  inside: 'bg-brand-soft',
  outside: 'bg-tag-6-bg',
  failed: 'bg-tag-4-bg',
} as const;

/**
 * Whether we deliver to the picked point (S4.6, design 5.7), decided by the server. The box is
 * reserved from the start, so it never pops in; "Checking delivery…" shows only after 150 ms.
 */
export function DeliveryResult({
  state,
  onTryAnother,
  onRetry,
}: {
  state: DeliveryState;
  onTryAnother: () => void;
  onRetry: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // The check (by its number) that has been running long enough to say so.
  const [slowCheck, setSlowCheck] = useState<number | null>(null);

  useEffect(() => {
    if (state.kind !== 'checking') return undefined;
    const { check } = state;
    const timer = setTimeout(() => setSlowCheck(check), 150);
    return () => clearTimeout(timer);
  }, [state]);

  useMotion(
    (motion) => {
      if (!ref.current || motion.reduced) return;
      if (state.kind === 'inside' || state.kind === 'outside' || state.kind === 'failed') {
        motion.from(ref.current.querySelector('[data-result-text]'), {
          opacity: 0,
          duration: 0.2,
          ease: 'power2.out',
        });
      }
    },
    { scope: ref, dependencies: [state] },
  );

  // While checking but before 150 ms, keep showing the idle words.
  const kind = state.kind === 'checking' && slowCheck !== state.check ? 'idle' : state.kind;

  return (
    <div
      ref={ref}
      id={DELIVERY_RESULT_ID}
      className={cn(
        'flex min-h-14 items-start gap-3 rounded-xl p-4 text-body-4 transition-colors duration-200 motion-reduce:transition-none',
        LOOKS[kind],
      )}
    >
      {kind === 'idle' ? (
        <Bike className="mt-0.5 size-5 shrink-0 text-neutral-3" aria-hidden />
      ) : kind === 'checking' ? (
        <Spinner className="mt-0.5 size-5 text-neutral-3" />
      ) : kind === 'inside' ? (
        <CircleCheck className="mt-0.5 size-5 shrink-0 text-brand-strong" aria-hidden />
      ) : kind === 'outside' ? (
        <MapPinOff className="mt-0.5 size-5 shrink-0 text-tag-6" aria-hidden />
      ) : (
        <CircleExclamationPoint className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
      )}
      <div data-result-text className="min-w-0 flex-1 [overflow-wrap:anywhere]">
        {kind === 'idle' ? (
          <p className="text-neutral-3">
            We&apos;ll check delivery as soon as you pick an address.
          </p>
        ) : kind === 'checking' ? (
          <p className="text-neutral-3">Checking delivery…</p>
        ) : state.kind === 'inside' ? (
          <p className="font-medium text-neutral-1">{state.text}</p>
        ) : state.kind === 'outside' ? (
          <>
            <p className="text-neutral-1">{state.text}</p>
            <Button
              type="button"
              variant="outline"
              size="touch"
              onClick={onTryAnother}
              className="mt-3 bg-white"
            >
              Try another address
            </Button>
          </>
        ) : (
          <>
            <p className="text-neutral-1">{CHECK_FAILED_TEXT}</p>
            <Button
              type="button"
              variant="outline"
              size="touch"
              onClick={onRetry}
              className="mt-3 bg-white"
            >
              Try again
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
