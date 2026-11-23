import type { Metadata } from 'next';
import Link from 'next/link';
import { PageContainer } from '@/components/layout/page-container';
import { StorefrontChrome } from '@/components/layout/storefront-chrome';
import { EmptyState } from '@/components/states/empty-state';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = { title: 'Page not found' };

/**
 * Any address the site does not have, with the storefront's header and footer. Dish addresses
 * get their own message (app/(storefront)/menu). Customers and couriers who open a staff address
 * land here too, with no hint that staff tools exist (F5 A1.3).
 */
export default function NotFound() {
  return (
    <StorefrontChrome>
      <PageContainer className="py-15 md:py-20">
        <EmptyState
          size="page"
          titleAs="h1"
          illustration="pageEaten"
          title="We couldn't find that page"
          description="It may have been moved, or eaten."
          action={
            <Button asChild size="touch">
              <Link href="/menu">Back to the menu</Link>
            </Button>
          }
        />
      </PageContainer>
    </StorefrontChrome>
  );
}
