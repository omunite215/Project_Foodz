import { ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { EmptyState } from '@/components/states/empty-state';
import { Button } from '@/components/ui/button';
import { REPORT_COPY } from '@/lib/admin/report-text';

/*
 * F5 1.8's no-access page for the payouts report (F9 design 3.1): SUPPORT goes back to the
 * Partners list, KITCHEN to the board. Nothing about money is read or sent to this page.
 */

export function ReportNoAccess({ back }: { back: 'partners' | 'board' | null }) {
  return (
    <div className="mx-auto w-full max-w-md px-4 py-16 text-center md:py-24">
      <EmptyState
        size="page"
        titleAs="h1"
        title="No access"
        description={REPORT_COPY.noAccess}
        media={
          <span
            aria-hidden
            className="flex size-16 items-center justify-center rounded-full bg-neutral-7 text-neutral-3"
          >
            <ShieldAlert className="size-8" />
          </span>
        }
        action={
          back === 'partners' ? (
            <Button asChild size="touch">
              <Link href="/admin/partners">Back to partners</Link>
            </Button>
          ) : back === 'board' ? (
            <Button asChild size="touch">
              <Link href="/admin/orders">Back to the board</Link>
            </Button>
          ) : (
            <Button asChild variant="outline" size="touch">
              <Link href="/">Go to the site</Link>
            </Button>
          )
        }
      />
    </div>
  );
}
