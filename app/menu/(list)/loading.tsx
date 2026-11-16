import { MenuSkeleton } from '@/components/menu/menu-skeleton';
import { LoadingRegion } from '@/components/states/loading-region';

export default function MenuLoading() {
  return (
    <LoadingRegion label="Loading menu">
      <MenuSkeleton />
    </LoadingRegion>
  );
}
