'use client';

import { type ReactNode, useRef } from 'react';
import type { Cuisine } from '@/server/db/enums';
import type { CuisineCounts, DishCard as Dish } from '@/server/modules/menu/schema';
import { CUISINES } from '@/server/modules/menu/urls';
import { DishCard } from '@/components/dish/dish-card';
import { EmptyState } from '@/components/states/empty-state';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CUISINE_LABELS, cuisineTabLabel } from '@/lib/format';
import { useMotion } from '@/lib/motion';
import { cn } from '@/lib/utils';

/**
 * A cuisine's dishes. The first six cards fade up when the tab or the results change, never on
 * the first paint (they may be the largest image).
 */
export function DishGrid({
  dishes,
  motionKey,
  busy = false,
}: {
  dishes: Dish[];
  /** A new value plays the entrance again (a tab opened, new results). */
  motionKey: string;
  /** A search is on its way: the old results stay, dimmed (S7.13). */
  busy?: boolean;
}) {
  const ref = useRef<HTMLUListElement>(null);
  const firstRun = useRef(true);

  useMotion(
    (motion) => {
      if (firstRun.current) {
        firstRun.current = false;
        return;
      }
      const cards = ref.current?.querySelectorAll(':scope > li');
      if (!cards || cards.length === 0) return;
      motion.from([...cards].slice(0, 6), {
        opacity: 0,
        y: 8,
        duration: motion.reduced ? 0.15 : 0.25,
        stagger: motion.reduced ? 0 : 0.03,
        ease: 'power2.out',
      });
    },
    { scope: ref, dependencies: [motionKey] },
  );

  return (
    <ul
      ref={ref}
      aria-busy={busy || undefined}
      className={cn(
        'grid gap-8 transition-opacity duration-150 sm:grid-cols-2 sm:gap-x-6 md:gap-y-20 lg:grid-cols-3 lg:gap-x-8 xl:mx-auto xl:max-w-[1168px] xl:gap-x-[74px] xl:gap-y-20',
        busy && 'opacity-75',
      )}
    >
      {dishes.map((dish, index) => (
        <li key={dish.id} className="h-full">
          <DishCard dish={dish} layout="responsive" showSpecial eager={index === 0} />
        </li>
      ))}
    </ul>
  );
}

/**
 * Korean, Thai and Vietnamese with their counts (the F1 cuisine bar). One Tab stop; arrow keys,
 * Home and End move between them and select as they go. Rendered inside a `Tabs` root.
 */
export function CuisineTabList({
  counts,
  value: selected,
  label = cuisineTabLabel,
}: {
  counts: CuisineCounts;
  value: Cuisine;
  /** The tab's name: "Korean, 12 dishes", or "Thai, 1 matching dish" with a filter on. */
  label?: (cuisine: Cuisine, count: number) => string;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  const shownIndex = useRef<number | null>(null);
  const index = CUISINES.indexOf(selected);

  // CSS places the pill's slot under the selected tab (right before any script runs); the tween
  // only moves the pill inside that slot, from the old tab back to zero. The two never drive the
  // same element, so the slot always follows `--tab`.
  useMotion(
    (motion) => {
      const previous = shownIndex.current;
      shownIndex.current = index;
      const triggers = listRef.current?.querySelectorAll<HTMLElement>('[role="tab"]');
      if (previous === null || previous === index || !pillRef.current || !triggers) return;
      const step = (triggers[1]?.offsetLeft ?? 0) - (triggers[0]?.offsetLeft ?? 0);
      motion.fromTo(
        pillRef.current,
        { x: (previous - index) * step },
        { x: 0, duration: 0.3, ease: 'power2.out', clearProps: 'transform' },
      );
    },
    { scope: listRef, dependencies: [index] },
  );

  return (
    <div className="flex justify-center">
      <TabsList
        ref={listRef}
        aria-label="Cuisine"
        className="relative h-auto w-full gap-0 rounded-lg bg-white p-1.5 shadow-card group-data-horizontal/tabs:h-auto md:w-[672px] md:gap-9"
      >
        <span
          aria-hidden
          style={{ '--tab': index }}
          className="absolute top-1.5 bottom-1.5 left-1.5 w-[calc((100%-0.75rem)/3)] translate-x-[calc(var(--tab)*100%)] md:w-[196px] md:translate-x-[calc(var(--tab)*232px)]"
        >
          <span
            ref={pillRef}
            data-tab-pill
            className="block size-full rounded-lg bg-brand-strong"
          />
        </span>
        {CUISINES.map((cuisine) => (
          <TabsTrigger
            key={cuisine}
            value={cuisine}
            className="relative z-10 h-14 min-w-0 flex-1 flex-col gap-1 rounded-lg border-0 px-1 text-neutral-3 transition-colors duration-150 not-data-active:hover:text-neutral-1 data-active:bg-transparent data-active:text-white data-active:hover:text-white data-active:shadow-none md:h-[62px] md:w-[196px] md:flex-none md:flex-row md:gap-2"
          >
            <span className="sr-only">{label(cuisine, counts[cuisine])}</span>
            <span
              aria-hidden
              className="text-body-5 font-medium max-[359px]:text-caption md:text-body-2 md:font-normal"
            >
              {CUISINE_LABELS[cuisine]}
            </span>
            <span
              aria-hidden
              className="rounded-full bg-neutral-7 px-2 text-caption leading-5 text-neutral-3 tabular-nums in-data-[state=active]:bg-white in-data-[state=active]:text-brand-strong"
            >
              {counts[cuisine]}
            </span>
          </TabsTrigger>
        ))}
      </TabsList>
    </div>
  );
}

/** One cuisine's panel: its heading for screen readers and whatever it shows. */
export function CuisinePanel({
  cuisine,
  children,
  className,
}: {
  cuisine: Cuisine;
  children: ReactNode;
  className?: string;
}) {
  return (
    <TabsContent value={cuisine} tabIndex={-1} className={className}>
      <h2 className="sr-only">{CUISINE_LABELS[cuisine]} dishes</h2>
      {children}
    </TabsContent>
  );
}

export interface CuisineTabsProps {
  dishes: Dish[];
  counts: CuisineCounts;
  value: Cuisine;
  onValueChange: (value: string) => void;
}

/** The tabs and their dishes on their own, without search or filters (Storybook, F1 4.3). */
export function CuisineTabs({ dishes, counts, value, onValueChange }: CuisineTabsProps) {
  return (
    <Tabs
      value={value}
      onValueChange={onValueChange}
      activationMode="automatic"
      className="mt-11 gap-0 md:mt-10"
    >
      <CuisineTabList counts={counts} value={value} />
      {CUISINES.map((cuisine) => {
        const list = dishes.filter((dish) => dish.cuisine === cuisine);
        return (
          <CuisinePanel key={cuisine} cuisine={cuisine} className="mt-12 md:mt-20">
            {list.length > 0 ? (
              <DishGrid dishes={list} motionKey={cuisine} />
            ) : (
              <EmptyState
                illustration="orderFood"
                title={`No ${CUISINE_LABELS[cuisine]} dishes yet`}
                description="Try another cuisine."
                titleAs="h3"
                action={
                  cuisine === 'KOREAN' ? null : (
                    <Button type="button" size="touch" onClick={() => onValueChange('KOREAN')}>
                      See Korean dishes
                    </Button>
                  )
                }
              />
            )}
          </CuisinePanel>
        );
      })}
    </Tabs>
  );
}
