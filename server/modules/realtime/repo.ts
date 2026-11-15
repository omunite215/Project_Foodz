import 'server-only';
import { db } from '@/server/db/client';
import type { DbContext } from '@/server/db/context';

/** True when the caller can see the order. Row-level security decides, as for any read. */
export async function isOrderVisible(ctx: DbContext, orderId: string) {
  const order = await db(ctx).order.findUnique({ where: { id: orderId }, select: { id: true } });
  return order !== null;
}

export async function partnerIdOfUser(ctx: DbContext, userId: string) {
  const partner = await db(ctx).deliveryPartner.findUnique({
    where: { userId },
    select: { id: true },
  });
  return partner?.id ?? null;
}
