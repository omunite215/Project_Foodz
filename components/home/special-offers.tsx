'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { DishCard as Dish } from '@/server/modules/menu/schema';
import { DishCard } from '@/components/dish/dish-card';
import { PageContainer } from '@/components/layout/page-container';
import { EmptyState } from '@/components/states/empty-state';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { OfferCarousel } from './offer-carousel';

function OffersError() {
  const router = useRouter();
  const [retrying, setRetrying] = useState(false);

  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <p className="text-body-4 text-neutral-3">We couldn&apos;t load today&apos;s offers.</p>
      <Button
        type="button"
        variant="outline"
        size="touch"
        aria-disabled={retrying || undefined}
        onClick={() => {
          setRetrying(true);
          router.refresh();
          setTimeout(() => setRetrying(false), 1500);
        }}
        className="border-brand-strong text-brand-strong"
      >
        Try again
      </Button>
    </div>
  );
}

/**
 * Today's special offers. Phones and tablets get a carousel (featured dish first); from `lg`
 * the three cards sit in a row with the featured one in the middle. More than three specials
 * stay a carousel at every width.
 */
export function SpecialOffersCards({
  specials,
  featuredFlavors,
}: {
  specials: Dish[];
  featuredFlavors: readonly string[];
}) {
  const [featured, ...others] = specials;
  if (!featured) return null;

  const slides = specials.map((dish, index) => ({
    key: dish.id,
    content: (
      <DishCard
        dish={dish}
        layout="featured"
        showOffer={index === 0}
        flavors={index === 0 ? featuredFlavors : []}
        eager={index === 0}
        className="mx-auto w-full max-w-[327px]"
      />
    ),
  }));

  const rowFits = specials.length <= 3;
  // The featured card goes in the middle of the row.
  const row = others.length > 0 ? [others[0], featured, ...others.slice(1)] : [featured];

  return (
    <>
      <OfferCarousel
        label="Today's special offers"
        slides={slides}
        slideClassName={cn('basis-full md:basis-[360px]', !rowFits && 'lg:basis-1/3')}
        className={rowFits ? 'lg:hidden' : undefined}
      />
      {rowFits ? (
        <ul
          className={cn(
            'hidden items-start gap-6 lg:grid',
            row.length === 3
              ? 'lg:grid-cols-[285fr_310fr_285fr] xl:grid-cols-[1fr_1.32fr_1fr] xl:gap-x-12 min-[90rem]:gap-x-[84px]'
              : 'lg:grid-cols-[repeat(auto-fit,minmax(0,340px))] lg:justify-center',
          )}
        >
          {row.map((dish) =>
            dish ? (
              <li key={dish.id} className="h-full">
                <DishCard
                  dish={dish}
                  layout={dish === featured ? 'featured' : 'responsive'}
                  showOffer={dish === featured}
                  flavors={dish === featured ? featuredFlavors : []}
                />
              </li>
            ) : null,
          )}
        </ul>
      ) : null}
    </>
  );
}

export function SpecialOffers({
  specials,
  featuredFlavors,
}: {
  /** Null: the offers could not be loaded. */
  specials: Dish[] | null;
  featuredFlavors: readonly string[];
}) {
  return (
    <section id="specials" aria-labelledby="specials-title" className="scroll-mt-6">
      <PageContainer className="py-10 xl:pt-30 xl:pb-20">
        <div className="mx-auto max-w-[770px] text-center">
          <h2
            id="specials-title"
            className="font-heading text-title-1 leading-tight text-neutral-2 md:text-h2"
          >
            Today&apos;s special offers
          </h2>
          <p className="mt-2 text-body-5 text-muted-foreground md:mt-3 md:text-body-1 xl:text-neutral-3">
            Picked by our cooks today. Hot food at your door in about 45 minutes.
          </p>
        </div>
        <div className="mt-8 md:mt-20">
          {specials === null ? (
            <OffersError />
          ) : specials.length === 0 ? (
            <EmptyState
              title="No specials today"
              description="Our full menu is ready when you are."
              titleAs="h3"
              action={
                <Button asChild size="touch">
                  <Link href="/menu">Browse the menu</Link>
                </Button>
              }
            />
          ) : (
            <SpecialOffersCards specials={specials} featuredFlavors={featuredFlavors} />
          )}
        </div>
      </PageContainer>
    </section>
  );
}
