'use client';

import { Debouncer } from '@tanstack/react-pacer';
import { type QueryClient, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { listFavoriteIdsAction, setFavoriteAction } from '@/server/modules/favorites/actions';
import { showStatusToast } from '@/components/layout/status-toast';
import { type ActionFailure, callAction, isOffline } from '@/lib/action-result';
import { announce } from '@/lib/announce';
import { isAuthPage } from '@/lib/auth-links';
import {
  clearPendingFavorite,
  pendingFavoriteStep,
  readPendingFavorite,
  signInFor,
  writePendingFavorite,
} from '@/lib/sign-in-reason';
import { type FavoriteDish, FavoritesContext, type FavoritesValue } from './favorites-context';

/*
 * Favorites on every page (F3 S5, design 3.1, 3.2). Hearts are right in the first HTML: the
 * signed-in customer's saved dishes come with the page. A tap flips the heart at once; the
 * request goes 300 ms after the last tap with the final state, and only when it differs from the
 * saved one, so a quick double tap ends unchanged with nothing sent. Another tab's changes arrive
 * when this tab is shown again.
 */

const IDS_KEY = ['favorites', 'ids'] as const;
const NONE: string[] = [];
const SETTLE_MS = 300;
const OFFLINE_TEXT = "You're offline. Try again when you're back online.";

function failureToast(failure: ActionFailure, dish: FavoriteDish, on: boolean) {
  switch (failure.code) {
    case 'LIMIT_REACHED':
      showStatusToast({
        variant: 'warning',
        text: 'You can keep up to 100 favorites. Remove one to add another.',
        link: { href: '/account/favorites', label: 'See your favorites' },
      });
      return;
    case 'RATE_LIMITED':
      showStatusToast({
        variant: 'error',
        text: "You're changing favorites very fast. Try again in a minute.",
      });
      return;
    case 'OFFLINE':
      showStatusToast({ variant: 'info', text: OFFLINE_TEXT });
      return;
    default:
      showStatusToast({
        variant: 'error',
        text: on
          ? `We couldn't save ${dish.title} to your favorites. Check your connection and try again.`
          : `We couldn't remove ${dish.title} from your favorites. Check your connection and try again.`,
      });
  }
}

function markSavedIn(queryClient: QueryClient, dishId: string, on: boolean) {
  queryClient.setQueryData<string[]>(IDS_KEY, (current = []) => {
    if (!on) return current.filter((id) => id !== dishId);
    return current.includes(dishId) ? current : [dishId, ...current];
  });
}

const savedText = (dish: FavoriteDish, on: boolean) =>
  on ? `${dish.title} saved to your favorites.` : `${dish.title} removed from your favorites.`;

export function FavoritesProvider({
  signedIn,
  ids,
  children,
}: {
  signedIn: boolean;
  /** The signed-in customer's favorites, read with the page; null when signed out. */
  ids: string[] | null;
  children: ReactNode;
}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const [wanted, setWanted] = useState<ReadonlyMap<string, boolean>>(new Map());
  const wantedRef = useRef(wanted);
  const debouncers = useRef(new Map<string, Debouncer<(dish: FavoriteDish) => void>>());
  /** Each dish's latest save, done whatever its outcome: the next one waits for it. */
  const inFlight = useRef(new Map<string, Promise<void>>());
  /** Dishes whose change the page announces itself. */
  const quiet = useRef(new Set<string>());
  const [mountedAt] = useState(() => Date.now());

  const saved = useQuery({
    queryKey: IDS_KEY,
    queryFn: async () => {
      const outcome = await callAction(() => listFavoriteIdsAction());
      if (!outcome.ok) throw new Error(outcome.error.message);
      return outcome.data.ids;
    },
    enabled: signedIn,
    initialData: ids ?? [],
    initialDataUpdatedAt: mountedAt,
    staleTime: 10_000,
    refetchOnWindowFocus: true,
  });
  const savedIds = signedIn ? saved.data : NONE;

  // A new server render (signed in or out since) brings its own list.
  const idsKey = ids === null ? 'signed-out' : ids.join(',');
  const firstIds = useRef(idsKey);
  useEffect(() => {
    if (idsKey === firstIds.current) return;
    firstIds.current = idsKey;
    queryClient.setQueryData(
      IDS_KEY,
      idsKey === 'signed-out' ? [] : idsKey.split(',').filter(Boolean),
    );
  }, [idsKey, queryClient]);

  const writeWanted = (update: (current: Map<string, boolean>) => void) => {
    const next = new Map(wantedRef.current);
    update(next);
    wantedRef.current = next;
    setWanted(next);
  };

  const markSaved = (dishId: string, on: boolean) => markSavedIn(queryClient, dishId, on);

  /**
   * One dish's saves run one after another: an earlier one may still be on its way (Undo right
   * after removing). The next compares with what that one saved, not with the list from before it,
   * or the second change would never be sent.
   */
  async function settle(dish: FavoriteDish) {
    const before = inFlight.current.get(dish.id);
    const run = (async () => {
      await before;
      await settleNow(dish);
    })();
    const done = run.then(
      () => undefined,
      () => undefined,
    );
    inFlight.current.set(dish.id, done);
    try {
      await run;
    } finally {
      if (inFlight.current.get(dish.id) === done) inFlight.current.delete(dish.id);
    }
  }

  async function settleNow(dish: FavoriteDish) {
    const desired = wantedRef.current.get(dish.id);
    if (desired === undefined) return;
    const current = (queryClient.getQueryData<string[]>(IDS_KEY) ?? []).includes(dish.id);
    if (desired === current) {
      writeWanted((map) => map.delete(dish.id));
      return;
    }
    const outcome = await callAction(() => setFavoriteAction({ menuItemId: dish.id, on: desired }));
    // A newer tap is waiting: it settles on its own.
    if (wantedRef.current.get(dish.id) !== desired) {
      if (outcome.ok) markSaved(dish.id, outcome.data.on);
      return;
    }
    writeWanted((map) => map.delete(dish.id));
    if (outcome.ok) {
      markSaved(dish.id, outcome.data.on);
      if (!quiet.current.has(dish.id)) announce(savedText(dish, outcome.data.on));
    } else {
      failureToast(outcome.error, dish, desired);
    }
  }

  const latest = useRef(settle);
  useEffect(() => {
    latest.current = settle;
  });

  const schedule = (dish: FavoriteDish) => {
    const debouncer =
      debouncers.current.get(dish.id) ??
      new Debouncer<(next: FavoriteDish) => void>(
        (next) => {
          void latest.current(next);
        },
        { wait: SETTLE_MS },
      );
    debouncers.current.set(dish.id, debouncer);
    debouncer.maybeExecute(dish);
  };

  const isFavorite = (dishId: string) => wanted.get(dishId) ?? savedIds.includes(dishId);

  const set = (dish: FavoriteDish, on: boolean, options?: { quiet?: boolean }) => {
    if (options?.quiet) quiet.current.add(dish.id);
    else quiet.current.delete(dish.id);
    writeWanted((map) => map.set(dish.id, on));
    schedule(dish);
  };

  const toggle = (dish: FavoriteDish, options?: { quiet?: boolean }) => {
    if (!signedIn) {
      const path = `${window.location.pathname}${window.location.search}`;
      writePendingFavorite({ dishId: dish.id, title: dish.title, path, at: Date.now() });
      router.push(signInFor('/sign-in', path, 'favorite'));
      return false;
    }
    if (isOffline()) {
      showStatusToast({ variant: 'info', text: OFFLINE_TEXT });
      return false;
    }
    set(dish, !isFavorite(dish.id), options);
    return true;
  };

  // Leaving the site within the 300 ms of a tap still sends it.
  useEffect(() => {
    const flush = () => {
      for (const debouncer of debouncers.current.values()) debouncer.flush();
    };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, []);

  // A heart tapped while signed out is saved on the return from signing in (design 3.2).
  useEffect(() => {
    const pending = readPendingFavorite();
    if (!pending) return;
    const step = pendingFavoriteStep(pending, {
      signedIn,
      path: `${window.location.pathname}${window.location.search}`,
      onAuthPage: isAuthPage(pathname),
      now: Date.now(),
    });
    if (step === 'keep') return;
    clearPendingFavorite();
    if (step === 'drop') return;
    const dish = { id: pending.dishId, title: pending.title };
    void (async () => {
      const outcome = await callAction(() => setFavoriteAction({ menuItemId: dish.id, on: true }));
      if (outcome.ok) {
        markSavedIn(queryClient, dish.id, true);
        announce(savedText(dish, true));
      } else {
        failureToast(outcome.error, dish, true);
      }
    })();
  }, [pathname, signedIn, queryClient]);

  // Consumers re-render when a heart changes; the actions always use the newest state.
  const actions = useRef({ toggle, set });
  useEffect(() => {
    actions.current = { toggle, set };
  });
  const value = useMemo<FavoritesValue>(
    () => ({
      signedIn,
      isFavorite: (dishId) => wanted.get(dishId) ?? savedIds.includes(dishId),
      toggle: (dish, options) => actions.current.toggle(dish, options),
      set: (dish, on, options) => actions.current.set(dish, on, options),
    }),
    [signedIn, wanted, savedIds],
  );

  return <FavoritesContext value={value}>{children}</FavoritesContext>;
}
