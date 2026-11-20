import 'server-only';
import { db } from '@/server/db/client';
import type { DbContext } from '@/server/db/context';

/*
 * Row-level security limits every query here to the caller's own favorites (favorites_access:
 * user_id = the signed-in user, for reads and writes alike). The user id filters below say the
 * same thing in the query.
 */

/** Serialises one account's favorite changes, so the 100 limit holds under double taps. */
export async function lockFavorites(ctx: DbContext, userId: string) {
  await db(ctx)
    .$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`favorites:${userId}`}, 0))`;
}

/** Most recently saved first. */
export function listOwn(ctx: DbContext, userId: string) {
  return db(ctx).favorite.findMany({
    where: { userId },
    orderBy: [{ createdAt: 'desc' }, { menuItemId: 'asc' }],
    select: { menuItemId: true, createdAt: true },
  });
}

/** For the data export: the dish name with each favorite. */
export function listOwnWithTitles(ctx: DbContext, userId: string) {
  return db(ctx).favorite.findMany({
    where: { userId },
    orderBy: [{ createdAt: 'desc' }, { menuItemId: 'asc' }],
    select: { createdAt: true, menuItem: { select: { title: true } } },
  });
}

export function countOwn(ctx: DbContext, userId: string) {
  return db(ctx).favorite.count({ where: { userId } });
}

export function findOwn(ctx: DbContext, userId: string, menuItemId: string) {
  return db(ctx).favorite.findUnique({
    where: { userId_menuItemId: { userId, menuItemId } },
    select: { menuItemId: true },
  });
}

/** Whether the dish is on the menu (sold-out dishes count; they can still be favorites). */
export async function dishExists(ctx: DbContext, menuItemId: string) {
  const dish = await db(ctx).menuItem.findUnique({
    where: { id: menuItemId },
    select: { id: true },
  });
  return dish !== null;
}

export async function insert(ctx: DbContext, userId: string, menuItemId: string) {
  await db(ctx).favorite.create({ data: { userId, menuItemId }, select: { menuItemId: true } });
}

export async function remove(ctx: DbContext, userId: string, menuItemId: string) {
  const result = await db(ctx).favorite.deleteMany({ where: { userId, menuItemId } });
  return result.count;
}
