'use client';

import { useSearchParams } from 'next/navigation';
import { useRef } from 'react';
import type { Cuisine } from '@/server/db/enums';
import type { CuisineCounts, DishCard as Dish } from '@/server/modules/menu/schema';
import { CUISINES, menuTabHref, parseCuisineParam } from '@/server/modules/menu/urls';
import { DishCard } from '@/components/dish/dish-card';
import { EmptyState } from '@/components/states/empty-state';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CUISINE_LABELS, cuisineTabLabel } from '@/lib/format';
import { useMotion } from '@/lib/motion';
import { useScrollMemory } from '@/lib/scroll-memory';

const isCuisine = (value: string): value is Cuisine =>
  CUISINES.some((cuisine) => cuisine === value);

/** Keeps the tab in the address without a new history entry or a request. */
function showTab(value: string) {
  if (isCuisine(value)) window.history.replaceState(null, '', menuTabHref(value));
}

function DishGrid({ dishes, cuisine }: { dishes: Dish[]; cuisine: Cuisine }) {
  const ref = useRef<HTMLUListElement>(null);
  const firstRun = useRef(true);

  // Cards fade up when a tab is opened, not on the first paint (they may be the largest image).
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
    { scope: ref, dependencies: [cuisine] },
  );

  return (
    <ul
      ref={ref}
      className="grid gap-8 sm:grid-cols-2 sm:gap-x-6 md:gap-y-20 lg:grid-cols-3 lg:gap-x-8 xl:mx-auto xl:max-w-[1168px] xl:gap-x-[74px] xl:gap-y-20"
    >
      {dishes.map((dish, index) => (
        <li key={dish.id} className="h-full">
          <DishCard dish={dish} layout="responsive" showSpecial eager={index === 0} />
        </li>
      ))}
    </ul>
  );
}

export interface CuisineTabsProps {
  dishes: Dish[];
  counts: CuisineCounts;
  value: Cuisine;
  onValueChange: (value: string) => void;
}

/**
 * Korean, Thai and Vietnamese with their dish counts, and the selected cuisine's dishes. One Tab
 * stop for the tabs; arrow keys, Home and End move between them and select as they go.
 */
export function CuisineTabs({ dishes, counts, value: selected, onValueChange }: CuisineTabsProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  const shownIndex = useRef<number | null>(null);
  const index = CUISINES.indexOf(selected);

  // The pill is placed by CSS (so it is right before any script runs); this slides it there.
  useMotion(
    (motion) => {
      const previous = shownIndex.current;
      shownIndex.current = index;
      const triggers = listRef.current?.querySelectorAll<HTMLElement>('[role="tab"]');
      if (previous === null || previous === index || !pillRef.current || !triggers) return;
      const step = (triggers[1]?.offsetLeft ?? 0) - (triggers[0]?.offsetLeft ?? 0);
      motion.from(pillRef.current, {
        x: (previous - index) * step,
        duration: 0.3,
        ease: 'power2.out',
      });
    },
    { scope: listRef, dependencies: [index] },
  );

  return (
    <Tabs
      value={selected}
      onValueChange={onValueChange}
      activationMode="automatic"
      className="mt-11 gap-0 md:mt-10"
    >
      <div className="flex justify-center">
        <TabsList
          ref={listRef}
          aria-label="Cuisine"
          className="relative h-auto w-full gap-0 rounded-lg bg-white p-1.5 shadow-card group-data-horizontal/tabs:h-auto md:w-[672px] md:gap-9"
        >
          <span
            ref={pillRef}
            aria-hidden
            style={{ '--tab': index }}
            className="absolute top-1.5 bottom-1.5 left-1.5 w-[calc((100%-0.75rem)/3)] translate-x-[calc(var(--tab)*100%)] rounded-lg bg-brand-strong md:w-[196px] md:translate-x-[calc(var(--tab)*232px)]"
          />
          {CUISINES.map((cuisine) => (
            <TabsTrigger
              key={cuisine}
              value={cuisine}
              className="relative z-10 h-14 min-w-0 flex-1 flex-col gap-1 rounded-lg border-0 px-1 text-neutral-3 transition-colors duration-150 hover:text-neutral-1 data-active:bg-transparent data-active:text-white data-active:shadow-none md:h-[62px] md:w-[196px] md:flex-none md:flex-row md:gap-2"
            >
              <span className="sr-only">{cuisineTabLabel(cuisine, counts[cuisine])}</span>
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
      {CUISINES.map((cuisine) => {
        const list = dishes.filter((dish) => dish.cuisine === cuisine);
        return (
          <TabsContent key={cuisine} value={cuisine} tabIndex={-1} className="mt-12 md:mt-20">
            <h2 className="sr-only">{CUISINE_LABELS[cuisine]} dishes</h2>
            {list.length > 0 ? (
              <DishGrid dishes={list} cuisine={cuisine} />
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
          </TabsContent>
        );
      })}
    </Tabs>
  );
}

/**
 * The menu's tabs, kept in the address. Every dish is already on the page, so switching tabs is
 * instant (and works offline); the tab goes into the address (?cuisine=thai) without a new
 * history entry or a request, so a reload or a shared link opens the same tab.
 */
export function CuisineMenu({ dishes, counts }: { dishes: Dish[]; counts: CuisineCounts }) {
  const selected = parseCuisineParam(useSearchParams().get('cuisine'));
  // Back from a dish returns to the same place in the list, even when the menu renders late.
  useScrollMemory('/menu');
  return <CuisineTabs dishes={dishes} counts={counts} value={selected} onValueChange={showTab} />;
}
