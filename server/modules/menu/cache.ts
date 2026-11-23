import 'server-only';
import { updateTag } from 'next/cache';
import { logger } from '@/server/logger';

/** The cache tag the catalog's cached reads will carry (F1 S4). */
export const MENU_CACHE_TAG = 'menu';

/**
 * Expires the cached menu after a dish's availability changes ("86 it"), so the storefront
 * shows it at once. `updateTag` works only inside a Server Action; outside one (a job, a
 * script) there is no request cache to expire, and the catalog's own revalidation applies.
 */
export function expireMenuCache() {
  try {
    updateTag(MENU_CACHE_TAG);
  } catch (error) {
    logger.debug({ err: error }, 'menu cache not expired outside a Server Action');
  }
}
