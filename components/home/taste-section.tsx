import type { DishCard, StoreStatus } from '@/server/modules/menu/schema';
import { PageContainer } from '@/components/layout/page-container';
import { Reveal } from './reveal';
import { TastePicker } from './taste-picker';

/** "Get the best taste now": the taste picker with its title block. */
export function TasteSection({
  dishes,
  status,
}: {
  dishes: DishCard[];
  status: StoreStatus | null;
}) {
  return (
    <section aria-labelledby="taste-title">
      <PageContainer className="py-10 md:py-15">
        <Reveal>
          <div className="mx-auto max-w-[770px] text-center">
            <h2
              id="taste-title"
              className="font-heading text-title-1 leading-tight text-neutral-2 md:text-h2"
            >
              Get the best taste now
            </h2>
            <p className="mt-2 text-body-5 text-muted-foreground md:mt-3 md:text-body-1 xl:text-neutral-3">
              Pick a few dishes and we&apos;ll add them to your cart. Hot food at your door in about
              45 minutes.
            </p>
          </div>
          <div className="mt-8 md:mt-15">
            <TastePicker
              dishes={dishes}
              closedUntil={status && !status.isOpen ? status.opensAt : null}
            />
          </div>
        </Reveal>
      </PageContainer>
    </section>
  );
}
