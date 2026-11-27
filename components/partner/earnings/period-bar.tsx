'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useId } from 'react';
import type { IsoDate } from '@/server/modules/earnings/schema';
import { Button } from '@/components/ui/button';
import { announce } from '@/lib/announce';
import {
  CURRENT_WEEK_WORDS,
  FIRST_WEEK_WORDS,
  nextWeekName,
  previousWeekName,
  shortRange,
} from '@/lib/partner/earnings-text';
import { addDays } from '@/server/modules/earnings/rules';
import { cn } from '@/lib/utils';

/*
 * The period bar (F9 design 1.2, D1): where other screens have their dock, above the tab bar,
 * so the segments and the week arrows sit under his thumb and never move. Native radios: arrow
 * keys move and select, and focus stays on the control while the view above changes.
 */

export type Period = 'today' | 'week';

export function PeriodBar({
  period,
  onPeriod,
  weekStart,
  isFirstWeek,
  isCurrentWeek,
  onWeek,
  withTabBar,
}: {
  period: Period;
  onPeriod: (period: Period) => void;
  weekStart: IsoDate;
  isFirstWeek: boolean;
  isCurrentWeek: boolean;
  onWeek: (weekStart: IsoDate) => void;
  /** Without a tab bar (suspended), the bar clears the phone's home indicator itself. */
  withTabBar: boolean;
}) {
  const id = useId();
  return (
    <div
      className={cn(
        'border-t border-border bg-card px-4 pt-2',
        withTabBar ? 'pb-2' : 'pb-[max(0.5rem,env(safe-area-inset-bottom))]',
      )}
    >
      {period === 'week' ? (
        <div className="mb-2 grid h-12 grid-cols-[3rem_minmax(0,1fr)_3rem] items-center gap-2">
          <StepButton
            name={previousWeekName(weekStart)}
            blocked={isFirstWeek}
            blockedWords={FIRST_WEEK_WORDS}
            describedBy={`${id}-first`}
            onPress={() => onWeek(addDays(weekStart, -7))}
            direction="previous"
          />
          <p className="text-center text-body-4 font-medium text-strong tabular-nums">
            {shortRange(weekStart, addDays(weekStart, 6))}
          </p>
          <StepButton
            name={nextWeekName(weekStart)}
            blocked={isCurrentWeek}
            blockedWords={CURRENT_WEEK_WORDS}
            describedBy={`${id}-current`}
            onPress={() => onWeek(addDays(weekStart, 7))}
            direction="next"
          />
          <span id={`${id}-first`} className="sr-only">
            {FIRST_WEEK_WORDS}
          </span>
          <span id={`${id}-current`} className="sr-only">
            {CURRENT_WEEK_WORDS}
          </span>
        </div>
      ) : null}
      <fieldset className="min-w-0">
        <legend className="sr-only">Show</legend>
        <div className="grid grid-cols-2 gap-2 rounded-xl bg-muted p-1">
          {(['today', 'week'] as const).map((value) => (
            <label
              key={value}
              className="relative flex min-h-12 cursor-pointer items-center justify-center rounded-lg px-2 text-center text-body-4 font-medium text-foreground has-[:checked]:bg-primary has-[:checked]:font-semibold has-[:checked]:text-primary-foreground has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring has-[:focus-visible]:outline-solid"
            >
              <input
                type="radio"
                name="period"
                value={value}
                checked={period === value}
                onChange={() => onPeriod(value)}
                className="sr-only"
              />
              {value === 'today' ? 'Today' : 'Week'}
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}

function StepButton({
  name,
  blocked,
  blockedWords,
  describedBy,
  onPress,
  direction,
}: {
  name: string;
  blocked: boolean;
  blockedWords: string;
  describedBy: string;
  onPress: () => void;
  direction: 'previous' | 'next';
}) {
  const Icon = direction === 'previous' ? ChevronLeft : ChevronRight;
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-kitchen"
      aria-label={name}
      aria-disabled={blocked || undefined}
      aria-describedby={blocked ? describedBy : undefined}
      className={cn(blocked ? 'cursor-not-allowed text-muted-foreground' : 'text-strong')}
      onClick={() => {
        if (blocked) {
          announce(blockedWords);
          return;
        }
        onPress();
      }}
    >
      <Icon className="size-6" aria-hidden />
    </Button>
  );
}
