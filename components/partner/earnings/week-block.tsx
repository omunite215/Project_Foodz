'use client';

import { useRef } from 'react';
import type { EarningsWeekBlock, IsoDate } from '@/server/modules/earnings/schema';
import { formatPrice } from '@/lib/format';
import { useMotion } from '@/lib/motion';
import {
  barShare,
  compareLine,
  dayButtonName,
  dayLabel,
  daysLabel,
  figuresLine,
  weekRangeWords,
  weekTitle,
} from '@/lib/partner/earnings-text';
import { cn } from '@/lib/utils';

/*
 * The week (F9 design 1.6): the total, seven day buttons as bars, the figures and a plain line
 * comparing with the week before. Past days in `primary`, today outlined, zero days a stub,
 * future days a dashed base: never colour alone. No values on the bars; the list's day headers
 * carry them.
 */

/** A week's bars grow once, the first time it shows in a visit. */
const grownThisVisit = new Set<string>();

export function WeekBlock({
  week,
  currentWeekStart,
  zoneDiffers,
  onDay,
}: {
  week: EarningsWeekBlock;
  currentWeekStart: IsoDate;
  zoneDiffers: boolean;
  onDay: (date: IsoDate) => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const title = weekTitle(week.start, currentWeekStart);
  const highest = Math.max(0, ...week.days.map((day) => day.earnedCents));
  const empty = week.deliveries === 0 && week.earnedCents === 0;
  const compare = compareLine(week);

  useMotion(
    (motion) => {
      if (motion.reduced || grownThisVisit.has(week.start)) return;
      grownThisVisit.add(week.start);
      motion.from('[data-bar]', {
        scaleY: 0,
        transformOrigin: '50% 100%',
        duration: 0.4,
        ease: 'power2.out',
        stagger: 0.04,
      });
    },
    { scope: ref, dependencies: [week.start] },
  );

  return (
    <section ref={ref} aria-labelledby="week-title">
      <p id="week-title" className="text-center text-body-5 font-medium text-muted-foreground">
        {title}
      </p>
      <p className="mt-1 text-center font-sans text-h2 leading-none font-semibold text-strong tabular-nums">
        {formatPrice(week.earnedCents)}
      </p>
      <p className="mt-2 text-center text-body-5 text-muted-foreground tabular-nums">
        {weekRangeWords(week.start, week.end)}
      </p>
      <ul aria-label={daysLabel(week.start, week.end)} className="mt-5 grid h-32 grid-cols-7 gap-1">
        {week.days.map((day) => {
          const inactive =
            day.state === 'future' || (day.earnedCents === 0 && day.deliveries === 0);
          const today = day.state === 'today';
          const share = barShare(day.earnedCents, highest);
          let marker;
          if (day.state === 'future') {
            marker = (
              <span aria-hidden className="block w-6 border-t-2 border-dashed border-input" />
            );
          } else if (share === 0) {
            marker = (
              <span
                aria-hidden
                className={cn(
                  'block h-1 w-6 rounded-full bg-input',
                  today && 'outline-2 outline-offset-2 outline-strong outline-solid',
                )}
              />
            );
          } else {
            marker = (
              <span
                data-bar=""
                aria-hidden
                style={{ height: `calc(5.5rem * ${share})` }}
                className={cn(
                  'block w-6 rounded-t-md rounded-b-sm bg-primary',
                  today && 'outline-2 outline-offset-2 outline-strong outline-solid',
                )}
              />
            );
          }
          return (
            <li key={day.date} className="min-w-0">
              <button
                type="button"
                aria-disabled={inactive || undefined}
                onClick={() => {
                  if (!inactive) onDay(day.date);
                }}
                className={cn(
                  'group flex h-full w-full flex-col items-center justify-end gap-1.5 rounded-lg pb-1 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-solid',
                  inactive ? 'cursor-default' : 'hover:bg-muted',
                )}
              >
                {marker}
                {/* The name from its parts; the short label stays visual (WCAG 2.5.3). */}
                <span className="sr-only">{dayButtonName(day)}</span>
                <span
                  aria-hidden
                  className={cn(
                    'text-caption',
                    // On the hover fill the grey label would drop under 4.5:1: it darkens too.
                    today
                      ? 'font-semibold text-strong'
                      : cn('text-muted-foreground', !inactive && 'group-hover:text-foreground'),
                  )}
                >
                  {dayLabel(day)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-4 text-center text-body-4 text-foreground tabular-nums">
        {empty ? 'No deliveries this week.' : figuresLine(week)}
      </p>
      {compare ? (
        <p className="mt-1 text-center text-body-5 text-muted-foreground tabular-nums">{compare}</p>
      ) : null}
      {zoneDiffers ? (
        <p className="mt-2 text-center text-body-5 text-muted-foreground">Times are Boston time.</p>
      ) : null}
    </section>
  );
}

/**
 * A week not yet cached (P59.2): the loaded block's own lines, each holding a grey bar of one
 * text height, so the skeleton is exactly as tall as the week that replaces it (QA F3).
 */
export function WeekSkeleton({
  withCompare,
  zoneDiffers,
}: {
  /** Every week but his first has a comparison line. */
  withCompare: boolean;
  zoneDiffers: boolean;
}) {
  const heights = ['h-12', 'h-6', 'h-20', 'h-16', 'h-10', 'h-14', 'h-8'];
  const line = 'inline-block h-[1em] rounded bg-muted align-top';
  return (
    <div aria-hidden className="motion-safe:animate-pulse">
      <p className="text-center text-body-5 font-medium">
        <span className={cn(line, 'w-20')} />
      </p>
      <p className="mt-1 text-center font-sans text-h2 leading-none font-semibold">
        <span className={cn(line, 'w-36')} />
      </p>
      <p className="mt-2 text-center text-body-5">
        <span className={cn(line, 'w-48')} />
      </p>
      <div className="mt-5 grid h-32 grid-cols-7 items-end gap-1">
        {heights.map((height) => (
          <div key={height} className="flex flex-col items-center gap-1.5 pb-1">
            <span className={cn('block w-6 rounded-t-md bg-muted', height)} />
            <span className="block text-caption">
              <span className={cn(line, 'w-6')} />
            </span>
          </div>
        ))}
      </div>
      <p className="mt-4 text-center text-body-4">
        <span className={cn(line, 'w-64 max-w-full')} />
      </p>
      {withCompare ? (
        <p className="mt-1 text-center text-body-5">
          <span className={cn(line, 'w-32')} />
        </p>
      ) : null}
      {zoneDiffers ? (
        <p className="mt-2 text-center text-body-5">
          <span className={cn(line, 'w-40')} />
        </p>
      ) : null}
    </div>
  );
}
