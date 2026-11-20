import 'server-only';
import { cache } from 'react';
import { getActor } from '@/server/auth/session';
import { CampaignPlacement } from '@/server/db/enums';
import { logger } from '@/server/logger';
import { getMyFavoriteIds } from '@/server/modules/favorites/service';
import { displayPhone } from './phone';
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

/**
 * The signed-in customer's favorite dish ids, for hearts that are right in the first HTML (F3
 * S5.9); null when signed out or unavailable (hearts then start empty and fill from the browser).
 */
export const loadFavoriteIds = cache(async (): Promise<string[] | null> => {
  try {
    const actor = await getActor();
    if (actor.kind !== 'user') return null;
    return (await getMyFavoriteIds(actor)).ids;
  } catch (error) {
    logger.error({ err: error }, 'favorites unavailable');
    return null;
  }
});

/** "(617) 555-0142" and its tel: form, from the store settings. */
export function storePhone(status: StoreStatus | null): { display: string; tel: string } | null {
  if (!status?.store.phone) return null;
  const tel = status.store.phone.replace(/\s+/g, '');
  return { display: displayPhone(tel).display, tel };
}

/**
 * A running campaign by id, whatever its placement: the dish page names the code and the deal
 * of its offer (F3 S4.12). Null when it has ended or can't be read.
 */
export const loadCampaign = cache(async (campaignId: string): Promise<CampaignBanner | null> => {
  try {
    const placements = await Promise.all(
      Object.values(CampaignPlacement).map((placement) => listActiveCampaigns(placement)),
    );
    return placements.flat().find((campaign) => campaign.id === campaignId) ?? null;
  } catch (error) {
    logger.error({ err: error }, 'campaign unavailable');
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
