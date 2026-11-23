import type { Metadata } from 'next';
import { getActor } from '@/server/auth/session';
import { listMyOrders } from '@/server/modules/orders/service';
import { AccountPageHead } from '@/components/account/settings-card';
import { OrdersList } from '@/components/orders/orders-list';
import { loadStoreStatus } from '@/lib/storefront-data';
import { STORE_TIME_ZONE } from '@/lib/order-text';

export const metadata: Metadata = { title: 'Orders' };

/** Her orders, in progress first, then the rest 20 at a time (F4 design 4, S12.1 to S12.3). */
export default async function OrdersPage() {
  const actor = await getActor();
  if (actor.kind !== 'user') return null;
  const [page, status] = await Promise.all([listMyOrders(actor), loadStoreStatus()]);
  return (
    <>
      <AccountPageHead
        title="Orders"
        subtitle="Newest first. Orders in progress stay at the top."
      />
      <OrdersList
        page={page}
        timeZone={status?.timeZone ?? STORE_TIME_ZONE}
        now={new Date().toISOString()}
        userId={actor.userId}
      />
    </>
  );
}
