import 'server-only';
import { db } from '@/server/db/client';
import type { DbContext } from '@/server/db/context';
import type {
  Cuisine,
  DisputeStatus,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
} from '@/server/db/generated/client';
import { Prisma } from '@/server/db/generated/client';

/*
 * The staff order board's data. Staff read orders, lines and timelines through the masked
 * directory views (F5 migration), so the demo admin sees real customers masked and the database
 * decides it. Changes run as the staff member: row-level security and the orders guard trigger
 * check them again.
 */

// ------------------------------------------------------------------ reads

export interface BoardOrderRow {
  id: string;
  number: string;
  userId: string;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  contactName: string;
  contactPhone: string;
  addressLabel: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  addressCity: string | null;
  addressText: string;
  courierInstructions: string | null;
  note: string | null;
  distanceKm: number;
  subtotalCents: number;
  discountCents: number;
  deliveryFeeCents: number;
  deliveryDiscountCents: number;
  taxCents: number;
  taxRateBps: number | null;
  tipCents: number;
  totalCents: number;
  refundedCents: number;
  promoCode: string | null;
  cardBrand: string | null;
  cardLast4: string | null;
  disputeStatus: DisputeStatus;
  disputeOpenedAt: Date | null;
  disputeClosedAt: Date | null;
  arrivalFromMinutes: number | null;
  arrivalToMinutes: number | null;
  autoRefundReason: string | null;
  hasPaymentIntent: boolean;
  placedAt: Date | null;
  acceptedAt: Date | null;
  preparingAt: Date | null;
  readyAt: Date | null;
  pickedUpAt: Date | null;
  deliveredAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  cancelCode: string | null;
  cancelLineIds: string[];
  prepMinutes: number | null;
  version: number;
  statusChangedVersion: number;
  createdAt: Date;
  updatedAt: Date;
  /** A real customer's order read by the demo admin: personal details are masked. */
  masked: boolean;
}

const ORDER_COLUMNS = Prisma.sql`
  id::text AS "id", number, user_id::text AS "userId", status::text AS "status",
  payment_method::text AS "paymentMethod", payment_status::text AS "paymentStatus",
  contact_name AS "contactName", contact_phone AS "contactPhone",
  address_label AS "addressLabel", address_line1 AS "addressLine1",
  address_line2 AS "addressLine2", address_city AS "addressCity", address_text AS "addressText",
  courier_instructions AS "courierInstructions", note, distance_km AS "distanceKm",
  subtotal_cents AS "subtotalCents", discount_cents AS "discountCents",
  delivery_fee_cents AS "deliveryFeeCents", delivery_discount_cents AS "deliveryDiscountCents",
  tax_cents AS "taxCents", tax_rate_bps AS "taxRateBps", tip_cents AS "tipCents",
  total_cents AS "totalCents", refunded_cents AS "refundedCents", promo_code AS "promoCode",
  card_brand AS "cardBrand", card_last4 AS "cardLast4", dispute_status::text AS "disputeStatus",
  dispute_opened_at AS "disputeOpenedAt", dispute_closed_at AS "disputeClosedAt",
  arrival_from_minutes AS "arrivalFromMinutes", arrival_to_minutes AS "arrivalToMinutes",
  auto_refund_reason AS "autoRefundReason", has_payment_intent AS "hasPaymentIntent",
  placed_at AS "placedAt", accepted_at AS "acceptedAt", preparing_at AS "preparingAt",
  ready_at AS "readyAt", picked_up_at AS "pickedUpAt", delivered_at AS "deliveredAt",
  cancelled_at AS "cancelledAt", cancel_reason AS "cancelReason", cancel_code AS "cancelCode",
  cancel_line_ids::text[] AS "cancelLineIds", prep_minutes AS "prepMinutes", version,
  status_changed_version AS "statusChangedVersion", created_at AS "createdAt",
  updated_at AS "updatedAt", masked`;

export interface BoardLineRow {
  id: string;
  orderId: string;
  dishId: string;
  title: string;
  unitPriceCents: number;
  quantity: number;
  flavors: string[];
  note: string | null;
}

export interface BoardEventRow {
  id: string;
  orderId: string;
  type: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus | null;
  actorId: string | null;
  data: unknown;
  createdAt: Date;
}

const LINE_COLUMNS = Prisma.sql`
  id::text AS "id", order_id::text AS "orderId", menu_item_id::text AS "dishId", title,
  unit_price_cents AS "unitPriceCents", quantity, coalesce(flavors, '{}') AS "flavors", note`;

