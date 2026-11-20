'use client';

import { createContext, useContext } from 'react';

/*
 * What a heart needs to know (F3 S5). The provider (favorites-provider.tsx) fills it from the
 * server render and the browser; cards and hearts only read it, so they carry no server code.
 */

export interface FavoriteDish {
  id: string;
  title: string;
}

export interface FavoritesValue {
  signedIn: boolean;
  isFavorite: (dishId: string) => boolean;
  /**
   * A tap on a heart: flips it and says true (signed out or offline: false, nothing flips).
   * `quiet`: the caller announces the change itself (the favorites page).
   */
  toggle: (dish: FavoriteDish, options?: { quiet?: boolean }) => boolean;
  /** Sets a heart directly (the favorites page's undo). */
  set: (dish: FavoriteDish, on: boolean, options?: { quiet?: boolean }) => void;
}

export const FavoritesContext = createContext<FavoritesValue | null>(null);

/** Null outside the provider (Storybook): cards then show no heart. */
export function useFavorites(): FavoritesValue | null {
  return useContext(FavoritesContext);
}
