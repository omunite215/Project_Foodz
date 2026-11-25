import 'server-only';
import { db } from '@/server/db/client';
import type { DbContext } from '@/server/db/context';
import type { DeliveryStatus, OfferStatus, PartnerStatus, VehicleType } from '@/server/db/enums';
import {
  type DeliveryPool,
  OFFER_ENDINGS,
  type OfferEnding,
  type OfferKind,
  type SearchStopReason,
} from './schema';

/*
 * Dispatch storage (F7). Partners read their own offers as themselves (row-level security) and
 * answer through the definer functions; staff write as themselves under the guard triggers; the
 * dispatch run and the hooks write as the platform. Every cut-off uses the database's clock
 * (`app_now()`); positions are compared in PostGIS (B3, B12).
 */

const ACTIVE: DeliveryStatus[] = ['ASSIGNED', 'AT_RESTAURANT', 'PICKED_UP'];

// ------------------------------------------------------------------ rows

export interface DeliveryRow {
  id: string;
  orderId: string;
  partnerId: string | null;
  status: DeliveryStatus;
  version: number;
  readyAt: Date | null;
  readyEventId: string | null;
  searchStartedAt: Date | null;
  searchRestartedAt: Date | null;
  escalatedAt: Date | null;
  searchStoppedAt: Date | null;
  searchStopReason: string | null;
  pool: DeliveryPool;
  excludedPartnerIds: string[];
  courierChanged: boolean;
  assignedAt: Date | null;
  pickedUpAt: Date | null;
  deliveredAt: Date | null;
  partnerFeeCents: number;
  tipCents: number;
  partnerWaitingSince: Date | null;
}

const DELIVERY_COLUMNS = {
  id: true,
  orderId: true,
  partnerId: true,
  status: true,
  version: true,
  readyAt: true,
  readyEventId: true,
  searchStartedAt: true,
  searchRestartedAt: true,
  escalatedAt: true,
  searchStoppedAt: true,
  searchStopReason: true,
  pool: true,
  excludedPartnerIds: true,
  courierChanged: true,
  assignedAt: true,
  pickedUpAt: true,
  deliveredAt: true,
  partnerFeeCents: true,
  tipCents: true,
  partnerWaitingSince: true,
} as const;

const asDelivery = (row: Omit<DeliveryRow, 'pool'> & { pool: string }): DeliveryRow => ({
  ...row,
  pool: row.pool === 'DEMO' ? 'DEMO' : 'REAL',
});

/** What dispatch reads of an order (never the customer's street before pickup, U11). */
export interface DispatchOrderRow {
  id: string;
  number: string;
  status: string;
  userId: string;
  customerIsDemo: boolean;
  readyAt: Date | null;
  deliveryFeeCents: number;
  tipCents: number;
  paymentMethod: 'CARD' | 'CASH';
  paymentStatus: string;
  totalCents: number;
  addressText: string;
  /** The city line ("Boston, MA 02109"): all of the address shown before acceptance. */
  addressCity: string | null;
  addressLat: number;
  addressLng: number;
  courierInstructions: string | null;
  contactName: string;
  items: number;
  /** Straight line from the kitchen to the drop-off. */
  dropoffM: number;
}

export async function findOrderForDispatch(
  ctx: DbContext,
  orderId: string,
  lock = false,
): Promise<DispatchOrderRow | null> {
  const rows = lock
    ? await db(ctx).$queryRaw<{ id: string }[]>`
        SELECT id::text FROM orders WHERE id = ${orderId}::uuid FOR UPDATE`
    : [{ id: orderId }];
  if (rows.length === 0) return null;
  const found = await db(ctx).$queryRaw<DispatchOrderRow[]>`
    SELECT o.id::text AS "id", o.number AS "number", o.status::text AS "status",
           o.user_id::text AS "userId", u.is_demo AS "customerIsDemo", o.ready_at AS "readyAt",
           o.delivery_fee_cents AS "deliveryFeeCents", o.tip_cents AS "tipCents",
           o.payment_method::text AS "paymentMethod", o.payment_status::text AS "paymentStatus",
           o.total_cents AS "totalCents", o.address_text AS "addressText",
           o.address_city AS "addressCity",
           o.address_lat AS "addressLat", o.address_lng AS "addressLng",
           o.courier_instructions AS "courierInstructions", o.contact_name AS "contactName",
           (SELECT coalesce(sum(i.quantity), 0)::int FROM order_items i WHERE i.order_id = o.id) AS "items",
           round(ST_Distance(
             ST_SetSRID(ST_MakePoint(o.address_lng, o.address_lat), 4326)::geography,
             ST_SetSRID(ST_MakePoint(k.lng, k.lat), 4326)::geography
           ))::int AS "dropoffM"
    FROM orders o
    JOIN users u ON u.id = o.user_id
    CROSS JOIN site_settings k
    WHERE o.id = ${orderId}::uuid AND k.id = 1`;
  return found[0] ?? null;
}

