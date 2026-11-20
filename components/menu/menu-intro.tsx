import type { StoreStatus as Status } from '@/server/modules/menu/schema';
import { StoreStatus } from '@/components/store/store-status';

export function MenuIntro({ status }: { status: Status | null }) {
  return (
    <div className="mx-auto flex max-w-[770px] flex-col items-center text-center">
      <h1 className="font-heading text-h4 leading-tight text-neutral-2 md:text-h2">Our menu</h1>
      <p className="mt-4 text-body-4 text-muted-foreground md:mt-3 md:text-body-1 xl:text-neutral-3">
        Korean, Thai and Vietnamese dishes, cooked to order. At your door in about 45 minutes.
      </p>
      {status ? <StoreStatus status={status} className="mt-6" /> : null}
      <p className="mt-3 text-body-5 text-neutral-3">
        Prices don&apos;t include tax. Your cart shows the full total before you check out.
      </p>
    </div>
  );
}