const EVENT_COLUMNS = Prisma.sql`
  id::text AS "id", order_id::text AS "orderId", type, from_status::text AS "fromStatus",
  to_status::text AS "toStatus", actor_id::text AS "actorId", data, created_at AS "createdAt"`;

export async function findOrder(ctx: DbContext, orderId: string) {
  const rows = await db(ctx).$queryRaw<BoardOrderRow[]>`
    SELECT ${ORDER_COLUMNS} FROM order_directory WHERE id = ${orderId}::uuid`;
  return rows[0] ?? null;
}

/** Orders in the given statuses, oldest placed first. */
export function listOrdersInStatuses(ctx: DbContext, statuses: readonly OrderStatus[]) {
  return db(ctx).$queryRaw<BoardOrderRow[]>`
    SELECT ${ORDER_COLUMNS} FROM order_directory
    WHERE status::text = ANY(${[...statuses]}::text[])
    ORDER BY placed_at ASC NULLS LAST, id ASC`;
}

export function listOrdersByIds(ctx: DbContext, orderIds: readonly string[]) {
  return db(ctx).$queryRaw<BoardOrderRow[]>`
    SELECT ${ORDER_COLUMNS} FROM order_directory WHERE id = ANY(${[...orderIds]}::uuid[])`;
}

export async function findOrderByNumber(ctx: DbContext, number: string) {
  const rows = await db(ctx).$queryRaw<{ id: string; number: string; status: OrderStatus }[]>`
    SELECT id::text AS "id", number, status::text AS "status"
    FROM order_directory WHERE number = ${number}`;
  return rows[0] ?? null;
}

export function listLines(ctx: DbContext, orderIds: readonly string[]) {
  if (orderIds.length === 0) return Promise.resolve([] as BoardLineRow[]);
  return db(ctx).$queryRaw<BoardLineRow[]>`
    SELECT ${LINE_COLUMNS} FROM order_item_directory
    WHERE order_id = ANY(${[...orderIds]}::uuid[])
    ORDER BY order_id, id`;
}

/** An order's whole timeline, oldest first. */
export function listEvents(ctx: DbContext, orderId: string) {
  return db(ctx).$queryRaw<BoardEventRow[]>`
    SELECT ${EVENT_COLUMNS} FROM order_event_directory
    WHERE order_id = ${orderId}::uuid
    ORDER BY created_at ASC, id ASC`;
}

/**
 * What the cards need of the timelines: revived orders ("Paid late"), the caller's own recent
 * moves (Undo survives a reload, A4.7), and how each order last changed status (who cancelled
 * it, for orders leaving the board).
 */
export function listCardEvents(
  ctx: DbContext,
  orderIds: readonly string[],
  callerId: string,
  since: Date,
) {
  if (orderIds.length === 0) return Promise.resolve([] as BoardEventRow[]);
  return db(ctx).$queryRaw<BoardEventRow[]>`
    SELECT ${EVENT_COLUMNS} FROM order_event_directory
    WHERE order_id = ANY(${[...orderIds]}::uuid[])
      AND (
        type = 'revived'
        OR (type IN ('accepted', 'preparing', 'ready') AND actor_id = ${callerId}::uuid
            AND created_at >= ${since})
        OR type IN ('cancelled', 'refused', 'expired', 'picked-up', 'delivered')
      )
    ORDER BY created_at ASC, id ASC`;
}

/** The people's names behind staff ids, for the timeline snapshot of a change. */
export async function findStaffName(ctx: DbContext, userId: string) {
  const user = await db(ctx).user.findUnique({ where: { id: userId }, select: { name: true } });
  return user?.name ?? null;
}

// ------------------------------------------------------------------ dishes

const dishFields = {
  id: true,
  title: true,
  cuisine: true,
  isAvailable: true,
  soldOutAt: true,
  soldOutBy: { select: { name: true, isDemo: true, isSample: true } },
} as const;

export interface DishRow {
  id: string;
  title: string;
  cuisine: Cuisine;
  isAvailable: boolean;
  soldOutAt: Date | null;
  /** Null when the person can't be read (a real staff member, for the demo admin). */
  soldOutBy: { name: string; isDemo: boolean; isSample: boolean } | null;
}

export function listDishes(ctx: DbContext): Promise<DishRow[]> {
  return db(ctx).menuItem.findMany({
    orderBy: [{ cuisine: 'asc' }, { title: 'asc' }],
    select: dishFields,
  });
}

