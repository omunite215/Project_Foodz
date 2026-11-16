import { Clock } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DishChip } from '@/components/dish/dish-chip';
import { DishDetailSkeleton } from '@/components/dish/dish-detail-skeleton';
import { DishGallery } from '@/components/dish/dish-gallery';
import { DishOrderPanel } from '@/components/dish/dish-order-panel';
import { GoBackLink } from '@/components/dish/go-back-link';
import { OfferCountdown } from '@/components/dish/offer-countdown';
import { Rating } from '@/components/dish/rating';
import { SoldOutSuggestions } from '@/components/dish/sold-out-suggestions';
import { PageContainer } from '@/components/layout/page-container';
import { HoldSkeleton } from '@/components/states/loading-region';
import { StoreStatus } from '@/components/store/store-status';
import { listDishSuggestions } from '@/server/modules/menu/service';
import { CUISINE_LABELS, formatPrice, prepTimeText } from '@/lib/format';
import { loadDish, loadStoreStatus, readOrNull } from '@/lib/storefront-data';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const dish = await loadDish((await params).slug);
  // An unknown dish never reaches this page: the layout answers 404 and sets that page's title.
  return dish ? { title: dish.title, description: dish.description } : {};
}

export default async function DishPage({ params }: Props) {
  const dish = await loadDish((await params).slug);
  if (!dish) notFound();

  const [status, suggestions] = await Promise.all([
    loadStoreStatus(),
    dish.isAvailable
      ? Promise.resolve([])
      : readOrNull('suggestions', () =>
          listDishSuggestions({ id: dish.id, cuisine: dish.cuisine, limit: 3 }),
        ),
  ]);
  const closedUntil = status && !status.isOpen ? status.opensAt : null;

  return (
    <HoldSkeleton skeleton={<DishDetailSkeleton />}>
      <div className="pb-15">
        <PageContainer>
          <div className="py-4">
            <GoBackLink cuisine={dish.cuisine} />
          </div>
          {status ? <StoreStatus status={status} hideWhenOpen className="mb-6" /> : null}

          <div className="md:grid md:grid-cols-[428fr_452fr] md:items-start md:gap-x-12 xl:grid-cols-[550fr_660fr] xl:gap-x-[86px]">
            <DishGallery images={dish.images} soldOut={!dish.isAvailable} />

            <div className="pt-3 md:pt-0">
              <div className="flex flex-wrap gap-2">
                <DishChip tone="cuisine">{CUISINE_LABELS[dish.cuisine]}</DishChip>
                {dish.isBestSeller ? <DishChip tone="bestSeller">Best seller</DishChip> : null}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-2">
                <h1 className="font-heading text-title-1 text-neutral-2 md:text-h4 xl:text-h2">
                  {dish.title}
                </h1>
                {dish.offer ? <OfferCountdown endsAt={dish.offer.endsAt} /> : null}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3 md:mt-6 xl:mt-5">
                <p className="font-heading text-price text-brand-strong tabular-nums">
                  {formatPrice(dish.priceCents)}
                </p>
                {dish.isAvailable ? null : <DishChip tone="soldOut">Sold out today</DishChip>}
              </div>
              <p className="mt-2 flex items-center gap-2 text-body-4 text-neutral-3">
                <Clock className="size-5 shrink-0" aria-hidden />
                {prepTimeText(dish.prepMinutes)}
              </p>
              <div className="mt-6 border-b border-neutral-6 pb-5">
                <Rating
                  average={dish.ratingAvg}
                  reviews={dish.ratingCount}
                  starClassName="size-6"
                  textClassName="text-body-4 font-semibold text-neutral-3"
                  className="gap-x-3"
                />
              </div>
              <section className="mt-5" aria-labelledby="description-title">
                <h2 id="description-title" className="text-body-4 font-normal text-neutral-3">
                  Description
                </h2>
                <p className="mt-1 text-body-5 text-muted-foreground">{dish.description}</p>
              </section>

              <DishOrderPanel
                // A fresh panel when the dish changes (suggestion links stay on this route).
                key={dish.id}
                dish={{
                  id: dish.id,
                  title: dish.title,
                  priceCents: dish.priceCents,
                  flavors: dish.flavors,
                  isAvailable: dish.isAvailable,
                }}
                closedUntil={closedUntil}
                hasSuggestions={(suggestions?.length ?? 0) > 0}
              />
            </div>
          </div>

          {dish.isAvailable ? null : (
            <SoldOutSuggestions cuisine={dish.cuisine} dishes={suggestions ?? []} />
          )}
        </PageContainer>
      </div>
    </HoldSkeleton>
  );
}
