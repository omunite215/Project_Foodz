import 'server-only';
import { cache } from 'react';
import { logger } from '@/server/logger';
import { getDishBySlug, getStoreStatus, listActiveCampaigns } from '@/server/modules/menu/service';
import type { CampaignBanner, StoreStatus } from '@/server/modules/menu/schema';

/*
 * Reads shared by the layout and the pages of one request. Each runs once per request (React
 * cache), so the header, footer and page agree on the same store status.
 *
 * The shell must render even when the database does not answer: these return null on failure
 * and the page shows its "unavailable" state instead of an error page.
 */

/** Open/closed state, hours, contact details and footer links; null when unavailable. */
export const loadStoreStatus = cache(async (): Promise<StoreStatus | null> => {
  try {
    return await getStoreStatus();
  } catch (error) {
    logger.error({ err: error }, 'store status unavailable');
    return null;
  }
});

/** The announcement bar's campaign (highest priority first), or null. */
export const loadAnnouncement = cache(async (): Promise<CampaignBanner | null> => {
  try {
    return (await listActiveCampaigns('ANNOUNCEMENT_BAR'))[0] ?? null;
  } catch (error) {
    logger.error({ err: error }, 'announcement unavailable');
    return null;
  }
});

/** A dish page's data, shared by its layout (404 check), metadata and page. */
export const loadDish = cache((slug: string) => getDishBySlug(slug));

/** Runs a read and returns null instead of throwing, for sections that can show an error state. */
export async function readOrNull<T>(what: string, read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    logger.error({ err: error }, `${what} unavailable`);
    return null;
  }
}
