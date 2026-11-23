import { notFound } from 'next/navigation';
import { getActor } from '@/server/auth/session';
import { getSavedCardsPage, getStripeConfig } from '@/server/modules/payments/service';
import { PageContainer } from '@/components/layout/page-container';
import { OrderPage, type OrderPageProps } from '@/components/orders/order-page';
import { loadOrder } from './load-order';

/** The order page (F4 design 3): the confirmation, the receipt and every state in words. */
export default async function Order({ params }: { params: Promise<{ id: string }> }) {
  const view = await loadOrder((await params).id);
  if (!view) notFound();

  // "Finish paying" needs the card form and her saved cards (design 3.10).
  let payment: OrderPageProps['payment'] = null;
  const stripe = getStripeConfig();
  const actor = await getActor();
  if (view.payable && stripe.configured && stripe.publishableKey && actor.kind === 'user') {
    const cards = await getSavedCardsPage(actor);
    payment = {
      publishableKey: stripe.publishableKey,
      testMode: stripe.testMode,
      savedCards: cards.state === 'ok' ? cards.cards : [],
      savedCardLimit: cards.state === 'ok' ? cards.limit : 5,
    };
  }

  return (
    <PageContainer className="pt-6 pb-16 md:pt-10 md:pb-20 xl:pt-12 xl:pb-24">
      <OrderPage view={view} payment={payment} />
    </PageContainer>
  );
}
