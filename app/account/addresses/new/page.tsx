import type { Metadata } from 'next';
import { getActor } from '@/server/auth/session';
import type { AddressKind } from '@/server/modules/addresses/schema';
import { getAddressBook } from '@/server/modules/addresses/service';
import { BackLink } from '@/components/account/back-link';
import { LockedLine } from '@/components/account/settings-card';
import { AddressForm } from '@/components/addresses/address-form';

export const metadata: Metadata = { title: 'Add an address' };

/** Add an address (S4.2 to S4.8). At the limit, the reason shows before anything is typed (S4.12). */
export default async function NewAddressPage() {
  const actor = await getActor();
  if (actor.kind !== 'user') return null;
  const book = await getAddressBook(actor);
  const kinds = new Set(book.addresses.map((address) => address.kind));
  const defaultKind: AddressKind = !kinds.has('HOME')
    ? 'HOME'
    : !kinds.has('WORK')
      ? 'WORK'
      : 'OTHER';
  const full = book.canEdit && !book.canAdd;

  return (
    <>
      <BackLink href="/account/addresses">Back to addresses</BackLink>
      <h1
        tabIndex={-1}
        className="mt-6 font-heading text-h4 leading-tight text-neutral-2 focus:outline-none md:text-h3"
      >
        Add an address
      </h1>
      {book.canEdit ? null : (
        <LockedLine className="mt-3">
          You can try the search, the map and the delivery check. Saving is turned off for the demo
          account.
        </LockedLine>
      )}
      <div className="mt-8">
        {full ? (
          <p className="text-body-4 text-neutral-3">
            You can save up to 10 addresses. Delete one to add another.
          </p>
        ) : (
          <AddressForm
            address={null}
            store={book.store}
            defaultKind={defaultKind}
            firstAddress={book.addresses.length === 0}
            canSave={book.canEdit}
            draftOwner={actor.userId}
          />
        )}
      </div>
    </>
  );
}
