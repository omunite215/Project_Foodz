import Link from 'next/link';
import { PageContainer } from '@/components/layout/page-container';
import { EmptyState } from '@/components/states/empty-state';
import { Button } from '@/components/ui/button';

/** Unknown or old dish addresses land here, inside the normal header and footer (status 404). */
export function DishNotFound() {
  return (
    <PageContainer className="py-15 md:py-20">
      <EmptyState
        size="page"
        titleAs="h1"
        illustration="pageEaten"
        title="We couldn't find that dish"
        description="It may have been renamed or taken off the menu."
        action={
          <Button asChild size="touch">
            <Link href="/menu">Back to the menu</Link>
          </Button>
        }
      />
    </PageContainer>
  );
}
