import 'server-only';
import { db } from '@/server/db/client';
import type { DbContext } from '@/server/db/context';

/** True when the caller can see the order. Row-level security decides, as for any read. */
export async function isOrderVisible(ctx: DbContext, orderId: string) {
  const order = await db(ctx).order.findUnique({ where: { id: orderId }, select: { id: true } });
  return order !== null;
}

/** The caller's own order as its customer (never as its courier, F8 L9.1). */
export async function isOwnOrder(ctx: DbContext, orderId: string, userId: string) {
  const order = await db(ctx).order.findFirst({
    where: { id: orderId, userId },
    select: { id: true },
  });
  return order !== null;
}

export async function partnerIdOfUser(ctx: DbContext, userId: string) {
  const partner = await db(ctx).deliveryPartner.findUnique({
    where: { userId },
    select: { id: true },
  });
  return partner?.id ?? null;
}

/** F8 (L10.4): an order a demo run made; the definer function reads demo_runs for the caller. */
export async function isDemoRunOrder(ctx: DbContext, orderId: string) {
  const rows = await db(ctx).$queryRaw<{ hit: boolean }[]>`
    SELECT app_is_demo_run_order(${orderId}::uuid) AS "hit"`;
  return rows[0]?.hit === true;
}
