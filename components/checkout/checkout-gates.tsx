import Link from 'next/link';
import type { ReactNode } from 'react';
import { PageContainer } from '@/components/layout/page-container';
import { SuccessCheck } from '@/components/orders/success-check';
import { EmptyState } from '@/components/states/empty-state';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { orderHref } from '@/lib/order-text';

/*
 * What /checkout shows instead of the form (F4 design 2.1): staff and couriers, an empty cart,
 * and the order this tab has just placed. The tab title stays "Checkout | Foodz".
 */

function Frame({ children }: { children: ReactNode }) {
  return <PageContainer className="py-15 md:py-20">{children}</PageContainer>;
}

export function StaffGate() {
  return (
    <Frame>
      <EmptyState
        size="page"
        titleAs="h1"
        title="Checkout is for customer accounts"
        description="Sign in with a customer account to order."
        action={
          <Button asChild size="touch" className="uppercase">
            <Link href="/menu">Back to the menu</Link>
          </Button>
        }
      />
    </Frame>
  );
}

export function EmptyCartGate() {
  return (
    <Frame>
      <EmptyState
        size="page"
        titleAs="h1"
        illustration="emptyCart"
        title="Your cart is empty"
        description="Dishes you add will show up here."
        action={
          <Button asChild size="touch" className="uppercase">
            <Link href="/menu">Browse the menu</Link>
          </Button>
        }
      />
    </Frame>
  );
}

/** "Order 1042 is placed." with the still check, or "Confirming your payment…" with a spinner. */
export function PlacedGate({
  orderId,
  number,
  confirming,
}: {
  orderId: string;
  number: string;
  confirming: boolean;
}) {
  const href = orderHref(orderId);
  return (
    <Frame>
      <div className="mx-auto flex max-w-sm flex-col items-center text-center">
        <div aria-hidden className="flex size-16 items-center justify-center">
          {confirming ? (
            <Spinner className="size-6 text-brand-strong motion-reduce:animate-none" />
          ) : (
            <SuccessCheck className="size-16" />
          )}
        </div>
        <h1
          tabIndex={-1}
          className="mt-6 font-heading text-h4 text-balance text-neutral-2 focus:outline-none md:text-h3"
        >
          {confirming
            ? `Confirming your payment for order ${number}…`
            : `Order ${number} is placed.`}
        </h1>
        {confirming ? null : (
          <>
            <p className="mt-3 text-body-4 text-neutral-3">You&apos;ll find it in your orders.</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="touch" className="uppercase">
                <Link href={href}>View your order</Link>
              </Button>
              <Button
                asChild
                variant="ghost"
                size="touch"
                className="text-neutral-2 hover:bg-neutral-7"
              >
                <Link href="/menu">Keep browsing</Link>
              </Button>
            </div>
          </>
        )}
      </div>
    </Frame>
  );
}