export async function findDelivery(ctx: DbContext, id: string, lock = false) {
  if (lock) {
    const locked = await db(ctx).$queryRaw<{ id: string }[]>`
      SELECT id::text FROM deliveries WHERE id = ${id}::uuid FOR UPDATE`;
    if (locked.length === 0) return null;
  }
  const row = await db(ctx).delivery.findUnique({ where: { id }, select: DELIVERY_COLUMNS });
  return row ? asDelivery(row) : null;
}

export async function findDeliveryByOrder(ctx: DbContext, orderId: string, lock = false) {
  if (lock) {
    await db(ctx).$queryRaw`SELECT id FROM deliveries WHERE order_id = ${orderId}::uuid FOR UPDATE`;
  }
  const row = await db(ctx).delivery.findUnique({ where: { orderId }, select: DELIVERY_COLUMNS });
  return row ? asDelivery(row) : null;
}

export async function listDeliveriesByIds(ctx: DbContext, ids: readonly string[]) {
  if (ids.length === 0) return [];
  const rows = await db(ctx).delivery.findMany({
    where: { id: { in: [...ids] } },
    select: DELIVERY_COLUMNS,
  });
  return rows.map(asDelivery);
}

export async function listDeliveriesByOrders(ctx: DbContext, orderIds: readonly string[]) {
  if (orderIds.length === 0) return [];
  const rows = await db(ctx).delivery.findMany({
    where: { orderId: { in: [...orderIds] } },
    select: DELIVERY_COLUMNS,
  });
  return rows.map(asDelivery);
}

// ------------------------------------------------------------------ the search's writes

/** Every offer for every order is made one at a time across all app tasks (W9, W10.2). */
export async function lockDispatch(ctx: DbContext) {
  await db(ctx).$executeRaw`SELECT pg_advisory_xact_lock(hashtext('foodz:dispatch'))`;
}

export async function insertDelivery(
  ctx: DbContext,
  values: {
    orderId: string;
    pool: DeliveryPool;
    readyAt: Date | null;
    readyEventId: string | null;
    tipCents: number;
    startSearch: boolean;
  },
): Promise<string> {
  const rows = await db(ctx).$queryRaw<{ id: string }[]>`
    INSERT INTO deliveries (id, order_id, status, pool, ready_at, ready_event_id, tip_cents,
                            search_started_at, version, created_at, updated_at)
    VALUES (gen_random_uuid(), ${values.orderId}::uuid, 'SEARCHING', ${values.pool},
            ${values.readyAt}, ${values.readyEventId}::uuid, ${values.tipCents},
            CASE WHEN ${values.startSearch} THEN app_now() END, 0, app_now(), app_now())
    RETURNING id::text`;
  const id = rows[0]?.id;
  if (!id) throw new Error('delivery insert returned nothing');
  return id;
}

/** A new run for this order (W1.3): the same row, its offers history kept. */
export async function startSearch(
  ctx: DbContext,
  id: string,
  values: {
    readyAt: Date | null;
    readyEventId: string;
    pool: DeliveryPool;
    tipCents: number;
    restart: boolean;
  },
) {
  await db(ctx).$executeRaw`
    UPDATE deliveries
    SET status = 'SEARCHING', partner_id = NULL, ready_at = coalesce(${values.readyAt}, ready_at),
        ready_event_id = ${values.readyEventId}::uuid, pool = ${values.pool},
        tip_cents = ${values.tipCents}, search_started_at = app_now(),
        search_restarted_at = CASE WHEN ${values.restart} THEN app_now() ELSE NULL END,
        escalated_at = NULL, search_stopped_at = NULL, search_stop_reason = NULL,
        version = version + 1, updated_at = app_now()
    WHERE id = ${id}::uuid`;
}

export async function markEscalated(ctx: DbContext, id: string) {
  await db(ctx).$executeRaw`
    UPDATE deliveries SET escalated_at = app_now(), version = version + 1, updated_at = app_now()
    WHERE id = ${id}::uuid AND escalated_at IS NULL`;
}

export async function markStopped(ctx: DbContext, id: string, reason: SearchStopReason) {
  await db(ctx).$executeRaw`
    UPDATE deliveries
    SET search_stopped_at = app_now(), search_stop_reason = ${reason}, version = version + 1,
        updated_at = app_now()
    WHERE id = ${id}::uuid AND search_stopped_at IS NULL`;
}

export async function bumpVersion(ctx: DbContext, id: string): Promise<number> {
  const rows = await db(ctx).$queryRaw<{ version: number }[]>`
    UPDATE deliveries SET version = version + 1, updated_at = app_now()
    WHERE id = ${id}::uuid RETURNING version`;
  return rows[0]?.version ?? 0;
}

/** The database's clock (W14.2); the app never decides a cut-off with its own. */
export async function databaseNow(ctx: DbContext): Promise<Date> {
  const rows = await db(ctx).$queryRaw<{ now: Date }[]>`SELECT app_now() AS "now"`;
  return rows[0]?.now ?? new Date();
}

// ------------------------------------------------------------------ offers

