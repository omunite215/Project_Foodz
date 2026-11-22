import 'server-only';
import { cache } from 'react';
import { getActor } from '@/server/auth/session';
import { getOrderView } from '@/server/modules/orders/service';

/** One of the caller's orders, read once per request for the layout, metadata and page. */
export const loadOrder = cache(async (id: string) => {
  const actor = await getActor();
  if (actor.kind !== 'user') return null;
  return getOrderView(actor, id);
});
