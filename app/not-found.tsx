import type { Metadata } from 'next';
import Link from 'next/link';
import { PageContainer } from '@/components/layout/page-container';
import { EmptyState } from '@/components/states/empty-state';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = { title: 'Page not found' };

/** Any address the site does not have. Dish addresses get their own message (app/menu). */
export default function NotFound() {
  return (
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
  );
}
