import type { Metadata } from 'next';
import { PageContainer } from '@/components/layout/page-container';
import { CuisineMenu } from '@/components/menu/cuisine-menu';
import { MenuIntro } from '@/components/menu/menu-intro';
import { MenuSkeleton } from '@/components/menu/menu-skeleton';
import { MenuSpecials } from '@/components/menu/menu-specials';
import { HoldSkeleton } from '@/components/states/loading-region';
import { countDishesByCuisine, listActiveCampaigns, listMenu } from '@/server/modules/menu/service';
import { loadStoreStatus } from '@/lib/storefront-data';

export const metadata: Metadata = { title: 'Menu' };

/**
 * The whole menu in one render: every cuisine, available dishes first and sold-out ones after.
 * The tabs filter in the browser. If the menu cannot be read, error.tsx offers "Try again".
 */
export default async function MenuPage() {
  const [dishes, counts, specials, status] = await Promise.all([
    listMenu(),
    countDishesByCuisine(),
    listActiveCampaigns('MENU_TOP'),
    loadStoreStatus(),
  ]);

  return (
    <HoldSkeleton skeleton={<MenuSkeleton />}>
      <PageContainer className="pt-10 pb-15 md:pt-20 md:pb-20">
        <MenuIntro status={status} />
        <MenuSpecials campaign={specials[0] ?? null} />
        <CuisineMenu dishes={dishes} counts={counts} />
      </PageContainer>
    </HoldSkeleton>
  );
}
