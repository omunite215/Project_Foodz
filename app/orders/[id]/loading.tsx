import { PageContainer } from '@/components/layout/page-container';
import { LoadingRegion } from '@/components/states/loading-region';

const block = 'animate-skeleton bg-neutral-7 motion-reduce:animate-none';

/** Navigation to an order (F4 design States): the hero circle, two bars and the receipt box. */
export default function OrderLoading() {
  return (
    <PageContainer className="pt-6 pb-16 md:pt-10 md:pb-20 xl:pt-12 xl:pb-24">
      <LoadingRegion label="Loading your order">
        <div className="mx-auto max-w-[600px]">
          <div className={`${block} mb-6 h-11 w-40 rounded-lg`} />
          <div className={`${block} mx-auto size-24 rounded-full`} />
          <div className={`${block} mx-auto mt-4 h-10 w-56 rounded-md`} />
          <div className={`${block} mx-auto mt-3 h-6 w-72 max-w-full rounded-md`} />
          <div className={`${block} mt-8 h-40 rounded-2xl`} />
          <div className={`${block} mt-6 h-80 rounded-2xl`} />
        </div>
      </LoadingRegion>
    </PageContainer>
  );
}
