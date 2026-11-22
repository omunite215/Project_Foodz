import 'server-only';
import { db } from '@/server/db/client';
import type { DbContext } from '@/server/db/context';
import type {
  DisputeStatus,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  RedemptionStatus,
} from '@/server/db/generated/client';

/*
 * Orders, their lines, timeline and code uses. Row-level security lets customers read their own
 * orders and only the platform write them (F4 migration), so every write here runs in a
 * transaction started with runAsSystem, and every read for a customer is filtered by user id
 * as well.
 */

const LIVE: OrderStatus[] = [
  'PENDING_PAYMENT',
  'PLACED',
  'ACCEPTED',
  'PREPARING',
  'READY',
  'PICKED_UP',
  'DELIVERED',
];
export const IN_PROGRESS: OrderStatus[] = [
  'PENDING_PAYMENT',
  'PLACED',
  'ACCEPTED',
  'PREPARING',
  'READY',
  'PICKED_UP',
];
const PAST: OrderStatus[] = ['DELIVERED', 'CANCELLED'];

// ------------------------------------------------------------------ the customer

export function findCustomer(ctx: DbContext, userId: string) {
  return db(ctx).user.findUnique({
    where: { id: userId },
    select: {
      name: true,
      email: true,
      emailVerified: true,
      phone: true,
      isDemo: true,
      banned: true,
      deletedAt: true,
    },
  });
}

export async function updateCustomerPhone(ctx: DbContext, userId: string, phone: string) {
  await db(ctx).user.updateMany({ where: { id: userId, isDemo: false }, data: { phone } });
}

