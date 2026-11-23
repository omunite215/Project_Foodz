import 'server-only';
import { cache } from 'react';
import { getActor } from '@/server/auth/session';
import { getAddress } from '@/server/modules/addresses/service';

/** One of the caller's addresses, read once per request for the layout, metadata and page. */
export const loadAddress = cache(async (id: string) => {
  const actor = await getActor();
  if (actor.kind !== 'user') return null;
  return getAddress(actor, id);
});
