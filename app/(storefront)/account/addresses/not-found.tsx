import Link from 'next/link';
import { EmptyState } from '@/components/states/empty-state';
import { Button } from '@/components/ui/button';

/** The same page for a made-up id and for another customer's address (S4.14). */
export default function AddressNotFound() {
  return (
    <div className="py-10">
      <EmptyState
        size="page"
        titleAs="h1"
        illustration="pageEaten"
        title="Address not found"
        description="It may have been deleted, or the link is wrong."
        action={
          <Button asChild size="touch">
            <Link href="/account/addresses">Back to addresses</Link>
          </Button>
        }
      />
    </div>
  );
}
