import type { CampaignBanner as Campaign } from '@/server/modules/menu/schema';
import { PageContainer } from '@/components/layout/page-container';
import { CampaignBanner } from './campaign-banner';
import { OfferCarousel } from './offer-carousel';

/**
 * Running Home campaigns. Nothing at all when none is running: no gap and no empty carousel.
 * Two or more become slides of a carousel the visitor moves.
 */
export function CampaignSection({ campaigns }: { campaigns: Campaign[] }) {
  const [only] = campaigns;
  if (!only) return null;

  return (
    <section className="pt-10 md:pt-15 xl:pt-20">
      <PageContainer>
        {campaigns.length === 1 ? (
          <CampaignBanner campaign={only} />
        ) : (
          <OfferCarousel
            label="Offers"
            slides={campaigns.map((campaign) => ({
              key: campaign.id,
              content: <CampaignBanner campaign={campaign} />,
            }))}
            slideClassName="basis-full"
            controlsClassName="mt-4 justify-end"
          />
        )}
      </PageContainer>
    </section>
  );
}
