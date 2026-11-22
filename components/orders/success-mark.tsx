'use client';

import { CircleX, CreditCard, TimerOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Spinner } from '@/components/ui/spinner';
import type { OrderState } from '@/lib/order-text';
import { prefersReducedMotion } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { SuccessCheck } from './success-check';

/*
 * The mark above the order page's heading (F4 design 3.3, D33, D39). The check animation plays
 * once, from its first frame, only on a fresh arrival from checkout with motion allowed; lottie's
 * light player and the JSON are fetched only then. Every other time, and if it hasn't started
 * within a second, the still check shows. Always decorative.
 */

const START_LIMIT_MS = 1000;

function Played({ onFail }: { onFail: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const failed = useRef(onFail);
  useEffect(() => {
    failed.current = onFail;
  });
  useEffect(() => {
    let cancelled = false;
    let destroy: (() => void) | null = null;
    const fail = () => failed.current();
    // Reduced motion: the still check, and the player is never fetched.
    if (prefersReducedMotion()) {
      fail();
      return undefined;
    }
    const limit = setTimeout(() => {
      if (!cancelled) fail();
    }, START_LIMIT_MS);
    void (async () => {
      try {
        const [{ default: lottie }, response] = await Promise.all([
          import('lottie-web/build/player/lottie_light'),
          fetch('/lottie/check-mark-success.json'),
        ]);
        if (!response.ok) throw new Error('animation missing');
        const animationData: unknown = await response.json();
        if (cancelled || !box.current) return;
        const animation = lottie.loadAnimation({
          container: box.current,
          renderer: 'svg',
          loop: false,
          autoplay: true,
          animationData,
          rendererSettings: { preserveAspectRatio: 'xMidYMid meet' },
        });
        animation.addEventListener('DOMLoaded', () => clearTimeout(limit));
        animation.addEventListener('data_failed', fail);
        destroy = () => animation.destroy();
      } catch {
        if (!cancelled) fail();
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(limit);
      destroy?.();
    };
  }, []);
  return <div ref={box} data-success-animation className="size-24" />;
}

function IconCircle({ state }: { state: OrderState }) {
  if (state === 'confirming') {
    return (
      <span className="flex size-24 items-center justify-center rounded-full bg-neutral-7">
        <Spinner className="size-8 text-brand-strong motion-reduce:animate-none" />
      </span>
    );
  }
  if (state === 'waiting') {
    return (
      <span className="flex size-24 items-center justify-center rounded-full bg-tag-6-bg">
        <CreditCard className="size-10 text-neutral-1" />
      </span>
    );
  }
  if (state === 'failed' || state === 'mismatch') {
    return (
      <span className="flex size-24 items-center justify-center rounded-full bg-tag-4-bg">
        <CircleX className="size-10 text-destructive" />
      </span>
    );
  }
  if (state === 'expired') {
    return (
      <span className="flex size-24 items-center justify-center rounded-full bg-neutral-7">
        <TimerOff className="size-10 text-neutral-3" />
      </span>
    );
  }
  return (
    <span className="flex size-24 items-center justify-center rounded-full bg-neutral-7">
      <CircleX className="size-10 text-neutral-3" />
    </span>
  );
}

export function SuccessMark({
  state,
  play,
  className,
}: {
  state: OrderState;
  /** A fresh arrival from checkout: the animation may play once. */
  play: boolean;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const placed = state === 'placed' || state === 'delivered';
  const animate = placed && play && !failed;

  return (
    <div aria-hidden className={cn('mx-auto flex size-24 items-center justify-center', className)}>
      {placed ? (
        animate ? (
          <Played onFail={() => setFailed(true)} />
        ) : (
          <SuccessCheck />
        )
      ) : (
        <IconCircle state={state} />
      )}
    </div>
  );
}
