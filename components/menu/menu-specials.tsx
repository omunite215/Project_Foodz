import type { CampaignBanner } from '@/server/modules/menu/schema';
import { DishCard } from '@/components/dish/dish-card';

/**
 * Today's specials above the tabs. Hidden when the campaign is not running or has nothing
 * available, and the tabs move up with no gap. There is no "See specials" button here: this
 * page already is the menu.
 */
export function MenuSpecials({ campaign }: { campaign: CampaignBanner | null }) {
  if (!campaign || campaign.dishes.length === 0) return null;

  return (
    <section aria-labelledby="menu-specials-title" className="mt-10 md:mt-15">
      <h2 id="menu-specials-title" className="font-heading text-title-1 text-neutral-2 md:text-h4">
        {campaign.title}
      </h2>
      {campaign.subtitle ? (
        <p className="mt-2 text-body-5 text-neutral-3 md:text-body-4">{campaign.subtitle}</p>
      ) : null}
      <ul className="mt-6 grid gap-4 md:grid-cols-3 md:gap-6">
        {campaign.dishes.map((dish) => (
          <li key={dish.id}>
            <DishCard dish={dish} layout="compact" className="h-full" />
          </li>
        ))}
      </ul>
    </section>
  );
}
