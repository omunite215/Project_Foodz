'use server';

import { userAction } from '@/server/action';
import { setFavoriteInput } from './schema';
import { getMyFavoriteIds, getMyFavorites, setFavorite } from './service';

/*
 * The signed-in customer's own favorites (F3 S5). There is no user id in any input: the
 * session decides whose favorites these are. The demo customer may use them (B13), so none of
 * these is marked `write`; the `favorite:manage-own` permission is checked in the service.
 */

export const setFavoriteAction = userAction
  .metadata({ name: 'favorites.set', rateLimit: 'favorites.write' })
  .inputSchema(setFavoriteInput)
  .action(async ({ parsedInput, ctx }) => setFavorite(ctx.actor, parsedInput));

export const listFavoritesAction = userAction
  .metadata({ name: 'favorites.list', rateLimit: 'favorites.read' })
  .action(async ({ ctx }) => getMyFavorites(ctx.actor));

export const listFavoriteIdsAction = userAction
  .metadata({ name: 'favorites.ids', rateLimit: 'favorites.read' })
  .action(async ({ ctx }) => getMyFavoriteIds(ctx.actor));
