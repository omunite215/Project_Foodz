import type { Metadata } from 'next';
import { getActor } from '@/server/auth/session';
import { getAddressBook } from '@/server/modules/addresses/service';
import { AddressBook } from '@/components/addresses/address-book';

export const metadata: Metadata = { title: 'Addresses' };

/** The saved addresses, default first (S4.1, S4.8 to S4.13). */
export default async function AddressesPage() {
  const actor = await getActor();
  if (actor.kind !== 'user') return null;
  const book = await getAddressBook(actor);
  return <AddressBook book={book} />;
}
