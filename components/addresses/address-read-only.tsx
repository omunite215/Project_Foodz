'use client';

import type { AddressDto } from '@/server/modules/addresses/schema';
import { AddressCard } from './address-card';

/** A saved address shown without its actions (the shared demo accounts, U2). */
export function AddressCardReadOnly({ address }: { address: AddressDto }) {
  return (
    <AddressCard
      address={address}
      isDefault={address.isDefault}
      canEdit={false}
      busy={false}
      onSetDefault={() => {}}
      onDelete={() => {}}
    />
  );
}
