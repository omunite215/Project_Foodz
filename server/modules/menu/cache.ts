import 'server-only';
import { revalidatePath, updateTag } from 'next/cache';
import { logger } from '@/server/logger';

/** The cache tag the catalog's cached reads will carry (F1 S4). */
export const MENU_CACHE_TAG = 'menu';

/**
 * Expires the cached menu after a dish's availability changes ("86 it"), so the storefront
 * shows it at once: the tagged reads, and the menu and dish pages any router has kept. Both
 * work only inside a Server Action; outside one (a job, a script) there is nothing to expire.
 * Menus already open in a browser read themselves again within 30 seconds (useFreshMenu).
 */
export function expireMenuCache() {
  try {
    updateTag(MENU_CACHE_TAG);
    revalidatePath('/menu', 'layout');
    revalidatePath('/');
  } catch (error) {
    logger.debug({ err: error }, 'menu cache not expired outside a Server Action');
  }
}
