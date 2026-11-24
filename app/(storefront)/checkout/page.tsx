import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getActor } from '@/server/auth/session';
import { readNotices } from '@/server/modules/account/notices';
import { getAddressBook } from '@/server/modules/addresses/service';
import { getCheckoutPage } from '@/server/modules/orders/service';
import { requestInfo } from '@/server/request';
import { Checkout } from '@/components/checkout/checkout-form';
import { StaffGate } from '@/components/checkout/checkout-gates';
import { phoneCountries } from '@/lib/phone-countries';
import { signInFor } from '@/lib/sign-in-reason';

export const metadata: Metadata = { title: 'Checkout', robots: { index: false } };

/**
 * Checkout (F4 design 2). Who may order is decided here, before any HTML: guests go to sign in
 * and come back, staff and couriers are told to use a customer account, everyone else gets the
 * page (the unconfirmed and the demo account see it with their gate in place of the button).
 */
export default async function CheckoutPage() {
  const actor = await getActor();
  if (actor.kind !== 'user') redirect(signInFor('/sign-in', '/checkout', 'checkout'));

  const { ip } = await requestInfo();
  const page = await getCheckoutPage(actor, { ip });
  if (!('email' in page)) {
    if (page.eligibility === 'guest') redirect(signInFor('/sign-in', '/checkout', 'checkout'));
    return <StaffGate />;
  }

  const [book, notices] = await Promise.all([getAddressBook(actor), readNotices()]);
  return (
    <Checkout
      page={page}
      addressBook={book.addresses}
      store={book.store}
      countries={phoneCountries()}
      draftOwner={actor.userId}
      demoNoticeDismissed={notices.demoNoticeDismissed}
    />
  );
}
