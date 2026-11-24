'use client';

import { gsap } from 'gsap';
import { useRef } from 'react';
import { OFFER_COPY, RING_LENGTH, ringOffset } from '@/lib/partner/offer-text';
import { useMotion } from '@/lib/motion';
import { cn } from '@/lib/utils';

/*
 * The offer's countdown (F7 design 1.4): a 112 px ring (80 px on short screens) on the server's
 * clock. The ring sweeps continuously, re-synced every second; under reduced motion it steps
 * once a second. The last 10 seconds turn the stroke amber and say "seconds left". Hidden from
 * screen readers: the card's description says the time when it opens, and "10 seconds left" is
 * announced once by the card.
 */

export function CountdownRing({
  left,
  total,
  running = true,
}: {
  left: number;
  total: number;
  /** False once answered: the ring holds where it is. */
  running?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const lastTen = left <= 10;
  const offset = ringOffset(left, total);
  const next = ringOffset(Math.max(0, left - 1), total);

  // Continuous sweep: from this second's position to the next one's over one second, linear.
  useMotion(
    (motion) => {
      const root = ref.current;
      if (!root || motion.reduced || !running || left <= 0) return;
      const arcs = root.querySelectorAll('[data-arc]');
      gsap.fromTo(
        arcs,
        { strokeDashoffset: offset },
        { strokeDashoffset: next, duration: 1, ease: 'none' },
      );
    },
    { scope: ref, dependencies: [left, total, running] },
  );

  // The amber arc fades in over the green one at 10 seconds.
  useMotion(
    (motion) => {
      const amber = ref.current?.querySelector('[data-amber]');
      if (!amber || !lastTen || motion.reduced) return;
      gsap.fromTo(amber, { opacity: 0 }, { opacity: 1, duration: 0.15, ease: 'power2.out' });
    },
    { scope: ref, dependencies: [lastTen] },
  );

  return (
    <div
      ref={ref}
      aria-hidden
      className="relative size-28 shrink-0 [@media(max-height:700px)]:size-20"
    >
      <svg viewBox="0 0 112 112" className="size-full -rotate-90">
        <circle cx="56" cy="56" r="50" strokeWidth="8" fill="none" className="stroke-border" />
        <circle
          data-arc=""
          cx="56"
          cy="56"
          r="50"
          strokeWidth="8"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={RING_LENGTH}
          strokeDashoffset={offset}
          className="stroke-primary"
        />
        <circle
          data-arc=""
          data-amber=""
          cx="56"
          cy="56"
          r="50"
          strokeWidth="8"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={RING_LENGTH}
          strokeDashoffset={offset}
          className={cn('stroke-warning-mark', lastTen ? 'opacity-100' : 'opacity-0')}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-sans text-h4 leading-none font-semibold text-strong tabular-nums [@media(max-height:700px)]:text-title-1">
          {left}
        </span>
        <span className="text-caption text-muted-foreground">
          {lastTen ? OFFER_COPY.secondsLeft : OFFER_COPY.seconds}
        </span>
      </div>
    </div>
  );
}
