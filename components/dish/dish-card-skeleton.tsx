import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/** Pulses (opacity only); still under reduced motion. Same radius as the real element. */
export const skeletonBlock = 'animate-skeleton bg-neutral-7 motion-reduce:animate-none';

/** The exact boxes of a `responsive` dish card, so nothing moves when the real one lands. */
export function DishCardSkeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn('flex h-full flex-col rounded-2xl bg-white py-6 shadow-raised', className)}
    >
      <div className="flex justify-center px-7">
        <Skeleton
          className={cn(
            skeletonBlock,
            'aspect-square w-[200px] rounded-full xl:w-full xl:max-w-[284px]',
          )}
        />
      </div>
      <div className="mt-6 flex flex-1 flex-col gap-3 px-6">
        <Skeleton className={cn(skeletonBlock, 'h-6 w-3/4 xl:h-8')} />
        <Skeleton className={cn(skeletonBlock, 'h-[21px] w-2/3 xl:h-6')} />
        <div className="mt-auto flex items-center justify-between gap-3 pt-1">
          <Skeleton className={cn(skeletonBlock, 'h-7 w-24 xl:h-10')} />
          <Skeleton className={cn(skeletonBlock, 'h-11 w-28 rounded-lg md:h-9 xl:h-10')} />
        </div>
      </div>
    </div>
  );
}

/** A `compact` card's boxes. */
export function CompactDishCardSkeleton() {
  return (
    <div aria-hidden className="flex items-center gap-4 rounded-2xl bg-white p-3 shadow-raised">
      <Skeleton className={cn(skeletonBlock, 'aspect-square w-22 shrink-0 rounded-full md:w-24')} />
      <div className="flex flex-1 flex-col gap-2">
        <Skeleton className={cn(skeletonBlock, 'h-5 w-3/4')} />
        <Skeleton className={cn(skeletonBlock, 'h-[21px] w-2/3')} />
        <Skeleton className={cn(skeletonBlock, 'h-6 w-20')} />
      </div>
    </div>
  );
}
