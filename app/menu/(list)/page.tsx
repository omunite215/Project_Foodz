import type { Metadata } from 'next';
import { PageContainer } from '@/components/layout/page-container';
import { MenuBrowser } from '@/components/menu/menu-browser';
import { MenuIntro } from '@/components/menu/menu-intro';
import { MenuSkeleton } from '@/components/menu/menu-skeleton';
import { MenuSpecials } from '@/components/menu/menu-specials';
import { HoldSkeleton } from '@/components/states/loading-region';
import {
  countDishesByCuisine,
  listActiveCampaigns,
  listMenu,
  searchMenu,
} from '@/server/modules/menu/service';
import { parseMenuQuery, priceBounds } from '@/lib/menu-query';
import { loadStoreStatus, readOrNull } from '@/lib/storefront-data';

export const metadata: Metadata = { title: 'Menu' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * The whole menu in one render: every cuisine, available dishes first and sold-out ones after.
 * The tabs and the price range filter in the browser; a search in the address (a reload, a
 * shared link) is run here, so the same results show before any script does (F3 S6.13). If the
 * menu cannot be read, error.tsx offers "Try again".
 */
export default async function MenuPage({ searchParams }: { searchParams: SearchParams }) {
  const [params, dishes, counts, specials, status] = await Promise.all([
    searchParams,
    listMenu(),
    countDishesByCuisine(),
    listActiveCampaigns('MENU_TOP'),
    loadStoreStatus(),
  ]);
  const bounds = priceBounds(dishes);
  const query = parseMenuQuery(params, bounds);
  // A search that fails here is run again by the browser.
  const search = query.q ? await readOrNull('menu search', () => searchMenu({ q: query.q })) : null;
  const campaign = specials[0] ?? null;

  return (
    <HoldSkeleton skeleton={<MenuSkeleton />}>
      <PageContainer className="pt-10 pb-15 md:pt-20 md:pb-20">
        <MenuIntro status={status} />
        <MenuSpecials campaign={campaign} />
        <MenuBrowser
          dishes={dishes}
          counts={counts}
          bounds={bounds}
          initialSearch={search}
          specials={campaign?.dishes ?? []}
        />
      </PageContainer>
    </HoldSkeleton>
  );
}
