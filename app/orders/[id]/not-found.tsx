import Link from 'next/link';
import { PageContainer } from '@/components/layout/page-container';
import { EmptyState } from '@/components/states/empty-state';
import { Button } from '@/components/ui/button';

/** The same page for another customer's id, a made-up id and an order number (F4 design 3.12). */
export default function OrderNotFound() {
  return (
    <PageContainer className="py-15 md:py-20">
      <EmptyState
        size="page"
        titleAs="h1"
        illustration="pageEaten"
        title="Order not found"
        description="Check the link, or find the order in your orders."
        action={
          <Button asChild size="touch" className="uppercase">
            <Link href="/account/orders">Your orders</Link>
          </Button>
        }
      />
    </PageContainer>
  );
}