export function listSoldOutDishes(ctx: DbContext): Promise<DishRow[]> {
  return db(ctx).menuItem.findMany({
    where: { isAvailable: false },
    orderBy: [{ soldOutAt: 'asc' }, { title: 'asc' }],
    select: dishFields,
  });
}

export function findDish(ctx: DbContext, dishId: string): Promise<DishRow | null> {
  return db(ctx).menuItem.findUnique({ where: { id: dishId }, select: dishFields });
}

/**
 * Marks dishes sold out, or back on (lead decision "86 it"). Returns the dishes that changed;
 * a dish already in that state is left alone.
 */
export async function setDishesAvailable(
  ctx: DbContext,
  dishIds: readonly string[],
  available: boolean,
  by: string,
  at: Date,
) {
  const changing = await db(ctx).menuItem.findMany({
    where: { id: { in: [...dishIds] }, isAvailable: !available },
    select: { id: true, title: true },
  });
  if (changing.length === 0) return [];
  await db(ctx).menuItem.updateMany({
    where: { id: { in: changing.map((dish) => dish.id) }, isAvailable: !available },
    data: available
      ? { isAvailable: true, soldOutAt: null, soldOutById: null }
      : { isAvailable: false, soldOutAt: at, soldOutById: by },
  });
  return changing;
}

// ------------------------------------------------------------------ changes

/** Locks the order row for the rest of the transaction; false when there is no such order. */
export async function lockOrder(ctx: DbContext, orderId: string) {
  const rows = await db(ctx).$queryRaw<{ id: string }[]>`
    SELECT id::text AS id FROM orders WHERE id = ${orderId}::uuid FOR UPDATE`;
  return rows.length > 0;
}

export interface StatusChange {
  status: OrderStatus;
  acceptedAt?: Date | null;
  preparingAt?: Date | null;
  readyAt?: Date | null;
  pickedUpAt?: Date | null;
  deliveredAt?: Date | null;
  cancelledAt?: Date;
  cancelReason?: 'staff' | 'kitchen-refused';
  cancelCode?: string;
  cancelLineIds?: string[];
  autoRefundReason?: 'staff-cancel';
  paymentStatus?: 'PAID';
}

/**
 * Applies a status change at the version read under the lock, field by field. Returns the
 * order's new version (the trigger records it as the status's version too).
 */
export async function applyStatusChange(
  ctx: DbContext,
  orderId: string,
  version: number,
  change: StatusChange,
) {
  const result = await db(ctx).order.updateMany({
    where: { id: orderId, version },
    data: {
      status: change.status,
      acceptedAt: change.acceptedAt,
      preparingAt: change.preparingAt,
      readyAt: change.readyAt,
      pickedUpAt: change.pickedUpAt,
      deliveredAt: change.deliveredAt,
      cancelledAt: change.cancelledAt,
      cancelReason: change.cancelReason,
      cancelCode: change.cancelCode,
      cancelLineIds: change.cancelLineIds,
      autoRefundReason: change.autoRefundReason,
      paymentStatus: change.paymentStatus,
      version: { increment: 1 },
    },
  });
  if (result.count !== 1) throw new Error('The order changed while it was being updated.');
  return version + 1;
}

export async function insertEvent(
  ctx: DbContext,
  event: {
    orderId: string;
    type: string;
    fromStatus: OrderStatus | null;
    toStatus: OrderStatus | null;
    actorId: string;
    data: Prisma.InputJsonValue;
    at: Date;
  },
) {
  return db(ctx).orderEvent.create({
    data: {
      orderId: event.orderId,
      type: event.type,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      actorId: event.actorId,
      data: event.data,
      createdAt: event.at,
    },
    select: { id: true, createdAt: true },
  });
}

/** Gives the order's code back (migration function); the code, or null when it had none. */
export async function releaseOrderCode(ctx: DbContext, orderId: string) {
  const rows = await db(ctx).$queryRaw<{ code: string | null }[]>`
    SELECT app_release_order_code(${orderId}::uuid) AS code`;
  return rows[0]?.code ?? null;
}

/** How many times this person did `action` since `since` (for the alerts, A6.6, A7.11). */
export function countRecentAudits(ctx: DbContext, actorId: string, action: string, since: Date) {
  return db(ctx).auditLog.count({ where: { actorId, action, createdAt: { gte: since } } });
}
