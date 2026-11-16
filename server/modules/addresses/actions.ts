'use server';

import { userAction } from '@/server/action';
import {
  addressIdInput,
  addressSearchInput,
  createAddressInput,
  deliveryCheckInput,
  updateAddressInput,
} from './schema';
import {
  checkDeliveryArea,
  createAddress,
  deleteAddress,
  getAddressBook,
  searchAddresses,
  setDefaultAddress,
  updateAddress,
} from './service';

/*
 * The signed-in user's own address book. Ownership is checked by the service and again by
 * row-level security; another user's id answers "Address not found." and changes nothing.
 * Writes are refused for the shared demo accounts (U2); search and the delivery check are not.
 */

export const listAddressesAction = userAction
  .metadata({ name: 'addresses.list' })
  .action(async ({ ctx }) => getAddressBook(ctx.actor));

export const searchAddressesAction = userAction
  .metadata({ name: 'addresses.search', rateLimit: 'geo.search' })
  .inputSchema(addressSearchInput)
  .action(async ({ parsedInput, ctx }) => searchAddresses(ctx.actor, parsedInput));

export const checkDeliveryAreaAction = userAction
  .metadata({ name: 'addresses.checkDeliveryArea', rateLimit: 'geo.check' })
  .inputSchema(deliveryCheckInput)
  .action(async ({ parsedInput, ctx }) => checkDeliveryArea(ctx.actor, parsedInput));

export const createAddressAction = userAction
  .metadata({ name: 'addresses.create', rateLimit: 'address.write', write: true })
  .inputSchema(createAddressInput)
  .action(async ({ parsedInput, ctx }) => createAddress(ctx.actor, parsedInput));

export const updateAddressAction = userAction
  .metadata({ name: 'addresses.update', rateLimit: 'address.write', write: true })
  .inputSchema(updateAddressInput)
  .action(async ({ parsedInput, ctx }) => updateAddress(ctx.actor, parsedInput));

export const setDefaultAddressAction = userAction
  .metadata({ name: 'addresses.setDefault', rateLimit: 'address.write', write: true })
  .inputSchema(addressIdInput)
  .action(async ({ parsedInput, ctx }) => setDefaultAddress(ctx.actor, parsedInput));

export const deleteAddressAction = userAction
  .metadata({ name: 'addresses.delete', rateLimit: 'address.write', write: true })
  .inputSchema(addressIdInput)
  .action(async ({ parsedInput, ctx }) => deleteAddress(ctx.actor, parsedInput));
