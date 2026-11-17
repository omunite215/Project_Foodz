import { notFound } from 'next/navigation';
import { getActor } from '@/server/auth/session';
import { getAddressBook } from '@/server/modules/addresses/service';
import { BackLink } from '@/components/account/back-link';
import { LockedLine } from '@/components/account/settings-card';
import { AddressCardReadOnly } from '@/components/addresses/address-read-only';
import { AddressForm } from '@/components/addresses/address-form';
import { loadAddress } from '../load-address';

/** Edit an address (S4.10): it opens filled in, on the saved pin, with its delivery result. */
export default async function EditAddressPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (actor.kind !== 'user') return null;
  const [address, book] = await Promise.all([
    loadAddress((await params).id),
    getAddressBook(actor),
  ]);
  if (!address) notFound();

  return (
    <>
      <BackLink href="/account/addresses">Back to addresses</BackLink>
      <h1
        tabIndex={-1}
        className="mt-6 font-heading text-h4 leading-tight text-neutral-2 [overflow-wrap:anywhere] focus:outline-none md:text-h3"
      >
        Edit {address.label}
      </h1>
      {book.canEdit ? (
        <div className="mt-8">
          <AddressForm
            address={address}
            store={book.store}
            defaultKind={address.kind}
            firstAddress={false}
            canSave
          />
        </div>
      ) : (
        <>
          <LockedLine className="mt-3">
            The demo account&apos;s addresses can&apos;t be changed. You can still try the delivery
            check.
          </LockedLine>
          <div className="mt-8 max-w-[640px]">
            <AddressCardReadOnly address={address} />
          </div>
        </>
      )}
    </>
  );
}
