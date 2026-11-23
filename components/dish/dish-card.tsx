'use client';

import { ChevronRight, Sparkles } from 'lucide-react';
import Link, { useLinkStatus } from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { dishHref } from '@/server/modules/menu/urls';
import type { DishCard as Dish } from '@/server/modules/menu/schema';
import { FavoriteButton } from '@/components/favorites/favorite-button';
import { useFavorites } from '@/components/favorites/favorites-context';
import { formatPrice, ratingLabel } from '@/lib/format';
import { cn } from '@/lib/utils';
import { DishPlate } from './dish-plate';
import { OfferCountdown } from './offer-countdown';
import { Rating } from './rating';

/**
 * - `responsive`: the menu grid and the side offers on desktop; Figma "small" up to `lg`,
 *   "large" from `xl`.
 * - `featured`: the highlighted offer (and every offer slide on phones and tablets).
 * - `compact`: one row; Today's specials on the menu and sold-out suggestions.
 */
export type DishCardLayout = 'responsive' | 'featured' | 'compact';

const FRAMES = {
  responsive: {
    plate: 'w-[200px] xl:w-full xl:max-w-[284px]',
    name: 'text-title-2 xl:text-h4',
    star: 'size-4 xl:size-6',
    ratingText: 'text-body-5 font-medium text-neutral-3 xl:text-body-4 xl:font-normal',
    price: 'text-title-1 xl:text-price',
    button: 'h-11 text-button-2 md:h-9 xl:h-10 xl:text-button-1',
  },
  featured: {
    plate: 'w-[200px] max-w-full xl:w-[284px]',
    name: 'text-title-1 xl:text-h4',
    star: 'size-4 xl:size-6',
    ratingText: 'text-body-5 font-medium text-neutral-3 xl:text-body-4 xl:font-normal',
    price: 'text-h4 xl:text-price',
    button: 'h-11 text-button-2 md:h-9 xl:h-10 xl:text-button-1',
  },
} as const;

const PLATE_SIZES = '(min-width: 1280px) 284px, 200px';
const NO_FLAVORS: readonly string[] = [];

export interface DishCardProps {
  dish: Dish;
  layout: DishCardLayout;
  /** "Special" badge; off where every dish shown is special. */
  showSpecial?: boolean;
  /** Featured only: the offer countdown and the flavors line. */
  showOffer?: boolean;
  flavors?: readonly string[];
  /** The first card of a list loads its photo straight away. */
  eager?: boolean;
  headingLevel?: 'h2' | 'h3' | 'h4';
  className?: string;
  /** The heart beside the card (F3 S5.1); on wherever favorites are available. */
  favorite?: boolean;
  /** The heart was tapped: the favorites page removes the card. */
  onFavoriteChange?: (on: boolean) => void;
}

/**
 * The card as screen readers hear it, once, as one link: "Bulgogi, $22.99, rated 4.6 out of 5,
 * 120 reviews". It is one piece of text so nothing gets read between its parts.
 */
export function dishCardLabel(dish: Dish, showSpecial = false): string {
  return [
    dish.title,
    showSpecial && dish.isSpecial ? 'Special' : null,
    formatPrice(dish.priceCents),
    dish.isAvailable ? null : 'Sold out today',
    ratingLabel(dish.ratingAvg, dish.ratingCount),
  ]
    .filter(Boolean)
    .join(', ');
}

/** Clears the "opening" state once the navigation it started has finished or was cancelled. */
function PendingWatcher({ onSettled }: { onSettled: () => void }) {
  const { pending } = useLinkStatus();
  const wasPending = useRef(false);
  useEffect(() => {
    if (pending) wasPending.current = true;
    else if (wasPending.current) {
      wasPending.current = false;
      onSettled();
    }
  }, [pending, onSettled]);
  return null;
}

/**
 * A dish as one link to its page: one Tab stop, the whole card is the target. The Figma
 * "Order now" button is drawn inside it but is not a second control. A second tap while the
 * page is opening is ignored.
 */
