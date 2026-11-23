'use client';

import { Heart } from 'lucide-react';
import { useRef } from 'react';
import { pop } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { type FavoriteDish, useFavorites } from './favorites-context';

/**
 * The heart (F3 design 3.1): a 44 px white circle beside the card's link, never inside it, so the
 * card stays one link. Its name never changes ("Favorite Bulgogi"); `aria-pressed` says whether
 * the dish is saved. The pressed heart is pink on its white circle (3.37:1 for a graphic).
 */
export function FavoriteButton({
  dish,
  className,
  onToggle,
}: {
  dish: FavoriteDish;
  className?: string;
  /**
   * Called after the tap, with the new state (the favorites page removes the card); the caller
   * then announces the change itself.
   */
  onToggle?: (on: boolean) => void;
}) {
  const favorites = useFavorites();
  const iconRef = useRef<SVGSVGElement>(null);
  if (!favorites) return null;
  const on = favorites.isFavorite(dish.id);

  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={`Favorite ${dish.title}`}
      onClick={() => {
        if (favorites.toggle(dish, { quiet: onToggle !== undefined })) {
          pop(iconRef.current);
          onToggle?.(!on);
        }
      }}
      className={cn(
        'flex size-11 items-center justify-center rounded-full bg-white shadow-card outline-none hover:bg-neutral-7 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid',
        className,
      )}
    >
      <Heart
        ref={iconRef}
        strokeWidth={2}
        aria-hidden
        className={cn(
          'size-[22px] transition-colors duration-150',
          on ? 'fill-tag-4 text-tag-4' : 'text-neutral-3',
        )}
      />
    </button>
  );
}
