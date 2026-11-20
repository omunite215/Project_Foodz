import 'server-only';
import { can } from '@/server/auth/roles';
import type { UserActor } from '@/server/auth/session';
import { runAs } from '@/server/db/context';
import { AppError, forbidden, limitReached } from '@/server/errors';
import { listDishCards } from '@/server/modules/menu/service';
import {
  countOwn,
  dishExists,
  findOwn,
  insert,
  listOwn,
  listOwnWithTitles,
  lockFavorites,
  remove,
} from './repo';
import {
  FAVORITE_LIMIT,
  type FavoriteIds,
  type FavoritesList,
  type FavoriteState,
  setFavoriteInput,
} from './schema';

/*
 * A signed-in customer's favorites (F3 S5). Only the owner reads or changes them; the actor's own
 * id is the only one ever used, and row-level security enforces the same. Unlike the rest of the
 * account, the shared demo customer may change favorites (B13): they hold no personal data.
 */

const LIMIT_MESSAGE = `You can keep up to ${FAVORITE_LIMIT} favorites. Remove one to add another.`;
const DISH_GONE = "That dish isn't on our menu any more.";

function assertCanUse(actor: UserActor) {
  if (!can(actor.role, { favorite: ['manage-own'] })) throw forbidden();
}

/** Hearts a dish on or off. Idempotent, so a fast double tap ends where two taps should (S5.8). */
export async function setFavorite(actor: UserActor, input: unknown): Promise<FavoriteState> {
  assertCanUse(actor);
  const { menuItemId, on } = setFavoriteInput.parse(input);

  return runAs(actor, async (ctx) => {
    await lockFavorites(ctx, actor.userId);
    if (on && !(await findOwn(ctx, actor.userId, menuItemId))) {
      if (!(await dishExists(ctx, menuItemId))) {
        throw new AppError('NOT_FOUND', DISH_GONE, 404);
      }
      if ((await countOwn(ctx, actor.userId)) >= FAVORITE_LIMIT) throw limitReached(LIMIT_MESSAGE);
      await insert(ctx, actor.userId, menuItemId);
    } else if (!on) {
      await remove(ctx, actor.userId, menuItemId);
    }
    return { menuItemId, on, count: await countOwn(ctx, actor.userId), limit: FAVORITE_LIMIT };
  });
}

/** `/account/favorites`: dish cards, most recently saved first (S5.4). */
export async function getMyFavorites(actor: UserActor, at = new Date()): Promise<FavoritesList> {
  assertCanUse(actor);
  const rows = await runAs(actor, (ctx) => listOwn(ctx, actor.userId));
  const ids = rows.map((row) => row.menuItemId);
  const cards = new Map((await listDishCards(ids, at)).map((card) => [card.id, card]));
  const dishes = rows.flatMap((row) => {
    const card = cards.get(row.menuItemId);
    return card ? [{ ...card, savedAt: row.createdAt.toISOString() }] : [];
  });
  return { dishes, count: dishes.length, limit: FAVORITE_LIMIT };
}

/** The dishes to show with a filled heart, for server-rendered cards (S5.9). */
export async function getMyFavoriteIds(actor: UserActor): Promise<FavoriteIds> {
  assertCanUse(actor);
  const rows = await runAs(actor, (ctx) => listOwn(ctx, actor.userId));
  return { ids: rows.map((row) => row.menuItemId) };
}

export async function countMyFavorites(actor: UserActor): Promise<number> {
  return runAs(actor, (ctx) => countOwn(ctx, actor.userId));
}

/** For "Download my data" (S5.11): dish names and when they were saved. */
export async function listMyFavoritesForExport(actor: UserActor) {
  const rows = await runAs(actor, (ctx) => listOwnWithTitles(ctx, actor.userId));
  return rows.map((row) => ({ dish: row.menuItem.title, savedAt: row.createdAt.toISOString() }));
}
