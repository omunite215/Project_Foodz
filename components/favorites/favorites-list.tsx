'use client';

import { useQuery } from '@tanstack/react-query';
import { Undo2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { listFavoritesAction } from '@/server/modules/favorites/actions';
import type { FavoriteDish } from '@/server/modules/favorites/schema';
import { useAccount } from '@/components/account/account-context';
import { DishCard } from '@/components/dish/dish-card';
import { FormAlert } from '@/components/forms/form-alert';
import { EmptyState } from '@/components/states/empty-state';
import { Button } from '@/components/ui/button';
import { callAction } from '@/lib/action-result';
import { announce } from '@/lib/announce';
import { useFavorites } from './favorites-context';

/*
 * `/account/favorites` (F3 S5.4 to S5.7, design 4): the dishes she hearted, newest first, as
 * compact cards. Unhearting one here removes it from the list at once, with an undo in the status
 * slot above; another tab's changes arrive when this tab is shown again.
 */

interface Removed {
  dish: FavoriteDish;
}

export function FavoritesList({ dishes }: { dishes: FavoriteDish[] }) {
  const account = useAccount();
  const favorites = useFavorites();
  const [mountedAt] = useState(() => Date.now());
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [removed, setRemoved] = useState<Removed | null>(null);
  /** Where focus goes once the list has been drawn without (or with) the card. */
  const focusNext = useRef<{ id: string; target: 'link' | 'heart' } | 'browse' | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const browseRef = useRef<HTMLAnchorElement>(null);

  const query = useQuery({
    queryKey: ['favorites', 'list'],
    queryFn: async () => {
      const outcome = await callAction(() => listFavoritesAction());
      if (!outcome.ok) throw new Error(outcome.error.message);
      return outcome.data.dishes;
    },
    initialData: dishes,
    initialDataUpdatedAt: mountedAt,
    staleTime: 10_000,
    refetchOnWindowFocus: true,
  });
  const all = query.data;
  const shown = all.filter((dish) => !hidden.has(dish.id));

  useEffect(() => {
    const next = focusNext.current;
    if (!next) return;
    focusNext.current = null;
    if (next === 'browse') {
      browseRef.current?.focus();
      return;
    }
    const item = listRef.current?.querySelector<HTMLElement>(`[data-dish-id="${next.id}"]`);
    const target =
      next.target === 'link'
        ? item?.querySelector<HTMLElement>('a[href]')
        : item?.querySelector<HTMLElement>('button[aria-pressed]');
    target?.focus();
  });

  const unheart = (dish: FavoriteDish) => {
    const index = shown.findIndex((item) => item.id === dish.id);
    const rest = shown.filter((item) => item.id !== dish.id);
    const next = rest[index] ?? rest[index - 1] ?? null;
    setHidden((current) => new Set([...current, dish.id]));
    setRemoved({ dish });
    announce(`${dish.title} removed from your favorites.`);
    focusNext.current = next ? { id: next.id, target: 'link' } : 'browse';
  };

  const undo = () => {
    if (!removed) return;
    const { dish } = removed;
    favorites?.set(dish, true, { quiet: true });
    setHidden((current) => {
      const next = new Set(current);
      next.delete(dish.id);
      return next;
    });
    setRemoved(null);
    announce(`${dish.title} saved to your favorites.`);
    focusNext.current = { id: dish.id, target: 'heart' };
  };

  return (
    <div>
      <h1 className="font-heading text-h4 leading-tight text-neutral-2 md:text-h3">Favorites</h1>
      <p className="mt-2 text-body-4 text-muted-foreground">
        Dishes you&apos;ve saved, newest first.
      </p>
      {account.isDemo ? (
        <p className="text-body-4 text-muted-foreground">
          Favorites on the demo account are cleared every night.
        </p>
      ) : null}

      {removed ? (
        <div className="mt-6">
          <FormAlert
            variant="info"
            action={
              <Button
                type="button"
                variant="outline"
                size="touch"
                className="bg-white"
                onClick={undo}
              >
                <Undo2 className="size-4" aria-hidden />
                Undo<span className="sr-only"> removing {removed.dish.title}</span>
              </Button>
            }
          >
            {removed.dish.title} removed from your favorites.
          </FormAlert>
        </div>
      ) : null}

      {shown.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-neutral-6 bg-white px-5 py-12">
          <EmptyState
            illustration="favorites"
            title="No favorites yet"
            description="Tap the heart on any dish to keep it here."
            action={
              <Button asChild size="touch" className="uppercase">
                <Link ref={browseRef} href="/menu">
                  Browse the menu
                </Link>
              </Button>
            }
          />
        </div>
      ) : (
        <ul ref={listRef} className="mt-6 grid gap-4 md:grid-cols-2 md:gap-6">
          {shown.map((dish) => (
            <li key={dish.id} data-dish-id={dish.id}>
              <DishCard
                dish={dish}
                layout="compact"
                headingLevel="h2"
                className="h-full"
                onFavoriteChange={(on) => {
                  if (!on) unheart(dish);
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