export function DishCard({
  dish,
  layout,
  showSpecial = false,
  showOffer = false,
  flavors = NO_FLAVORS,
  eager = false,
  headingLevel: Heading = 'h3',
  className,
  favorite = true,
  onFavoriteChange,
}: DishCardProps) {
  const [opening, setOpening] = useState(false);
  const favorites = useFavorites();
  const showHeart = favorite && favorites !== null;
  const openingRef = useRef(false);
  const settle = useCallback(() => {
    openingRef.current = false;
    setOpening(false);
  }, []);

  const linkProps = {
    href: dishHref(dish.slug),
    'aria-disabled': opening || undefined,
    onNavigate: (event: { preventDefault: () => void }) => {
      if (openingRef.current) {
        event.preventDefault();
        return;
      }
      openingRef.current = true;
      setOpening(true);
    },
  };

  const name = (
    <>
      <span aria-hidden>{dish.title}</span>
      <span className="sr-only">{dishCardLabel(dish, showSpecial)}</span>
    </>
  );

  const badge = !dish.isAvailable ? (
    <span
      aria-hidden
      className="absolute top-4 left-4 z-10 inline-flex h-6 items-center rounded-md bg-neutral-1 px-2 text-caption font-medium text-neutral-8"
    >
      Sold out today
    </span>
  ) : showSpecial && dish.isSpecial ? (
    <span
      aria-hidden
      className="absolute top-4 left-4 z-10 inline-flex h-6 items-center gap-1 rounded-md bg-tag-1-bg px-2 text-caption font-medium text-neutral-1"
    >
      <Sparkles className="size-3 text-brand-strong" aria-hidden />
      Special
    </span>
  ) : null;

  // The hover lift and press scale sit on a wrapper, so the heart moves with the card (F3 D20).
  const wrapper = cn(
    'group/card relative h-full rounded-2xl transition duration-200 ease-out',
    'motion-safe:hover:-translate-y-1 motion-reduce:hover:ring-1 motion-reduce:hover:ring-neutral-6',
    'motion-safe:has-[a:active]:scale-[.98] motion-safe:has-[a:active]:duration-150',
  );
  const surface = cn(
    'group relative rounded-2xl bg-white shadow-raised outline-offset-4 transition-colors duration-200 ease-out',
    'active:bg-neutral-7',
    opening && 'pointer-events-none bg-neutral-7',
  );

  if (layout === 'compact') {
    return (
      <div className={wrapper}>
        <Link
          {...linkProps}
          className={cn(surface, 'flex items-center gap-4 p-3', showHeart && 'pr-14', className)}
        >
          <PendingWatcher onSettled={settle} />
          <DishPlate
            src={dish.image}
            sizes="96px"
            soldOut={!dish.isAvailable}
            className="w-22 md:w-24"
          />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <Heading className="line-clamp-2 font-heading text-body-2 leading-tight text-neutral-2">
              {name}
            </Heading>
            <Rating
              decorative
              average={dish.ratingAvg}
              reviews={dish.ratingCount}
              textClassName="text-body-5 text-neutral-3"
            />
            {dish.isAvailable ? (
              <span
                aria-hidden
                className="font-heading text-title-2 text-brand-strong tabular-nums"
              >
                {formatPrice(dish.priceCents)}
              </span>
            ) : (
              <span
                aria-hidden
                className="inline-flex h-6 w-fit items-center rounded-md bg-neutral-1 px-2 text-caption font-medium text-neutral-8"
              >
                Sold out today
              </span>
            )}
          </div>
          {showHeart ? null : (
            <ChevronRight className="size-5 shrink-0 text-neutral-3" aria-hidden />
          )}
        </Link>
        {showHeart ? (
          <FavoriteButton
            dish={dish}
            onToggle={onFavoriteChange}
            className="absolute top-1/2 right-2 z-10 -translate-y-1/2"
          />
        ) : null}
      </div>
    );
  }

  const frame = FRAMES[layout];

  return (
    <div className={wrapper}>
      <Link {...linkProps} className={cn(surface, 'flex h-full flex-col py-6', className)}>
        <PendingWatcher onSettled={settle} />
        {badge}
        <div aria-hidden className="flex justify-center px-7">
          <DishPlate
            src={dish.image}
            sizes={PLATE_SIZES}
            eager={eager}
            soldOut={!dish.isAvailable}
            className={cn(
              frame.plate,
              'transition-transform duration-200 motion-safe:group-hover:rotate-6',
            )}
          />
        </div>
        <div className="mt-6 flex flex-1 flex-col gap-3 px-6">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
            <Heading className={cn('line-clamp-2 font-heading text-neutral-2', frame.name)}>
              {name}
            </Heading>
            {showOffer && dish.offer ? (
              // Read on the dish page; here it would split the card's link text.
              <div aria-hidden>
                <OfferCountdown endsAt={dish.offer.endsAt} />
              </div>
            ) : null}
          </div>
          <Rating
            decorative
            average={dish.ratingAvg}
            reviews={dish.ratingCount}
            starClassName={frame.star}
            textClassName={frame.ratingText}
          />
          {showOffer && flavors.length > 0 ? (
            <p aria-hidden className="text-body-5 text-neutral-3 xl:text-body-4">
              Flavors: {flavors.join(', ')}
            </p>
          ) : null}
          <div aria-hidden className="mt-auto flex items-center justify-between gap-3 pt-1">
            <span className={cn('font-heading text-brand-strong tabular-nums', frame.price)}>
              {formatPrice(dish.priceCents)}
            </span>
            {dish.isAvailable ? (
              <span
                className={cn(
                  'inline-flex items-center rounded-lg bg-brand-strong px-4 font-medium text-white uppercase',
                  frame.button,
                )}
              >
                Order now
              </span>
            ) : (
              <span className="text-body-5 font-medium text-neutral-3">Sold out today</span>
            )}
          </div>
        </div>
      </Link>
      {showHeart ? (
        <FavoriteButton
          dish={dish}
          onToggle={onFavoriteChange}
          className="absolute top-3 right-3 z-10"
        />
      ) : null}
    </div>
  );
}
