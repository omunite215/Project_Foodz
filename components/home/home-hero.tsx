import Link from 'next/link';
import type { StoreStatus as Status } from '@/server/modules/menu/schema';
import { PageContainer } from '@/components/layout/page-container';
import { StoreStatus } from '@/components/store/store-status';
import { Button } from '@/components/ui/button';
import { formatPrice, shortAddress } from '@/lib/format';
import { Chopsticks } from './chopsticks';
import { HeroBowl } from './hero-bowl';

const HERO_DISH = '/Home/Hero/udon.svg';

/** Delivery fee and radius from the store settings (in place of the design's invented stats). */
function FactsPanel({ status }: { status: Status }) {
  const label = 'block text-body-5 text-neutral-3 md:text-body-3';
  const value = 'block font-sans text-title-2 font-semibold text-neutral-2 xl:text-h4';

  return (
    <div className="mt-8 grid grid-cols-2 gap-4 rounded-2xl bg-neutral-7 p-4 text-left md:mt-0 md:w-full md:max-w-[414px] md:gap-9 md:self-end xl:mt-40 xl:w-[576px] xl:max-w-none xl:gap-15 xl:px-14 xl:py-7">
      <p>
        <span className={label}>Delivery from</span>{' '}
        <span className={value}>{formatPrice(status.delivery.baseFeeCents)}</span>
      </p>
      <p className="md:border-l md:border-neutral-6 md:pl-9 xl:pl-15">
        <span className={label}>We deliver within</span>{' '}
        <span className={value}>{status.delivery.radiusKm} km</span>{' '}
        <span className="block text-body-5 text-neutral-3">
          of {shortAddress(status.store.addressText)}
        </span>
      </p>
    </div>
  );
}

export function HomeHero({ status }: { status: Status | null }) {
  return (
    <section aria-labelledby="hero-title" className="relative isolate overflow-hidden">
      {/* From md: a quarter ellipse rising behind the dish. */}
      <div
        aria-hidden
        className="absolute right-0 bottom-0 -z-10 hidden h-[88%] w-[48%] rounded-tl-[100%] bg-brand-soft md:block"
      />
      <PageContainer className="pt-15 pb-10 text-center md:grid md:min-h-[588px] md:grid-cols-[1fr_auto] md:grid-rows-[1fr_auto] md:gap-x-6 md:pt-17 md:pb-14 md:text-left xl:min-h-[788px] xl:pt-29 xl:pb-12">
        <div className="flex flex-col items-center md:items-start">
          {status ? <StoreStatus status={status} className="mb-4 md:mb-6" /> : null}
          <h1
            id="hero-title"
            className="font-heading text-h4 leading-none text-neutral-2 md:text-h3 lg:text-h1 min-[1440px]:text-hero"
          >
            You&apos;ve Got Questions.
            <br />
            We&apos;ve Got Taste.
          </h1>
          <p className="mx-auto mt-4 max-w-[284px] text-body-4 text-muted-foreground md:mx-0 md:mt-3 md:max-w-[560px] md:text-body-2 md:text-neutral-3 xl:max-w-[674px] xl:text-body-1">
            Korean, Thai and Vietnamese dishes, cooked to order and at your door in about 45
            minutes.
          </p>
          <div className="mt-6 flex flex-col items-center gap-2 md:mt-9 md:flex-row md:gap-6">
            <Button asChild size="touch" className="uppercase">
              <Link href="/menu">Order now</Link>
            </Button>
            <a
              href="#specials"
              className="inline-flex h-11 items-center text-button-1 text-brand-strong underline-offset-4 hover:underline"
            >
              See today&apos;s specials
            </a>
          </div>
        </div>

        <div className="relative mt-8 flex justify-center md:col-start-2 md:row-span-2 md:row-start-1 md:mt-16 md:items-start xl:mt-24 xl:mr-10">
          {/* Phones: a dome behind the dish. */}
          <div
            aria-hidden
            className="absolute bottom-[-24px] left-1/2 -z-10 h-[150px] w-[150%] -translate-x-1/2 rounded-t-[100%] bg-brand-soft md:hidden"
          />
          <HeroBowl src={HERO_DISH} />
          <Chopsticks className="absolute bottom-[-28px] left-[-12%] h-[178px] w-[166px] md:bottom-[-60px] md:left-[-30%] md:h-[300px] md:w-[280px] xl:bottom-[-90px] xl:h-[422px] xl:w-[392px]" />
        </div>

        {status ? <FactsPanel status={status} /> : null}
      </PageContainer>
    </section>
  );
}
