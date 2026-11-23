import 'server-only';
import { db } from '@/server/db/client';
import type { DbContext } from '@/server/db/context';

/*
 * Payments data Foodz keeps itself: the Stripe customer id on the account, processed webhook
 * event ids (append-only for the app role) and this database's tag. Cards live at Stripe.
 */

export function findStripeCustomerId(ctx: DbContext, userId: string) {
  return db(ctx).user.findUnique({
    where: { id: userId },
    select: { stripeCustomerId: true, isDemo: true },
  });
}

/** Serialises customer creation per account, so a double press never makes two. */
export async function lockStripeCustomer(ctx: DbContext, userId: string) {
  await db(ctx)
    .$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`stripe-customer:${userId}`}, 0))`;
}

export async function saveStripeCustomerId(ctx: DbContext, userId: string, customerId: string) {
  const result = await db(ctx).user.updateMany({
    where: { id: userId, stripeCustomerId: null },
    data: { stripeCustomerId: customerId },
  });
  return result.count;
}

export async function clearStripeCustomerId(ctx: DbContext, userId: string) {
  await db(ctx).user.updateMany({ where: { id: userId }, data: { stripeCustomerId: null } });
}

export async function findInstanceTag(ctx: DbContext) {
  const row = await db(ctx).appInstance.findUnique({ where: { id: 1 }, select: { tag: true } });
  return row?.tag ?? null;
}

/** True when this event id is new; false when it was processed before (a replay). */
export async function recordWebhookEvent(ctx: DbContext, id: string, type: string) {
  const result = await db(ctx).webhookEvent.createMany({
    data: [{ id, provider: 'stripe', type }],
    skipDuplicates: true,
  });
  return result.count === 1;
}
