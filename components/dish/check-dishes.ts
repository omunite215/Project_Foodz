import type { DishCard } from '@/server/modules/menu/schema';
import { dishesByIdAction } from '@/server/modules/menu/actions';

/** Past this, the cart is updated without waiting: checkout checks every line again. */
const CHECK_TIMEOUT_MS = 2000;

/**
 * Current price and availability of dishes about to go into the cart, by id. Null when the
 * check could not be made in time (offline, slow, rate limited): callers then add anyway.
 */
export async function checkDishes(ids: string[]): Promise<Map<string, DishCard> | null> {
  if (ids.length === 0) return new Map();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), CHECK_TIMEOUT_MS);
  });
  try {
    const result = await Promise.race([dishesByIdAction({ ids }), timeout]);
    if (!result?.data) return null;
    return new Map(result.data.map((dish) => [dish.id, dish]));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