/** One checkout at a time per customer: the unpaid-order and duplicate checks hold under it. */
export async function lockCustomerOrders(ctx: DbContext, userId: string) {
  await db(ctx)
    .$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`orders:${userId}`}, 0))`;
}

// ------------------------------------------------------------------ checks at the press

const briefFields = {
  id: true,
  number: true,
  status: true,
  paymentMethod: true,
  paymentStatus: true,
  totalCents: true,
  expiresAt: true,
  stripePaymentIntentId: true,
  cancelReason: true,
  createdAt: true,
} as const;

export type OrderBrief = Prisma.OrderGetPayload<{ select: typeof briefFields }>;

/** The order a checkout press made, if any. */
export function findByAttemptKey(ctx: DbContext, userId: string, attemptKey: string) {
  return db(ctx).order.findFirst({ where: { userId, attemptKey }, select: briefFields });
}

/** A new attempt takes over the key of an order that failed or was cancelled (S7.2). */
export async function releaseAttemptKey(ctx: DbContext, userId: string, attemptKey: string) {
  await db(ctx).order.updateMany({
    where: { userId, attemptKey, status: { in: ['FAILED', 'CANCELLED'] } },
    data: { attemptKey: null },
  });
}

export function findUnpaid(ctx: DbContext, userId: string) {
  return db(ctx).order.findFirst({
    where: { userId, status: 'PENDING_PAYMENT' },
    orderBy: { createdAt: 'desc' },
    select: briefFields,
  });
}

export function findUnpaidOrders(ctx: DbContext, userId: string) {
  return db(ctx).order.findMany({
    where: { userId, status: 'PENDING_PAYMENT' },
    select: briefFields,
  });
}

export function findRecentDuplicate(
  ctx: DbContext,
  userId: string,
  fingerprint: string,
  since: Date,
) {
  return db(ctx).order.findFirst({
    where: {
      userId,
      cartFingerprint: fingerprint,
      createdAt: { gte: since },
      status: { in: LIVE },
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, number: true },
  });
}

/** Whether a live order other than `exceptId` holds this checkout key. */
export async function attemptKeyTaken(
  ctx: DbContext,
  userId: string,
  attemptKey: string,
  exceptId: string,
) {
  const count = await db(ctx).order.count({
    where: { userId, attemptKey, id: { not: exceptId }, status: { in: LIVE } },
  });
  return count > 0;
}

// ------------------------------------------------------------------ codes

/** Uses of a code held or completed by this customer (B9). */
export function countCustomerUses(ctx: DbContext, couponId: string, userId: string) {
  return db(ctx).couponRedemption.count({
    where: { couponId, userId, status: { in: ['RESERVED', 'REDEEMED'] } },
  });
}

/**
 * Takes one use of a code, atomically: only while it is switched on, running, and under its
 * limit (S9.1, plan "updateMany where usedCount < usageLimit"). 0 means it just ran out.
 */
export async function takeCouponUse(
  ctx: DbContext,
  coupon: { id: string; usageLimit: number | null },
  now: Date,
) {
  const window: Prisma.CouponWhereInput = {
    id: coupon.id,
    isActive: true,
    startsAt: { lte: now },
    OR: [{ endsAt: null }, { endsAt: { gt: now } }],
  };
  if (coupon.usageLimit === null) {
    const result = await db(ctx).coupon.updateMany({
      where: window,
      data: { usedCount: { increment: 1 } },
    });
    return result.count;
  }
  const result = await db(ctx).coupon.updateMany({
    where: { ...window, usedCount: { lt: coupon.usageLimit } },
    data: { usedCount: { increment: 1 } },
  });
  return result.count;
}

/** A late payment keeps its code even past the limit (U10); it is logged by the caller. */
export async function forceCouponUse(ctx: DbContext, couponId: string) {
  await db(ctx).coupon.updateMany({
    where: { id: couponId },
    data: { usedCount: { increment: 1 } },
  });
}

/**
 * Locks a code's row until the commit and reads its limits, so a late payment's revive and a
 * checkout taking the same code can't both count on the last use.
 */
export async function lockCouponLimits(ctx: DbContext, couponId: string) {
  const rows = await db(ctx).$queryRaw<
    { used_count: number; usage_limit: number | null; per_user_limit: number | null }[]
  >`SELECT used_count, usage_limit, per_user_limit FROM coupons WHERE id = ${couponId}::uuid FOR UPDATE`;
  const row = rows[0];
  return row
    ? { usedCount: row.used_count, usageLimit: row.usage_limit, perUserLimit: row.per_user_limit }
    : null;
}

/** Gives a use back. */
export async function returnCouponUse(ctx: DbContext, couponId: string) {
  await db(ctx).coupon.updateMany({
    where: { id: couponId, usedCount: { gt: 0 } },
    data: { usedCount: { decrement: 1 } },
  });
}

export function findRedemption(ctx: DbContext, orderId: string) {
  return db(ctx).couponRedemption.findUnique({
    where: { orderId },
    select: {
      couponId: true,
      status: true,
      coupon: { select: { usageLimit: true, usedCount: true } },
    },
  });
}

export async function setRedemptionStatus(
  ctx: DbContext,
  orderId: string,
  status: RedemptionStatus,
) {
  await db(ctx).couponRedemption.updateMany({ where: { orderId }, data: { status } });
}

// ------------------------------------------------------------------ creating an order

export interface NewOrder {
  userId: string;
  status: 'PLACED' | 'PENDING_PAYMENT';
  paymentMethod: PaymentMethod;
  contactName: string;
  contactPhone: string;
  addressText: string;
  addressLabel: string;
  addressLine1: string;
  addressLine2: string | null;
  addressCity: string;
  courierInstructions: string | null;
  addressLat: number;
  addressLng: number;
  distanceKm: number;
  note: string | null;
  subtotalCents: number;
  discountCents: number;
  deliveryFeeCents: number;
  deliveryDiscountCents: number;
  taxCents: number;
  taxRateBps: number;
  tipCents: number;
  tipChoice: string;
  totalCents: number;
  couponId: string | null;
  promoCode: string | null;
  attemptKey: string;
  cartFingerprint: string;
  arrivalFromMinutes: number | null;
  arrivalToMinutes: number | null;
  expiresAt: Date | null;
  placedAt: Date | null;
}

export interface NewOrderLine {
  menuItemId: string;
  title: string;
  unitPriceCents: number;
  quantity: number;
  flavors: string[];
  note: string | null;
}

export async function insertOrder(
  ctx: DbContext,
  order: NewOrder,
  lines: NewOrderLine[],
  redemption: { couponId: string; status: 'RESERVED' | 'REDEEMED'; discountCents: number } | null,
) {
  const created = await db(ctx).order.create({
    data: {
      userId: order.userId,
      status: order.status,
      paymentMethod: order.paymentMethod,
      paymentStatus: 'UNPAID',
      contactName: order.contactName,
      contactPhone: order.contactPhone,
      addressText: order.addressText,
      addressLabel: order.addressLabel,
      addressLine1: order.addressLine1,
      addressLine2: order.addressLine2,
      addressCity: order.addressCity,
      courierInstructions: order.courierInstructions,
      addressLat: order.addressLat,
      addressLng: order.addressLng,
      distanceKm: order.distanceKm,
      note: order.note,
      subtotalCents: order.subtotalCents,
      discountCents: order.discountCents,
      deliveryFeeCents: order.deliveryFeeCents,
      deliveryDiscountCents: order.deliveryDiscountCents,
      taxCents: order.taxCents,
      taxRateBps: order.taxRateBps,
      tipCents: order.tipCents,
      tipChoice: order.tipChoice,
      totalCents: order.totalCents,
      couponId: order.couponId,
      promoCode: order.promoCode,
      attemptKey: order.attemptKey,
      cartFingerprint: order.cartFingerprint,
      arrivalFromMinutes: order.arrivalFromMinutes,
      arrivalToMinutes: order.arrivalToMinutes,
      expiresAt: order.expiresAt,
      placedAt: order.placedAt,
    },
    select: { id: true, number: true },
  });
  await db(ctx).orderItem.createMany({
    data: lines.map((line) => ({
      orderId: created.id,
      menuItemId: line.menuItemId,
      title: line.title,
      unitPriceCents: line.unitPriceCents,
      quantity: line.quantity,
      flavors: line.flavors,
      note: line.note,
    })),
  });
  if (redemption) {
    await db(ctx).couponRedemption.create({
      data: {
        couponId: redemption.couponId,
        userId: order.userId,
        orderId: created.id,
        status: redemption.status,
        discountCents: redemption.discountCents,
      },
      select: { id: true },
    });
  }
  return created;
}

export async function addEvent(
  ctx: DbContext,
  event: {
    orderId: string;
    type: string;
    fromStatus?: OrderStatus | null;
    toStatus?: OrderStatus | null;
    actorId?: string | null;
    data?: Prisma.InputJsonValue;
  },
) {
  await db(ctx).orderEvent.create({
    data: {
      orderId: event.orderId,
      type: event.type,
      fromStatus: event.fromStatus ?? null,
      toStatus: event.toStatus ?? null,
      actorId: event.actorId ?? null,
      data: event.data,
    },
    select: { id: true },
  });
}

export async function setPaymentIntent(ctx: DbContext, orderId: string, paymentIntentId: string) {
  await db(ctx).order.updateMany({
    where: { id: orderId, stripePaymentIntentId: null },
    data: { stripePaymentIntentId: paymentIntentId },
  });
}

// ------------------------------------------------------------------ payment state

const paymentFields = {
  id: true,
  number: true,
  userId: true,
  status: true,
  paymentMethod: true,
  paymentStatus: true,
  totalCents: true,
  refundedCents: true,
  cancelReason: true,
  autoRefundReason: true,
  expiresAt: true,
  stripePaymentIntentId: true,
  attemptKey: true,
  couponId: true,
  cardBrand: true,
  version: true,
  createdAt: true,
} as const;

export type OrderPaymentRow = Prisma.OrderGetPayload<{ select: typeof paymentFields }>;

/** Locks the order row for the rest of the transaction, then reads it. */
export async function lockOrder(ctx: DbContext, orderId: string): Promise<OrderPaymentRow | null> {
  const rows = await db(ctx).$queryRaw<{ id: string }[]>`
    SELECT id::text AS id FROM orders WHERE id = ${orderId}::uuid FOR UPDATE`;
  if (rows.length === 0) return null;
  return db(ctx).order.findUnique({ where: { id: orderId }, select: paymentFields });
}

export function findOrderForPayment(ctx: DbContext, orderId: string) {
  return db(ctx).order.findUnique({ where: { id: orderId }, select: paymentFields });
}

/** The name and delivery address kept on the order (S2.10), for the PaymentIntent's shipping. */
export function findOrderShipping(ctx: DbContext, orderId: string) {
  return db(ctx).order.findUnique({
    where: { id: orderId },
    select: { contactName: true, addressLine1: true, addressLine2: true, addressCity: true },
  });
}

export function findOrderIdByIntent(ctx: DbContext, paymentIntentId: string) {
  return db(ctx).order.findUnique({
    where: { stripePaymentIntentId: paymentIntentId },
    select: { id: true },
  });
}

export interface OrderChange {
  status?: OrderStatus;
  paymentStatus?: PaymentStatus;
  placedAt?: Date | null;
  cancelledAt?: Date | null;
  cancelReason?: string | null;
  autoRefundReason?: string | null;
  refundedCents?: number;
  cardBrand?: string | null;
  cardLast4?: string | null;
  stripePaymentMethodId?: string | null;
  disputeStatus?: DisputeStatus;
  disputeOpenedAt?: Date | null;
  disputeClosedAt?: Date | null;
}

/** Applies a change at the version read under the lock (optimistic concurrency, B1). */
export async function updateOrder(
  ctx: DbContext,
  orderId: string,
  version: number,
  change: OrderChange,
) {
  const result = await db(ctx).order.updateMany({
    where: { id: orderId, version },
    data: {
      status: change.status,
      paymentStatus: change.paymentStatus,
      placedAt: change.placedAt,
      cancelledAt: change.cancelledAt,
      cancelReason: change.cancelReason,
      autoRefundReason: change.autoRefundReason,
      refundedCents: change.refundedCents,
      cardBrand: change.cardBrand,
      cardLast4: change.cardLast4,
      stripePaymentMethodId: change.stripePaymentMethodId,
      disputeStatus: change.disputeStatus,
      disputeOpenedAt: change.disputeOpenedAt,
      disputeClosedAt: change.disputeClosedAt,
      version: { increment: 1 },
    },
  });
  if (result.count !== 1) throw new Error('The order changed while it was being updated.');
}

/** Every dish of the order is still on the menu and available (U10 revive). */
export async function allDishesAvailable(ctx: DbContext, orderId: string) {
  const items = await db(ctx).orderItem.findMany({
    where: { orderId },
    select: { menuItem: { select: { isAvailable: true } } },
  });
  return items.length > 0 && items.every((item) => item.menuItem.isAvailable);
}

export function findEvents(ctx: DbContext, orderId: string, type: string) {
  return db(ctx).orderEvent.findMany({
    where: { orderId, type },
    orderBy: { createdAt: 'asc' },
    select: { data: true, createdAt: true },
  });
}

/** Unpaid orders whose time ran out, for the sweep that catches lost expiry jobs (B8). */
export function findDueUnpaid(ctx: DbContext, before: Date, take: number) {
  return db(ctx).order.findMany({
    where: { status: 'PENDING_PAYMENT', expiresAt: { lte: before } },
    orderBy: { expiresAt: 'asc' },
    take,
    select: { id: true },
  });
}

/** Card payments Foodz decided to give back and hasn't refunded yet, for the refund sweep. */
export function findUnsettledRefunds(ctx: DbContext, before: Date, take: number) {
  return db(ctx).order.findMany({
    where: {
      autoRefundReason: { not: null },
      paymentStatus: { in: ['PAID', 'PARTIALLY_REFUNDED'] },
      stripePaymentIntentId: { not: null },
      updatedAt: { lte: before },
    },
    // Newest first, so a refund that keeps failing can't hold back the ones behind it.
    orderBy: { updatedAt: 'desc' },
    take,
    select: { id: true },
  });
}

// ------------------------------------------------------------------ reading orders

const viewFields = {
  id: true,
  number: true,
  userId: true,
  status: true,
  paymentMethod: true,
  paymentStatus: true,
  contactName: true,
  contactPhone: true,
  addressLabel: true,
  addressLine1: true,
  addressLine2: true,
  addressCity: true,
  addressText: true,
  courierInstructions: true,
  distanceKm: true,
  note: true,
  subtotalCents: true,
  discountCents: true,
  deliveryFeeCents: true,
  deliveryDiscountCents: true,
  taxCents: true,
  taxRateBps: true,
  tipCents: true,
  tipChoice: true,
  totalCents: true,
  refundedCents: true,
  promoCode: true,
  cardBrand: true,
  cardLast4: true,
  disputeStatus: true,
  disputeOpenedAt: true,
  disputeClosedAt: true,
  arrivalFromMinutes: true,
  arrivalToMinutes: true,
  autoRefundReason: true,
  expiresAt: true,
  placedAt: true,
  cancelledAt: true,
  cancelReason: true,
  createdAt: true,
  coupon: { select: { code: true } },
  items: {
    orderBy: { id: 'asc' },
    select: { title: true, unitPriceCents: true, quantity: true, flavors: true, note: true },
  },
  events: {
    orderBy: { createdAt: 'asc' },
    select: { type: true, data: true, createdAt: true },
  },
} as const;

export type OrderViewRow = Prisma.OrderGetPayload<{ select: typeof viewFields }>;

/** One order with its lines and timeline; `userId` limits it to that customer's own. */
export function findOrderView(ctx: DbContext, orderId: string, userId?: string) {
  return db(ctx).order.findFirst({
    where: { id: orderId, ...(userId && { userId }) },
    select: viewFields,
  });
}

export function findOrderEmailRecipient(ctx: DbContext, orderId: string) {
  return db(ctx).order.findUnique({
    where: { id: orderId },
    select: { user: { select: { email: true, banned: true, deletedAt: true } } },
  });
}

const summaryFields = {
  id: true,
  number: true,
  status: true,
  paymentMethod: true,
  paymentStatus: true,
  disputeStatus: true,
  cancelReason: true,
  totalCents: true,
  createdAt: true,
  items: { orderBy: { id: 'asc' }, select: { title: true, quantity: true } },
} as const;

export type OrderSummaryRow = Prisma.OrderGetPayload<{ select: typeof summaryFields }>;

export function listInProgress(ctx: DbContext, userId: string, take: number) {
  return db(ctx).order.findMany({
    where: { userId, status: { in: IN_PROGRESS } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take,
    select: summaryFields,
  });
}

/** Past orders newest first, after the (createdAt, id) cursor. */
export function listPast(
  ctx: DbContext,
  userId: string,
  after: { createdAt: Date; id: string } | null,
  take: number,
) {
  return db(ctx).order.findMany({
    where: {
      userId,
      status: { in: PAST },
      ...(after && {
        OR: [
          { createdAt: { lt: after.createdAt } },
          { createdAt: after.createdAt, id: { lt: after.id } },
        ],
      }),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take,
    select: summaryFields,
  });
}

/** Orders the customer sees in their list (failed attempts are never shown). */
export function countListed(ctx: DbContext, userId: string) {
  return db(ctx).order.count({ where: { userId, status: { not: 'FAILED' } } });
}

export async function lastPaymentMethod(ctx: DbContext, userId: string) {
  const row = await db(ctx).order.findFirst({
    where: { userId, status: { not: 'FAILED' } },
    orderBy: { createdAt: 'desc' },
    select: { paymentMethod: true },
  });
  return row?.paymentMethod ?? null;
}

/** When each saved card last paid for an order, by PaymentMethod id. */
export async function cardsLastUsed(ctx: DbContext, userId: string) {
  const rows = await db(ctx).order.groupBy({
    by: ['stripePaymentMethodId'],
    where: { userId, stripePaymentMethodId: { not: null }, placedAt: { not: null } },
    _max: { placedAt: true },
  });
  return new Map(
    rows.flatMap((row) =>
      row.stripePaymentMethodId && row._max.placedAt
        ? [[row.stripePaymentMethodId, row._max.placedAt] as const]
        : [],
    ),
  );
}

/** For account deletion: a placed order she can still cancel, and orders on their way. */
export async function findBlockingOrders(ctx: DbContext, userId: string) {
  const placed = await db(ctx).order.findFirst({
    where: { userId, status: 'PLACED' },
    orderBy: { createdAt: 'desc' },
    select: { id: true, number: true },
  });
  const onItsWay = await db(ctx).order.count({
    where: { userId, status: { in: ['ACCEPTED', 'PREPARING', 'READY', 'PICKED_UP'] } },
  });
  return { placed, onItsWay };
}

/** Account deletion keeps the caller's orders without their details (migration function). */
export async function anonymizeOwnOrders(ctx: DbContext) {
  await db(ctx).$queryRaw`SELECT app_anonymize_own_orders()`;
}

export function listForExport(ctx: DbContext, userId: string) {
  return db(ctx).order.findMany({
    where: { userId, status: { not: 'FAILED' } },
    orderBy: { createdAt: 'desc' },
    select: {
      number: true,
      status: true,
      createdAt: true,
      placedAt: true,
      deliveredAt: true,
      cancelledAt: true,
      paymentMethod: true,
      paymentStatus: true,
      cardBrand: true,
      cardLast4: true,
      subtotalCents: true,
      discountCents: true,
      deliveryFeeCents: true,
      deliveryDiscountCents: true,
      taxCents: true,
      tipCents: true,
      totalCents: true,
      refundedCents: true,
      promoCode: true,
      addressText: true,
      note: true,
      items: {
        orderBy: { id: 'asc' },
        select: { title: true, quantity: true, unitPriceCents: true, flavors: true, note: true },
      },
    },
  });
}

// ------------------------------------------------------------------ the last check before writing

interface AddressAreaRow {
  lat: number;
  lng: number;
  distance_m: number | null;
  inside: boolean | null;
}

/**
 * What the order's figures rest on, read inside the order's own transaction (F3 security S8):
 * the dishes' prices and availability, the pricing settings, and the saved address the order
 * goes to with its distance from the kitchen.
 */
export async function findPricingFacts(
  ctx: DbContext,
  input: { userId: string; addressId: string; menuItemIds: string[] },
) {
  // One query at a time: they share the transaction's connection.
  const dishes = await db(ctx).menuItem.findMany({
    where: { id: { in: input.menuItemIds } },
    select: { id: true, priceCents: true, isAvailable: true },
  });
  const settings = await db(ctx).siteSettings.findUnique({
    where: { id: 1 },
    select: {
      taxRateBps: true,
      baseDeliveryFeeCents: true,
      perKmFeeCents: true,
      deliveryRadiusKm: true,
    },
  });
  const address = await db(ctx).$queryRaw<AddressAreaRow[]>`
    SELECT a.lat, a.lng,
           ST_Distance(a.location, s.location) AS distance_m,
           ST_DWithin(a.location, s.location, s.delivery_radius_km * 1000) AS inside
    FROM addresses a
    CROSS JOIN site_settings s
    WHERE s.id = 1 AND a.id = ${input.addressId}::uuid AND a.user_id = ${input.userId}::uuid`;
  return {
    dishes: new Map(dishes.map((dish) => [dish.id, dish])),
    settings,
    address: address[0] ?? null,
  };
}
