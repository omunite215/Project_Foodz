'use client';

import { gsap } from 'gsap';
import { Check, Target } from 'lucide-react';
import Link from 'next/link';
import { type Ref, useEffect, useRef } from 'react';
import type { EarningsToday } from '@/server/modules/earnings/schema';
import { goalPercent } from '@/server/modules/earnings/rules';
import { Button } from '@/components/ui/button';
import { announce } from '@/lib/announce';
import { formatPrice } from '@/lib/format';
import { useMotion } from '@/lib/motion';
import {
  figuresLine,
  goalOfWords,
  goalReachedAnnouncement,
  longAmount,
  noEarningsCopy,
  ringSentence,
} from '@/lib/partner/earnings-text';
import { cn } from '@/lib/utils';
import { Doodle } from '../doodle';

/*
 * Today (F9 design 1.4, 1.5, 1.13): his earnings against the goal he set himself, as a ring
 * sized in rem (it grows with text size and stops at the column), or a plain total without a
 * goal. The ring fills from empty once a visit and moves from where it is after that; it never
 * pulses, laps or counts up. Hidden from screen readers: one sentence stands in for it.
 */

const RADIUS = 80;
export const RING_LENGTH = 2 * Math.PI * RADIUS;
const offsetFor = (percent: number) => (1 - percent / 100) * RING_LENGTH;

/** The ring fills from empty only the first time Today shows in a visit (P52.2). */
let filledThisVisit = false;