export interface OfferRowData {
  id: string;
  deliveryId: string;
  partnerId: string;
  status: OfferStatus;
  kind: OfferKind;
  offeredBy: string | null;
  round: number;
  reachKm: number | null;
  pickupM: number;
  payCents: number;
  tipCents: number;
  expiresAt: Date;
  seenAt: Date | null;
  pressedAt: Date | null;
  respondedAt: Date | null;
  endedReason: OfferEnding | null;
  createdAt: Date;
}

const OFFER_COLUMNS = {
  id: true,
  deliveryId: true,
  partnerId: true,
  status: true,
  kind: true,
  offeredBy: true,
  round: true,
  reachKm: true,
  pickupM: true,
  payCents: true,
  tipCents: true,
  expiresAt: true,
  seenAt: true,
  pressedAt: true,
  respondedAt: true,
  endedReason: true,
  createdAt: true,
} as const;

const asOffer = (
  row: Omit<OfferRowData, 'kind' | 'endedReason'> & {
    kind: string;
    endedReason: string | null;
  },
): OfferRowData => ({
  ...row,
  kind: row.kind === 'staff' ? 'staff' : 'auto',
  endedReason: OFFER_ENDINGS.find((ending) => ending === row.endedReason) ?? null,
});

export async function findOffer(ctx: DbContext, id: string): Promise<OfferRowData | null> {
  const row = await db(ctx).deliveryOffer.findUnique({ where: { id }, select: OFFER_COLUMNS });
  return row ? asOffer(row) : null;
}

export async function findOpenOfferOfDelivery(ctx: DbContext, deliveryId: string) {
  const row = await db(ctx).deliveryOffer.findFirst({
    where: { deliveryId, status: 'PENDING' },
    select: OFFER_COLUMNS,
  });
  return row ? asOffer(row) : null;
}

export async function findOpenOfferOfPartner(ctx: DbContext, partnerId: string) {
  const row = await db(ctx).deliveryOffer.findFirst({
    where: { partnerId, status: 'PENDING' },
    select: OFFER_COLUMNS,
  });
  return row ? asOffer(row) : null;
}

