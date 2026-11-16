import { CampaignSection } from '@/components/home/campaign-section';
import { HomeHero } from '@/components/home/home-hero';
import { HowWeWork } from '@/components/home/how-we-work';
import { KitchenSection } from '@/components/home/kitchen-section';
import { SpecialOffers } from '@/components/home/special-offers';
import { TasteSection } from '@/components/home/taste-section';
import {
  listActiveCampaigns,
  listAvailableDishes,
  listSpecials,
} from '@/server/modules/menu/service';
import { loadDish, loadStoreStatus, readOrNull } from '@/lib/storefront-data';

export default async function HomePage() {
  const [status, campaigns, specials, available] = await Promise.all([
    loadStoreStatus(),
    readOrNull('home campaigns', () => listActiveCampaigns('HOME_CAROUSEL')),
    readOrNull('specials', () => listSpecials()),
    readOrNull('available dishes', () => listAvailableDishes()),
  ]);

  // The featured offer lists its flavors, which only the dish page data carries.
  const featured = specials?.[0];
  const featuredFlavors = featured
    ? ((await readOrNull('featured dish', () => loadDish(featured.slug)))?.flavors ?? [])
    : [];

  return (
    <>
      <HomeHero status={status} />
      <CampaignSection campaigns={campaigns ?? []} />
      <SpecialOffers specials={specials} featuredFlavors={featuredFlavors} />
      <KitchenSection />
      <HowWeWork />
      <TasteSection dishes={available ?? []} status={status} />
    </>
  );
}
