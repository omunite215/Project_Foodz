import { z } from 'zod';
import { dishCardSchema } from '@/server/modules/menu/schema';

/*
 * Favorites (F3 S5): dishes a signed-in customer hearts, kept on their account so they show on
 * every device. Only the owner can read or change them (row-level security). The shared demo
 * customer may use them too: they hold no personal data (B13).
 */

export const FAVORITE_LIMIT = 100;

/** Heart on or off. Idempotent: setting the state it already has changes nothing. */
export const setFavoriteInput = z
  .object({
    menuItemId: z.uuid(),
    on: z.boolean(),
  })
  .strict();
export type SetFavoriteInput = z.input<typeof setFavoriteInput>;

export const favoriteStateSchema = z.object({
  menuItemId: z.uuid(),
  /** The state now saved. */
  on: z.boolean(),
  /** How many favorites the account has now. */
  count: z.int().min(0),
  limit: z.literal(FAVORITE_LIMIT),
});
export type FavoriteState = z.infer<typeof favoriteStateSchema>;

/** A favorite as a dish card, with when it was saved. Sold-out dishes stay, flagged (S5.7). */
export const favoriteDishSchema = dishCardSchema.extend({ savedAt: z.iso.datetime() });
export type FavoriteDish = z.infer<typeof favoriteDishSchema>;

export const favoritesListSchema = z.object({
  /** Most recently saved first. Dishes taken off the menu are gone (S5.7). */
  dishes: z.array(favoriteDishSchema),
  count: z.int().min(0),
  limit: z.literal(FAVORITE_LIMIT),
});
export type FavoritesList = z.infer<typeof favoritesListSchema>;

/** For filled hearts on dish cards: the dishes the caller has saved. */
export const favoriteIdsSchema = z.object({ ids: z.array(z.uuid()) });
export type FavoriteIds = z.infer<typeof favoriteIdsSchema>;