export async function listOffersOfDelivery(ctx: DbContext, deliveryId: string) {
  const rows = await db(ctx).deliveryOffer.findMany({
    where: { deliveryId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: OFFER_COLUMNS,
  });
  return rows.map(asOffer);
}

/** W4.3: automatic offers this search has made in each reach (by km). */
export async function countAutoOffersByReach(ctx: DbContext, deliveryId: string, since: Date) {
  return db(ctx).$queryRaw<{ reachKm: number; count: number }[]>`
    SELECT reach_km AS "reachKm", count(*)::int AS "count"
    FROM delivery_offers
    WHERE delivery_id = ${deliveryId}::uuid AND kind = 'auto' AND created_at >= ${since}
      AND reach_km IS NOT NULL
    GROUP BY reach_km`;
}

export async function insertOffer(
  ctx: DbContext,
  values: {
    deliveryId: string;
    partnerId: string;
    kind: OfferKind;
    offeredBy: string | null;
    round: number;
    reachKm: number | null;
    pickupM: number;
    payCents: number;
    tipCents: number;
    seconds: number;
  },
): Promise<{ id: string; expiresAt: Date }> {
  const rows = await db(ctx).$queryRaw<{ id: string; expiresAt: Date }[]>`
    INSERT INTO delivery_offers (id, delivery_id, partner_id, status, kind, offered_by, round,
                                 reach_km, pickup_m, pay_cents, tip_cents, expires_at, created_at)
    VALUES (gen_random_uuid(), ${values.deliveryId}::uuid, ${values.partnerId}::uuid, 'PENDING',
            ${values.kind}, ${values.offeredBy}::uuid, ${values.round}, ${values.reachKm},
            ${values.pickupM}, ${values.payCents}, ${values.tipCents},
            app_now() + make_interval(secs => ${values.seconds}), app_now())
    RETURNING id::text AS "id", expires_at AS "expiresAt"`;
  const row = rows[0];
  if (!row) throw new Error('offer insert returned nothing');
  return row;
}

export async function countOffers(ctx: DbContext, deliveryId: string): Promise<number> {
  return db(ctx).deliveryOffer.count({ where: { deliveryId } });
}

export interface EndedOffer {
  id: string;
  deliveryId: string;
  partnerId: string;
  kind: OfferKind;
  seen: boolean;
  pressed: boolean;
  ending: OfferEnding;
}

/**
 * Closes an offer whose time is up (W4.2): only if still open and only once the database's
 * clock has passed the end plus the grace. Null when it was answered, withdrawn or isn't due.
 */
export async function expireOffer(
  ctx: DbContext,
  offerId: string,
  graceSeconds: number,
): Promise<EndedOffer | null> {
  await db(ctx).$queryRaw`
    SELECT d.id FROM deliveries d JOIN delivery_offers o ON o.delivery_id = d.id
    WHERE o.id = ${offerId}::uuid FOR UPDATE OF d`;
  const rows = await db(ctx).$queryRaw<
    {
      id: string;
      deliveryId: string;
      partnerId: string;
      kind: string;
      seen: boolean;
      pressed: boolean;
      ending: string;
    }[]
  >`
    UPDATE delivery_offers
    SET status = 'EXPIRED',
        ended_reason = CASE WHEN responded_at IS NOT NULL THEN 'too-late' ELSE 'expired' END
    WHERE id = ${offerId}::uuid AND status = 'PENDING'
      AND app_now() >= expires_at + make_interval(secs => ${graceSeconds})
    RETURNING id::text AS "id", delivery_id::text AS "deliveryId", partner_id::text AS "partnerId",
              kind, seen_at IS NOT NULL AS "seen",
              pressed_at IS NOT NULL AND pressed_at < expires_at AS "pressed",
              ended_reason AS "ending"`;
  const row = rows[0];
  if (!row) return null;
  return {
    ...row,
    kind: row.kind === 'staff' ? 'staff' : 'auto',
    ending: row.ending === 'too-late' ? 'too-late' : 'expired',
  };
}

/** Withdraws open offers of a partner or an order (W7.1, W8.1, A37.3), returning them. */
export async function withdrawOffers(
  ctx: DbContext,
  where: { partnerId: string } | { deliveryId: string },
  ending: Extract<OfferEnding, 'withdrawn-offline' | 'withdrawn-order' | 'withdrawn-staff'>,
): Promise<EndedOffer[]> {
  const partnerId = 'partnerId' in where ? where.partnerId : null;
  const deliveryId = 'deliveryId' in where ? where.deliveryId : null;
  // The delivery rows first, the same lock order as every other writer.
  await db(ctx).$queryRaw`
    SELECT d.id FROM deliveries d JOIN delivery_offers o ON o.delivery_id = d.id
    WHERE o.status = 'PENDING'
      AND (o.partner_id = ${partnerId}::uuid OR o.delivery_id = ${deliveryId}::uuid)
    FOR UPDATE OF d`;
  const rows = await db(ctx).$queryRaw<
    { id: string; deliveryId: string; partnerId: string; kind: string; seen: boolean }[]
  >`
    UPDATE delivery_offers
    SET status = 'WITHDRAWN', ended_reason = ${ending}, responded_at = app_now()
    WHERE status = 'PENDING'
      AND (partner_id = ${partnerId}::uuid OR delivery_id = ${deliveryId}::uuid)
    RETURNING id::text AS "id", delivery_id::text AS "deliveryId", partner_id::text AS "partnerId",
              kind, seen_at IS NOT NULL AS "seen"`;
  for (const row of rows) await bumpVersion(ctx, row.deliveryId);
  return rows.map((row): EndedOffer => ({
    id: row.id,
    deliveryId: row.deliveryId,
    partnerId: row.partnerId,
    kind: row.kind === 'staff' ? 'staff' : 'auto',
    seen: row.seen,
    pressed: false,
    ending,
  }));
}

// ------------------------------------------------------------------ partner answers (definer functions)

/** The definer functions answer with a JSON outcome the service parses. */
async function outcomeOf(query: Promise<{ result: unknown }[]>): Promise<unknown> {
  const rows = await query;
  return rows[0]?.result ?? { outcome: 'not-found' };
}

export const acceptOffer = (ctx: DbContext, offerId: string, graceSeconds: number) =>
  outcomeOf(db(ctx).$queryRaw<{ result: unknown }[]>`
    SELECT app_accept_offer(${offerId}::uuid, ${graceSeconds}::int) AS "result"`);

export const declineOffer = (
  ctx: DbContext,
  offerId: string,
  pressedAt: Date | null,
  graceSeconds: number,
) =>
  outcomeOf(db(ctx).$queryRaw<{ result: unknown }[]>`
    SELECT app_decline_offer(${offerId}::uuid, ${pressedAt}::timestamp(3), ${graceSeconds}::int) AS "result"`);

export const markOfferSeen = (ctx: DbContext, offerId: string) =>
  outcomeOf(db(ctx).$queryRaw<{ result: unknown }[]>`
    SELECT app_offer_seen(${offerId}::uuid) AS "result"`);

export const recordLateAccept = (ctx: DbContext, offerId: string, pressedAt: Date) =>
  outcomeOf(db(ctx).$queryRaw<{ result: unknown }[]>`
    SELECT app_offer_late_accept(${offerId}::uuid, ${pressedAt}::timestamp(3)) AS "result"`);

export const giveBack = (ctx: DbContext, deliveryId: string, reason: string) =>
  outcomeOf(db(ctx).$queryRaw<{ result: unknown }[]>`
    SELECT app_give_back(${deliveryId}::uuid, ${reason}) AS "result"`);

// ------------------------------------------------------------------ the search (B3)

export interface CandidateRow {
  partnerId: string;
  distanceM: number;
  waitingSince: Date;
}

/**
 * W2.1's ten rules in one query, ranked by W3.2 (longest wait, then distance, then id). The
 * reach never passes the delivery radius. `secondChance` lets a partner whose one automatic offer
 * for this order timed out be asked once more, and never a third time (W5.4).
 */
export function searchCandidates(
  ctx: DbContext,
  q: {
    deliveryId: string;
    pool: DeliveryPool;
    reachM: number;
    excluded: readonly string[];
    secondChance: boolean;
    freshSeconds: number;
    limit: number;
  },
): Promise<CandidateRow[]> {
  return db(ctx).$queryRaw<CandidateRow[]>`
    SELECT p.id::text AS "partnerId",
           round(ST_Distance(p.last_location, ST_SetSRID(ST_MakePoint(k.lng, k.lat), 4326)::geography))::int AS "distanceM",
           coalesce(p.waiting_since, p.online_since) AS "waitingSince"
    FROM delivery_partners p
    JOIN users u ON u.id = p.user_id
    CROSS JOIN site_settings k
    WHERE k.id = 1
      AND p.status = 'APPROVED' AND NOT coalesce(u.banned, false)
      AND p.is_online AND (u.is_demo OR p.online_session_id IS NOT NULL)
      AND (u.is_demo OR p.last_point_at > app_now() - make_interval(secs => ${q.freshSeconds}))
      AND p.last_location IS NOT NULL
      AND ST_DWithin(p.last_location, ST_SetSRID(ST_MakePoint(k.lng, k.lat), 4326)::geography,
                     least(${q.reachM}::float8, k.delivery_radius_km * 1000))
      AND NOT EXISTS (SELECT 1 FROM deliveries a WHERE a.partner_id = p.id
                      AND a.status IN ('ASSIGNED', 'AT_RESTAURANT', 'PICKED_UP'))
      AND NOT EXISTS (SELECT 1 FROM delivery_offers f WHERE f.partner_id = p.id AND f.status = 'PENDING')
      AND NOT (p.id = ANY (${[...q.excluded]}::uuid[]))
      AND (SELECT CASE count(*) WHEN 0 THEN true
                               WHEN 1 THEN ${q.secondChance} AND bool_and(f.ended_reason = 'expired')
                               ELSE false END
           FROM delivery_offers f WHERE f.delivery_id = ${q.deliveryId}::uuid
             AND f.partner_id = p.id AND f.kind = 'auto')
      AND u.is_demo = (${q.pool} = 'DEMO')
      AND p.unseen_in_row < 2
    ORDER BY coalesce(p.waiting_since, p.online_since), "distanceM", p.id
    LIMIT ${q.limit}`;
}

/** Anyone of the pool online at all (W5.2's "No couriers online"). */
export async function countOnline(ctx: DbContext, pool: DeliveryPool): Promise<number> {
  const rows = await db(ctx).$queryRaw<{ count: number }[]>`
    SELECT count(*)::int AS "count"
    FROM delivery_partners p JOIN users u ON u.id = p.user_id
    WHERE p.is_online AND p.status = 'APPROVED' AND NOT coalesce(u.banned, false)
      AND u.is_demo = (${pool} = 'DEMO')`;
  return rows[0]?.count ?? 0;
}

/** Other searching orders ready before this one, with no open offer and not stopped (W9). */
export function listOlderSearching(ctx: DbContext, deliveryId: string, readyAt: Date) {
  return db(ctx).$queryRaw<
    {
      id: string;
      pool: string;
      excludedPartnerIds: string[];
      searchStartedAt: Date | null;
      escalatedAt: Date | null;
    }[]
  >`
    SELECT d.id::text AS "id", d.pool, d.excluded_partner_ids::text[] AS "excludedPartnerIds",
           d.search_started_at AS "searchStartedAt", d.escalated_at AS "escalatedAt"
    FROM deliveries d
    WHERE d.status = 'SEARCHING' AND d.id <> ${deliveryId}::uuid AND d.search_stopped_at IS NULL
      AND d.search_started_at IS NOT NULL AND d.ready_at < ${readyAt}
      AND NOT EXISTS (SELECT 1 FROM delivery_offers f WHERE f.delivery_id = d.id AND f.status = 'PENDING')
    ORDER BY d.ready_at, d.id`;
}

// ------------------------------------------------------------------ deliveries changing hands

export async function releaseDelivery(
  ctx: DbContext,
  id: string,
  change: {
    status: 'SEARCHING' | 'CANCELLED';
    excludePartnerId: string | null;
    courierChanged: boolean;
  },
): Promise<number> {
  const rows = await db(ctx).$queryRaw<{ version: number }[]>`
    UPDATE deliveries
    SET status = ${change.status}::"DeliveryStatus", partner_id = NULL, assigned_at = NULL,
        excluded_partner_ids = CASE
          WHEN ${change.excludePartnerId}::uuid IS NULL OR ${change.excludePartnerId}::uuid = ANY (excluded_partner_ids)
            THEN excluded_partner_ids
          ELSE array_append(excluded_partner_ids, ${change.excludePartnerId}::uuid)
        END,
        courier_changed = courier_changed OR ${change.courierChanged},
        version = version + 1, updated_at = app_now()
    WHERE id = ${id}::uuid
    RETURNING version`;
  return rows[0]?.version ?? 0;
}

export async function setDeliveryStatus(
  ctx: DbContext,
  id: string,
  status: Extract<DeliveryStatus, 'ASSIGNED' | 'PICKED_UP' | 'DELIVERED'>,
): Promise<number> {
  const rows = await db(ctx).$queryRaw<{ version: number }[]>`
    UPDATE deliveries
    SET status = ${status}::"DeliveryStatus",
        picked_up_at = CASE WHEN ${status} = 'PICKED_UP' THEN app_now()
                            WHEN ${status} = 'ASSIGNED' THEN NULL ELSE picked_up_at END,
        delivered_at = CASE WHEN ${status} = 'DELIVERED' THEN app_now() ELSE delivered_at END,
        version = version + 1, updated_at = app_now()
    WHERE id = ${id}::uuid
    RETURNING version`;
  return rows[0]?.version ?? 0;
}

/** Staff take an order off its courier (A38), under the guard trigger. */
export async function takeOff(ctx: DbContext, id: string, partnerId: string): Promise<number> {
  const rows = await db(ctx).$queryRaw<{ version: number }[]>`
    UPDATE deliveries
    SET status = 'SEARCHING', partner_id = NULL, assigned_at = NULL,
        excluded_partner_ids = CASE WHEN ${partnerId}::uuid = ANY (excluded_partner_ids)
          THEN excluded_partner_ids ELSE array_append(excluded_partner_ids, ${partnerId}::uuid) END,
        courier_changed = true, version = version + 1, updated_at = app_now()
    WHERE id = ${id}::uuid
    RETURNING version`;
  return rows[0]?.version ?? 0;
}

/** Staff "Find a courier" on a stopped or ended search (A39.4), under the guard trigger. */
export async function clearStop(ctx: DbContext, id: string): Promise<number> {
  const rows = await db(ctx).$queryRaw<{ version: number }[]>`
    UPDATE deliveries
    SET status = 'SEARCHING', search_stopped_at = NULL, search_stop_reason = NULL,
        version = version + 1, updated_at = app_now()
    WHERE id = ${id}::uuid
    RETURNING version`;
  return rows[0]?.version ?? 0;
}

// ------------------------------------------------------------------ partner bookkeeping

export interface PartnerDispatchRow {
  id: string;
  userId: string;
  status: PartnerStatus;
  isOnline: boolean;
  isDemo: boolean;
  isSample: boolean;
  banned: boolean;
  name: string;
  vehicleType: VehicleType;
  vehiclePlate: string | null;
  missedInRow: number;
  unseenInRow: number;
  lastPointAt: Date | null;
  waitingSince: Date | null;
  releasedKind: string | null;
  releasedOrderNumber: string | null;
  releasedAt: Date | null;
  /** Straight line from the last point to the kitchen; null without one. */
  distanceM: number | null;
}

export async function findPartnerForDispatch(
  ctx: DbContext,
  partnerId: string,
  lock = false,
): Promise<PartnerDispatchRow | null> {
  if (lock) {
    await db(ctx)
      .$queryRaw`SELECT id FROM delivery_partners WHERE id = ${partnerId}::uuid FOR UPDATE`;
  }
  const rows = await db(ctx).$queryRaw<PartnerDispatchRow[]>`
    SELECT p.id::text AS "id", p.user_id::text AS "userId", p.status, p.is_online AS "isOnline",
           u.is_demo AS "isDemo", u.is_sample AS "isSample", coalesce(u.banned, false) AS "banned",
           u.name, p.vehicle_type AS "vehicleType", p.vehicle_plate AS "vehiclePlate",
           p.missed_in_row AS "missedInRow", p.unseen_in_row AS "unseenInRow",
           p.last_point_at AS "lastPointAt", p.waiting_since AS "waitingSince",
           p.released_kind AS "releasedKind", p.released_order_number AS "releasedOrderNumber",
           p.released_at AS "releasedAt",
           CASE WHEN p.last_location IS NULL THEN NULL ELSE
             round(ST_Distance(p.last_location, ST_SetSRID(ST_MakePoint(k.lng, k.lat), 4326)::geography))::int
           END AS "distanceM"
    FROM delivery_partners p
    JOIN users u ON u.id = p.user_id
    CROSS JOIN site_settings k
    WHERE p.id = ${partnerId}::uuid AND k.id = 1`;
  return rows[0] ?? null;
}

export async function findPartnerIdOfUser(ctx: DbContext, userId: string): Promise<string | null> {
  const row = await db(ctx).deliveryPartner.findUnique({ where: { userId }, select: { id: true } });
  return row?.id ?? null;
}

export async function writeCounters(
  ctx: DbContext,
  partnerId: string,
  counters: { missedInRow: number; unseenInRow: number },
) {
  await db(ctx).$executeRaw`
    UPDATE delivery_partners
    SET missed_in_row = ${counters.missedInRow}, unseen_in_row = ${counters.unseenInRow}
    WHERE id = ${partnerId}::uuid`;
}

/** An offers fetch proves the app is alive (W7.4). */
export async function clearUnseen(ctx: DbContext, partnerId: string) {
  await db(ctx).$executeRaw`
    UPDATE delivery_partners SET unseen_in_row = 0 WHERE id = ${partnerId}::uuid AND unseen_in_row > 0`;
}

/** W3.3: the back of the line, or the place held before accepting (a cancellation). */
export async function setWaitingSince(ctx: DbContext, partnerId: string, at: Date | null) {
  await db(ctx).$executeRaw`
    UPDATE delivery_partners SET waiting_since = coalesce(${at}, app_now())
    WHERE id = ${partnerId}::uuid`;
}

export async function setReleased(
  ctx: DbContext,
  partnerId: string,
  kind: 'takenOff' | 'cancelled' | 'handedOver',
  orderNumber: string,
) {
  await db(ctx).$executeRaw`
    UPDATE delivery_partners
    SET released_kind = ${kind}, released_order_number = ${orderNumber}, released_at = app_now()
    WHERE id = ${partnerId}::uuid`;
}

export interface ActiveDeliveryRow {
  deliveryId: string;
  orderId: string;
  orderNumber: string;
  status: DeliveryStatus;
  version: number;
}

export async function findActiveDeliveryOfPartner(
  ctx: DbContext,
  partnerId: string,
): Promise<ActiveDeliveryRow | null> {
  const rows = await db(ctx).$queryRaw<ActiveDeliveryRow[]>`
    SELECT d.id::text AS "deliveryId", d.order_id::text AS "orderId", o.number AS "orderNumber",
           d.status, d.version
    FROM deliveries d JOIN orders o ON o.id = d.order_id
    WHERE d.partner_id = ${partnerId}::uuid AND d.status = ANY (${ACTIVE}::"DeliveryStatus"[])
    LIMIT 1`;
  return rows[0] ?? null;
}

/** S2: late accepts a partner sent since a time, for the alert on repeated ones. */
export async function countLateAccepts(ctx: DbContext, partnerId: string, since: Date) {
  const rows = await db(ctx).$queryRaw<{ count: number }[]>`
    SELECT count(*)::int AS "count" FROM delivery_offers
    WHERE partner_id = ${partnerId}::uuid AND pressed_at IS NOT NULL AND created_at >= ${since}
      AND status IN ('PENDING', 'EXPIRED')`;
  return rows[0]?.count ?? 0;
}

/** W13.2: give-backs by one partner since a time. */
export async function countGiveBacks(ctx: DbContext, partnerId: string, since: Date) {
  const rows = await db(ctx).$queryRaw<{ count: number }[]>`
    SELECT count(*)::int AS "count" FROM order_events
    WHERE type = 'courier-gave-back' AND created_at >= ${since}
      AND data ->> 'partnerId' = ${partnerId}`;
  return rows[0]?.count ?? 0;
}

// ------------------------------------------------------------------ reads for staff and the customer

export interface CourierFactsRow {
  partnerId: string;
  name: string;
  /** For the demo admin's masking (A36.5): sample and demo people are shown in full. */
  shownToDemo: boolean;
  phone: string | null;
  vehicleType: VehicleType;
  vehiclePlate: string | null;
  photoKey: string | null;
  ratingAvg: number;
  ratingCount: number;
  lastPointAt: Date | null;
  distanceM: number | null;
}

/** The partners named by deliveries and offers on a page of cards, in one read. */
export async function listCourierFacts(
  ctx: DbContext,
  partnerIds: readonly string[],
): Promise<CourierFactsRow[]> {
  if (partnerIds.length === 0) return [];
  return db(ctx).$queryRaw<CourierFactsRow[]>`
    SELECT p.id::text AS "partnerId", u.name, (u.is_demo OR u.is_sample) AS "shownToDemo",
           u.phone, p.vehicle_type AS "vehicleType", p.vehicle_plate AS "vehiclePlate",
           ph.key AS "photoKey", p.rating_avg AS "ratingAvg", p.rating_count AS "ratingCount",
           p.last_point_at AS "lastPointAt",
           CASE WHEN p.last_location IS NULL THEN NULL ELSE
             round(ST_Distance(p.last_location, ST_SetSRID(ST_MakePoint(k.lng, k.lat), 4326)::geography))::int
           END AS "distanceM"
    FROM delivery_partners p
    JOIN users u ON u.id = p.user_id
    LEFT JOIN uploads ph ON ph.id = p.photo_upload_id AND ph.status = 'READY'
    CROSS JOIN site_settings k
    WHERE p.id = ANY (${[...partnerIds]}::uuid[]) AND k.id = 1`;
}

export function listOpenOffersOf(ctx: DbContext, deliveryIds: readonly string[]) {
  if (deliveryIds.length === 0) return Promise.resolve([] as OfferRowData[]);
  return db(ctx)
    .deliveryOffer.findMany({
      where: { deliveryId: { in: [...deliveryIds] }, status: 'PENDING' },
      select: OFFER_COLUMNS,
    })
    .then((rows) => rows.map(asOffer));
}

export async function listStaffNames(ctx: DbContext, userIds: readonly string[]) {
  if (userIds.length === 0) return [];
  return db(ctx).$queryRaw<{ id: string; name: string; role: string; shownToDemo: boolean }[]>`
    SELECT id::text AS "id", name, role, (is_demo OR is_sample) AS "shownToDemo"
    FROM users WHERE id = ANY (${[...userIds]}::uuid[])`;
}

export interface AssignRow {
  partnerId: string;
  name: string;
  shownToDemo: boolean;
  vehicleType: VehicleType;
  lastPointAt: Date | null;
  waitingSince: Date | null;
  distanceM: number | null;
  busyOrderNumber: string | null;
  hasOpenOffer: boolean;
  isDemo: boolean;
}

/** Online partners for the assign dialog (A37.2), in dispatch order. */
export function listOnlineForAssign(ctx: DbContext, pool: DeliveryPool): Promise<AssignRow[]> {
  return db(ctx).$queryRaw<AssignRow[]>`
    SELECT p.id::text AS "partnerId", u.name, (u.is_demo OR u.is_sample) AS "shownToDemo",
           p.vehicle_type AS "vehicleType", p.last_point_at AS "lastPointAt",
           coalesce(p.waiting_since, p.online_since) AS "waitingSince", u.is_demo AS "isDemo",
           CASE WHEN p.last_location IS NULL THEN NULL ELSE
             round(ST_Distance(p.last_location, ST_SetSRID(ST_MakePoint(k.lng, k.lat), 4326)::geography))::int
           END AS "distanceM",
           (SELECT o.number FROM deliveries a JOIN orders o ON o.id = a.order_id
             WHERE a.partner_id = p.id AND a.status IN ('ASSIGNED', 'AT_RESTAURANT', 'PICKED_UP') LIMIT 1) AS "busyOrderNumber",
           EXISTS (SELECT 1 FROM delivery_offers f WHERE f.partner_id = p.id AND f.status = 'PENDING') AS "hasOpenOffer"
    FROM delivery_partners p
    JOIN users u ON u.id = p.user_id
    CROSS JOIN site_settings k
    WHERE k.id = 1 AND p.is_online AND p.status = 'APPROVED' AND NOT coalesce(u.banned, false)
      AND u.is_demo = (${pool} = 'DEMO')
    ORDER BY coalesce(p.waiting_since, p.online_since), "distanceM" NULLS LAST, p.id`;
}

export async function countApprovedOffline(ctx: DbContext, pool: DeliveryPool): Promise<number> {
  const rows = await db(ctx).$queryRaw<{ count: number }[]>`
    SELECT count(*)::int AS "count"
    FROM delivery_partners p JOIN users u ON u.id = p.user_id
    WHERE NOT p.is_online AND p.status = 'APPROVED' AND NOT coalesce(u.banned, false)
      AND u.is_demo = (${pool} = 'DEMO')`;
  return rows[0]?.count ?? 0;
}

/** A35.1: real couriers online and free (no names). */
export async function countCouriers(ctx: DbContext): Promise<{ online: number; free: number }> {
  const rows = await db(ctx).$queryRaw<{ online: number; free: number }[]>`
    SELECT count(*)::int AS "online",
           count(*) FILTER (WHERE NOT EXISTS (
             SELECT 1 FROM deliveries a WHERE a.partner_id = p.id
               AND a.status IN ('ASSIGNED', 'AT_RESTAURANT', 'PICKED_UP')))::int AS "free"
    FROM delivery_partners p JOIN users u ON u.id = p.user_id
    WHERE p.is_online AND p.status = 'APPROVED' AND NOT coalesce(u.banned, false) AND NOT u.is_demo`;
  return rows[0] ?? { online: 0, free: 0 };
}

export interface CourierEventRow {
  type: string;
  actorId: string | null;
  data: unknown;
  createdAt: Date;
}

/** The newest courier step on an order, for DELIVERY_CHANGED's sentence (A42). */
export async function findLastCourierEvent(ctx: DbContext, orderId: string) {
  const row = await db(ctx).orderEvent.findFirst({
    where: { orderId, type: { startsWith: 'courier-' } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { type: true, actorId: true, data: true, createdAt: true },
  });
  return row as CourierEventRow | null;
}

export async function insertOrderEvent(
  ctx: DbContext,
  event: { orderId: string; type: string; actorId: string | null; data: Record<string, unknown> },
) {
  await db(ctx).$executeRaw`
    INSERT INTO order_events (id, order_id, type, actor_id, data, created_at)
    VALUES (gen_random_uuid(), ${event.orderId}::uuid, ${event.type}, ${event.actorId}::uuid,
            ${JSON.stringify(event.data)}::jsonb, app_now())`;
}

export async function findStaffName(ctx: DbContext, userId: string): Promise<string | null> {
  const row = await db(ctx).user.findUnique({ where: { id: userId }, select: { name: true } });
  return row?.name ?? null;
}

export async function findKitchen(ctx: DbContext) {
  return db(ctx).siteSettings.findUnique({
    where: { id: 1 },
    select: {
      storeName: true,
      addressText: true,
      lat: true,
      lng: true,
      contactPhone: true,
      deliveryRadiusKm: true,
    },
  });
}

/** The order's customer, for the courier photo (B11): only their own order. */
export async function findOwnOrderId(ctx: DbContext, orderId: string, userId: string) {
  const row = await db(ctx).order.findFirst({
    where: { id: orderId, userId },
    select: { id: true, status: true, readyAt: true },
  });
  return row;
}
