import { DishDetailSkeleton } from '@/components/dish/dish-detail-skeleton';
import { LoadingRegion } from '@/components/states/loading-region';

export default function DishLoading() {
  return (
    <LoadingRegion label="Loading dish">
      <DishDetailSkeleton />
    </LoadingRegion>
  );
}
