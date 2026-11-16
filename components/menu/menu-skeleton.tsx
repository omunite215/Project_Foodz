import {
  CompactDishCardSkeleton,
  DishCardSkeleton,
  skeletonBlock,
} from '@/components/dish/dish-card-skeleton';
import { PageContainer } from '@/components/layout/page-container';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/** The menu page's shape while it loads: real headings, skeleton cards in the real grid. */
export function MenuSkeleton() {
  return (
    <PageContainer className="pt-10 pb-15 md:pt-20 md:pb-20">
      <div className="mx-auto flex max-w-[770px] flex-col items-center text-center">
        <p aria-hidden className="font-heading text-h4 leading-tight text-neutral-2 md:text-h2">
          Our menu
        </p>
        <p className="mt-4 text-body-4 text-muted-foreground md:mt-3 md:text-body-1 xl:text-neutral-3">
          Korean, Thai and Vietnamese dishes, cooked to order. At your door in about 45 minutes.
        </p>
        <Skeleton className={cn(skeletonBlock, 'mt-6 h-8 w-52 rounded-full')} />
      </div>
      <div className="mt-10 md:mt-15">
        <Skeleton className={cn(skeletonBlock, 'h-7 w-56 md:h-8')} />
        <Skeleton className={cn(skeletonBlock, 'mt-2 h-[21px] w-48 md:h-6')} />
        <div className="mt-6 grid gap-4 md:grid-cols-3 md:gap-6">
          <CompactDishCardSkeleton />
          <div className="hidden md:block">
            <CompactDishCardSkeleton />
          </div>
          <div className="hidden md:block">
            <CompactDishCardSkeleton />
          </div>
        </div>
      </div>
      <div className="mt-11 flex justify-center md:mt-10">
        <div className="flex w-full rounded-lg bg-white p-1.5 shadow-card md:w-[672px] md:gap-9">
          {['Korean', 'Thai', 'Vietnamese'].map((label) => (
            <div
              key={label}
              className="flex h-14 flex-1 flex-col items-center justify-center gap-1 text-neutral-3 md:h-[62px] md:w-[196px] md:flex-none md:flex-row md:gap-2"
            >
              <span className="text-body-5 font-medium md:text-body-2 md:font-normal">{label}</span>
              <Skeleton className={cn(skeletonBlock, 'h-5 w-6 rounded-full')} />
            </div>
          ))}
        </div>
      </div>
      <ul className="mt-12 grid gap-8 md:mt-20 md:grid-cols-2 md:gap-x-6 md:gap-y-20 lg:grid-cols-3 lg:gap-x-8 xl:mx-auto xl:max-w-[1168px] xl:gap-x-[74px] xl:gap-y-20">
        {Array.from({ length: 6 }, (_, index) => (
          <li key={index} className={index >= 2 ? 'hidden md:block' : undefined}>
            <DishCardSkeleton />
          </li>
        ))}
      </ul>
    </PageContainer>
  );
}
