import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getActor } from '@/server/auth/session';
import { PageContainer } from '@/components/layout/page-container';
import { EmptyState } from '@/components/states/empty-state';
import { Button } from '@/components/ui/button';
import { signInFor } from '@/lib/sign-in-reason';

export const metadata: Metadata = { title: 'Checkout', robots: { index: false } };

/**
 * Where "Go to checkout" leads until the checkout itself is built (F3 B16, design 7). Signed-in
 * customers only; the cart is left as it is.
 */
export default async function CheckoutPage() {
  if ((await getActor()).kind !== 'user') redirect(signInFor('/sign-in', '/checkout', 'checkout'));

  return (
    <PageContainer className="py-15 md:py-20">
      <EmptyState
        illustration="orderFood"
        title="Checkout"
        titleAs="h1"
        size="page"
        description="Checkout arrives with the next update. Your cart is saved."
        action={
          <Button asChild size="touch" className="uppercase">
            <Link href="/menu">Back to the menu</Link>
          </Button>
        }
      />
    </PageContainer>
  );
}
