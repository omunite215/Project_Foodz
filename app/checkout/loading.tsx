import { PageContainer } from '@/components/layout/page-container';
import { LoadingRegion } from '@/components/states/loading-region';

/** Checkout's skeleton (F4 design States): the real boxes, the words as text. */

const block = 'animate-skeleton bg-neutral-7 motion-reduce:animate-none';

export default function CheckoutLoading() {
  return (
    <PageContainer>
      <LoadingRegion label="Loading checkout">
        <div className="py-4">
          <div className={`${block} h-11 w-36 rounded-lg`} />
        </div>
        <div className="pb-40 md:mx-auto md:max-w-[672px] lg:mx-0 lg:grid lg:max-w-none lg:grid-cols-[minmax(0,1fr)_377px] lg:gap-x-12 lg:pt-15 xl:grid-cols-12 xl:gap-x-6 xl:pt-20">
          <div className="xl:col-span-5">
            <p className="font-heading text-h4 leading-tight text-neutral-2 md:text-h2">
              Confirm and pay
            </p>
            <p className="mt-3 text-body-4 text-muted-foreground md:text-body-2 xl:text-body-1">
              Hooray! This is the last step before your meal.
            </p>
            <div className={`${block} mt-8 h-14 rounded-2xl lg:hidden`} />
            <div className="mt-10 space-y-10 lg:mt-12 lg:space-y-12">
              <div className="space-y-3">
                <div className={`${block} h-6 w-32 rounded-md`} />
                <div className={`${block} min-h-16 rounded-xl`} />
              </div>
              <div className="space-y-3">
                <div className={`${block} h-6 w-32 rounded-md`} />
                <div className={`${block} h-11 rounded-xl`} />
                <div className={`${block} h-11 rounded-xl`} />
              </div>
              <div className="space-y-3">
                <div className={`${block} h-6 w-32 rounded-md`} />
                <div className={`${block} h-20 rounded-xl`} />
              </div>
              <div className="space-y-3">
                <div className={`${block} h-6 w-32 rounded-md`} />
                <div className={`${block} h-16 rounded-xl`} />
              </div>
              <div className="space-y-3">
                <div className={`${block} h-6 w-32 rounded-md`} />
                <div className={`${block} min-h-16 rounded-xl`} />
                <div className={`${block} min-h-16 rounded-xl`} />
              </div>
            </div>
          </div>
          <div
            className={`${block} hidden h-96 rounded-2xl lg:col-start-2 lg:row-span-2 lg:block xl:col-span-5 xl:col-start-8`}
          />
        </div>
      </LoadingRegion>
    </PageContainer>
  );
}