export function GoalRing({
  earnedCents,
  goalCents,
  day,
}: {
  earnedCents: number;
  goalCents: number;
  /** The store date: a new day empties the ring at once, without a tween (P52.4). */
  day: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const percent = goalPercent(earnedCents, goalCents);
  const reached = earnedCents >= goalCents;
  const offset = offsetFor(percent);
  const drawn = useRef<{ offset: number; day: string; reached: boolean } | null>(null);

  useMotion(
    (motion) => {
      const arc = ref.current?.querySelector('[data-arc]');
      const before = drawn.current;
      drawn.current = { offset, day, reached };
      if (!arc || motion.reduced) return;
      if (!before) {
        if (filledThisVisit) return;
        filledThisVisit = true;
        gsap.fromTo(
          arc,
          { strokeDashoffset: RING_LENGTH },
          { strokeDashoffset: offset, duration: 0.6, ease: 'power2.out' },
        );
        return;
      }
      if (before.day !== day || before.offset === offset) return;
      gsap.fromTo(
        arc,
        { strokeDashoffset: before.offset },
        { strokeDashoffset: offset, duration: 0.3, ease: 'power2.out' },
      );
      const disc = ref.current?.querySelector('[data-reached]');
      if (disc && reached && !before.reached) {
        motion.fromTo(
          disc,
          { scale: 0.8, opacity: 0 },
          { scale: 1, opacity: 1, duration: 0.2, delay: 0.2, ease: 'power2.out' },
        );
      }
    },
    { scope: ref, dependencies: [offset, day, reached] },
  );

  const amount = formatPrice(earnedCents);
  return (
    <figure
      ref={ref}
      className="relative mx-auto aspect-square w-44 max-w-full [@media(max-height:700px)]:w-36"
    >
      <svg aria-hidden viewBox="0 0 176 176" className="size-full -rotate-90">
        <circle cx="88" cy="88" r={RADIUS} strokeWidth="12" fill="none" className="stroke-border" />
        <circle
          data-arc=""
          cx="88"
          cy="88"
          r={RADIUS}
          strokeWidth="12"
          fill="none"
          strokeLinecap="butt"
          strokeDasharray={RING_LENGTH}
          strokeDashoffset={offset}
          className="stroke-primary"
        />
      </svg>
      {reached ? (
        <span
          data-reached=""
          aria-hidden
          className="absolute top-[4.55%] left-1/2 flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-primary"
        >
          <Check className="size-3.5 text-primary-foreground" strokeWidth={3} />
        </span>
      ) : (
        <span
          aria-hidden
          className="absolute top-[-1.14%] left-1/2 h-[11.36%] w-[1.7%] min-w-[3px] -translate-x-1/2 rounded-full bg-strong"
        />
      )}
      <div
        aria-hidden
        className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center"
      >
        <p
          className={cn(
            'font-sans leading-none font-semibold text-strong tabular-nums',
            longAmount(earnedCents) ? 'text-title-1' : 'text-h4',
          )}
        >
          {amount}
        </p>
        {reached ? (
          <p className="mt-1.5 inline-flex items-center gap-1 text-body-5 font-medium text-strong">
            <Check className="size-3.5 text-success-mark" aria-hidden />
            Goal reached
          </p>
        ) : (
          <p className="mt-1.5 text-body-5 text-muted-foreground">{goalOfWords(goalCents)}</p>
        )}
      </div>
    </figure>
  );
}

export function TodayBlock({
  today,
  goalCents,
  readOnly,
  neverDelivered,
  onGoal,
  goalButtonRef,
}: {
  today: EarningsToday;
  /** His goal, or the demo partner's for this session. */
  goalCents: number | null;
  /** Suspended: no ring and no goal controls (P61.1). */
  readOnly: boolean;
  /** Lena: no entry ever (P59.1). */
  neverDelivered: boolean;
  onGoal: () => void;
  goalButtonRef: Ref<HTMLButtonElement>;
}) {
  const showRing = !readOnly && goalCents !== null;
  useGoalReachedAnnouncement(today, showRing ? goalCents : null);

  if (neverDelivered) {
    const copy = noEarningsCopy(readOnly);
    return (
      <section aria-labelledby="today-title" className="pt-2 text-center">
        <Doodle name="strolling" className="w-40 max-[359px]:w-30" />
        <h2 id="today-title" className="mt-4 font-heading text-h4 text-strong">
          {copy.heading}
        </h2>
        {copy.line ? <p className="mt-2 text-body-4 text-muted-foreground">{copy.line}</p> : null}
        {copy.homeAction ? (
          <div className="mt-4 flex justify-center">
            <Button asChild variant="outline" size="kitchen" className="bg-card text-strong">
              <Link href="/partner">Go to Home</Link>
            </Button>
          </div>
        ) : null}
      </section>
    );
  }

  const figures = (
    <p className="mt-3 text-center text-body-4 text-foreground tabular-nums">
      {figuresLine(today)}
    </p>
  );

  return (
    <section aria-labelledby="today-title">
      <h2 id="today-title" className="sr-only">
        Today
      </h2>
      {showRing && goalCents !== null ? (
        <>
          <GoalRing earnedCents={today.earnedCents} goalCents={goalCents} day={today.date} />
          <p className="sr-only">{ringSentence(today.earnedCents, goalCents)}</p>
          {figures}
          <div className="mt-1 flex justify-center">
            <button
              ref={goalButtonRef}
              type="button"
              onClick={onGoal}
              className="inline-flex h-12 items-center gap-1.5 rounded-lg px-2 text-button-2 font-medium text-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid"
            >
              <Target className="size-4" aria-hidden />
              Edit goal
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="text-center font-sans text-h2 leading-none font-semibold text-strong tabular-nums">
            {formatPrice(today.earnedCents)}
          </p>
          {figures}
          {readOnly ? null : (
            <div className="mt-3 flex justify-center">
              <Button
                ref={goalButtonRef}
                type="button"
                variant="outline"
                size="kitchen"
                className="bg-card text-strong"
                onClick={onGoal}
              >
                <Target className="size-5" aria-hidden />
                Set a daily goal
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/**
 * "Goal reached. $41.20 today." once a day, when he crosses it with the tab open; never on load
 * or reload, when the server's figures already say it happened (P53.2).
 */
function useGoalReachedAnnouncement(today: EarningsToday, goalCents: number | null) {
  const seen = useRef<{ day: string; reached: boolean } | null>(null);
  const reached = goalCents !== null && today.earnedCents >= goalCents;
  useEffect(() => {
    const before = seen.current;
    seen.current = { day: today.date, reached };
    if (!before || before.day !== today.date) return;
    if (reached && !before.reached) announce(goalReachedAnnouncement(today.earnedCents));
  }, [reached, today.date, today.earnedCents]);
}
