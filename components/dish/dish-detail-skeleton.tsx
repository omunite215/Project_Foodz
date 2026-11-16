import { PageContainer } from '@/components/layout/page-container';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { skeletonBlock } from './dish-card-skeleton';

const bar = (className: string) => <Skeleton className={cn(skeletonBlock, className)} />;

/** The dish page's boxes while it loads: same panel, plate, rows and button sizes. */
export function DishDetailSkeleton() {
  return (
    <div aria-hidden className="pb-15">
      <PageContainer>
        <div className="py-4">{bar('h-11 w-[143px] rounded-lg')}</div>
        <div className="md:grid md:grid-cols-[428fr_452fr] md:items-start md:gap-x-12 xl:grid-cols-[550fr_660fr] xl:gap-x-[86px]">
          <div className="relative -mx-6 flex aspect-[375/439] items-center justify-center bg-neutral-7 md:mx-0 md:-ml-12 md:aspect-[476/732] md:rounded-lg xl:-ml-[72px] xl:aspect-[622/791]">
            <div className="aspect-square w-[85%] max-w-[416px] rounded-full bg-neutral-6 md:w-[84%] xl:w-[67%]" />
          </div>
          <div className="pt-3 md:pt-0">
            <div className="flex gap-2">
              {bar('h-7 w-20 rounded-md')}
              {bar('h-7 w-20 rounded-md')}
            </div>
            {bar('mt-2 h-9 w-3/4 md:h-10 xl:h-12')}
            {bar('mt-3 h-10 w-28 md:mt-6 xl:mt-5')}
            {bar('mt-2 h-6 w-48')}
            <div className="mt-6 border-b border-neutral-6 pb-5">{bar('h-6 w-56')}</div>
            <div className="mt-5 space-y-2">
              {bar('h-6 w-28')}
              {bar('h-[21px] w-full')}
              {bar('h-[21px] w-full')}
              {bar('h-[21px] w-3/5')}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {bar('h-11 w-24 rounded-lg')}
              {bar('h-11 w-24 rounded-lg')}
              {bar('h-11 w-24 rounded-lg')}
              {bar('h-11 w-24 rounded-lg')}
            </div>
            {bar('mt-4 min-h-[114px] w-full rounded-xl')}
            {bar('mt-8 h-11 w-full rounded-lg md:w-[220px] xl:mt-14')}
          </div>
        </div>
      </PageContainer>
    </div>
  );
}
