import 'server-only';
import { db } from '@/server/db/client';
import type { DbContext } from '@/server/db/context';
import type { DeliveryStatus, VehicleType } from '@/server/db/enums';

/*
 * Tracking storage (F8). Partners act through the definer functions as themselves; staff steps
 * go through their own definer functions (the caller audits in the same transaction); the
 * location pipeline, the estimate loop, retention and the demo run act as the platform.
 */

/** The definer functions answer with JSON the service parses. */
async function outcomeOf(query: Promise<{ result: unknown }[]>): Promise<unknown> {
  const rows = await query;
  return rows[0]?.result ?? { outcome: 'not-found' };
}

export const pickUp = (
  ctx: DbContext,
  id: string,
  codeEnc: string,
  codeHash: string,
  far: boolean,
) =>
  outcomeOf(db(ctx).$queryRaw<{ result: unknown }[]>`
    SELECT app_pick_up(${id}::uuid, ${codeEnc}, ${codeHash}, ${far}) AS "result"`);

export const handOver = (
  ctx: DbContext,
  id: string,
  typedHash: string,
  cash: boolean,
  far: boolean,
) =>
  outcomeOf(db(ctx).$queryRaw<{ result: unknown }[]>`
    SELECT app_hand_over(${id}::uuid, ${typedHash}, ${cash}, ${far}) AS "result"`);

export const reportProblem = (ctx: DbContext, id: string, kind: string) =>
  outcomeOf(db(ctx).$queryRaw<{ result: unknown }[]>`
    SELECT app_report_problem(${id}::uuid, ${kind}) AS "result"`);

export const reportNoAnswer = (ctx: DbContext, id: string, waitSeconds: number) =>
  outcomeOf(db(ctx).$queryRaw<{ result: unknown }[]>`
    SELECT app_report_no_answer(${id}::uuid, ${waitSeconds}::int) AS "result"`);

export const staffConfirm = (
  ctx: DbContext,
  q: {
    id: string;
    version: number;
    reason: string;
    cash: boolean;
    waitSeconds: number;
    note: string | null;
  },
) =>
  outcomeOf(db(ctx).$queryRaw<{ result: unknown }[]>`
    SELECT app_staff_confirm_handover(${q.id}::uuid, ${q.version}::int, ${q.reason}, ${q.cash},
                                      ${q.waitSeconds}::int, ${q.note}) AS "result"`);

export const staffCancelUnreachable = (
  ctx: DbContext,
  id: string,
  version: number,
  note: string | null,
) =>
  outcomeOf(db(ctx).$queryRaw<{ result: unknown }[]>`
    SELECT app_staff_cancel_unreachable(${id}::uuid, ${version}::int, ${note}) AS "result"`);

export const staffAskToWait = (ctx: DbContext, id: string, version: number) =>
  outcomeOf(db(ctx).$queryRaw<{ result: unknown }[]>`
    SELECT app_staff_ask_to_wait(${id}::uuid, ${version}::int) AS "result"`);

// ------------------------------------------------------------------ reads

export interface TrackedDelivery {
  deliveryId: string;
  orderId: string;
  orderNumber: string;
  orderStatus: string;
  customerId: string;
  customerIsDemo: boolean;
  status: DeliveryStatus;
  version: number;
  partnerId: string | null;
  partnerUserId: string | null;
  vehicle: VehicleType | null;
  partnerName: string | null;
  partnerFeeCents: number;
  tipCents: number;
  paymentMethod: string;
  paymentStatus: string;
  totalCents: number;
  contactName: string;
  contactPhone: string | null;
  addressText: string;
  addressLine2: string | null;
  addressCity: string | null;
  addressArea: string | null;
  instructions: string | null;
  dropLat: number;
  dropLng: number;
  kitchenLat: number;
  kitchenLng: number;
  routeGeojson: unknown;
  routeDistanceM: number | null;
  routeDurationSec: number | null;
  etaAt: Date | null;
  etaEstimated: boolean;
  arrivalToMinutes: number | null;
  placedAt: Date | null;
  pickedUpAt: Date | null;
  deliveredAt: Date | null;
  assignedAt: Date | null;
  atRestaurantAt: Date | null;
  almostNotifiedAt: Date | null;
  noAnswerSince: Date | null;
  noAnswerReportedAt: Date | null;
  noAnswerWaitRestartedAt: Date | null;
  problemKind: string | null;
  problemAt: Date | null;
  otpWrongTries: number;
  otpLockedAt: Date | null;
  lastPointAt: Date | null;
  lastLat: number | null;
  lastLng: number | null;
}

async function tracked(ctx: DbContext, column: 'id' | 'partner' | 'order', value: string) {
  const rows = await db(ctx).$queryRaw<TrackedDelivery[]>`
    SELECT d.id::text AS "deliveryId", d.order_id::text AS "orderId", o.number AS "orderNumber",
           o.status::text AS "orderStatus", o.user_id::text AS "customerId", cu.is_demo AS "customerIsDemo",
           d.status, d.version, d.partner_id::text AS "partnerId", p.user_id::text AS "partnerUserId",
           p.vehicle_type AS "vehicle", pu.name AS "partnerName", d.partner_fee_cents AS "partnerFeeCents", d.tip_cents AS "tipCents",
           o.payment_method::text AS "paymentMethod", o.payment_status::text AS "paymentStatus",
           o.total_cents AS "totalCents", o.contact_name AS "contactName", o.contact_phone AS "contactPhone",
           o.address_text AS "addressText", o.address_line2 AS "addressLine2", o.address_city AS "addressCity",
           o.address_area AS "addressArea", o.courier_instructions AS "instructions",
           o.address_lat AS "dropLat", o.address_lng AS "dropLng", k.lat AS "kitchenLat", k.lng AS "kitchenLng",
           d.route_geojson AS "routeGeojson", d.route_distance_m AS "routeDistanceM",
           d.route_duration_sec AS "routeDurationSec", d.eta_at AS "etaAt", d.eta_estimated AS "etaEstimated",
           o.arrival_to_minutes AS "arrivalToMinutes", o.placed_at AS "placedAt",
           d.picked_up_at AS "pickedUpAt", d.delivered_at AS "deliveredAt", d.assigned_at AS "assignedAt", d.at_restaurant_at AS "atRestaurantAt",
           d.almost_notified_at AS "almostNotifiedAt", d.no_answer_since AS "noAnswerSince",
           d.no_answer_reported_at AS "noAnswerReportedAt",
           d.no_answer_wait_restarted_at AS "noAnswerWaitRestartedAt", d.problem_kind AS "problemKind",
           d.problem_at AS "problemAt", d.otp_wrong_tries AS "otpWrongTries", d.otp_locked_at AS "otpLockedAt",
           p.last_point_at AS "lastPointAt",
           CASE WHEN p.last_location IS NULL THEN NULL ELSE ST_Y(p.last_location::geometry) END AS "lastLat",
           CASE WHEN p.last_location IS NULL THEN NULL ELSE ST_X(p.last_location::geometry) END AS "lastLng"
    FROM deliveries d
    JOIN orders o ON o.id = d.order_id
    JOIN users cu ON cu.id = o.user_id
    LEFT JOIN delivery_partners p ON p.id = d.partner_id
    LEFT JOIN users pu ON pu.id = p.user_id
    CROSS JOIN site_settings k
    WHERE k.id = 1
      AND CASE ${column}
            WHEN 'id' THEN d.id = ${value}::uuid
            WHEN 'order' THEN d.order_id = ${value}::uuid
            ELSE d.partner_id = ${value}::uuid AND d.status IN ('ASSIGNED', 'AT_RESTAURANT', 'PICKED_UP')
          END
    LIMIT 1`;
  return rows[0] ?? null;
}

export const findTracked = (ctx: DbContext, deliveryId: string) => tracked(ctx, 'id', deliveryId);
export const findTrackedByOrder = (ctx: DbContext, orderId: string) =>
  tracked(ctx, 'order', orderId);
export const findHeldBy = (ctx: DbContext, partnerId: string) => tracked(ctx, 'partner', partnerId);

/** Active deliveries of a pool, for the board's lines and attention and the live map. */
export async function listActive(
  ctx: DbContext,
  pool: 'REAL' | 'DEMO',
): Promise<TrackedDelivery[]> {
  const ids = await db(ctx).$queryRaw<{ id: string }[]>`
    SELECT d.id::text AS "id" FROM deliveries d
    WHERE d.status IN ('ASSIGNED', 'AT_RESTAURANT', 'PICKED_UP') AND d.pool = ${pool}
    ORDER BY d.assigned_at NULLS LAST, d.id`;
  const rows: TrackedDelivery[] = [];
  for (const { id } of ids) {
    const row = await tracked(ctx, 'id', id);
    if (row) rows.push(row);
  }
  return rows;
}

export async function findPartnerOfUser(ctx: DbContext, userId: string) {
  return db(ctx).deliveryPartner.findUnique({
    where: { userId },
    select: { id: true, status: true, isBot: true },
  });
}

export async function storeCode(
  ctx: DbContext,
  deliveryId: string,
  codeEnc: string,
  codeHash: string,
) {
  await db(ctx).deliveryCode.upsert({
    where: { deliveryId },
    create: { deliveryId, codeEnc, codeHash },
    update: { codeEnc, codeHash },
    select: { deliveryId: true },
  });
}

export async function findCodeEnc(ctx: DbContext, deliveryId: string): Promise<string | null> {
  const row = await db(ctx).deliveryCode.findUnique({
    where: { deliveryId },
    select: { codeEnc: true },
  });
  return row?.codeEnc ?? null;
}

export interface MapCourierRow {
  partnerId: string;
  name: string;
  shownToDemo: boolean;
  phone: string | null;
  vehicle: VehicleType;
  plate: string | null;
  lat: number | null;
  lng: number | null;
  lastPointAt: Date | null;
  hasOpenOffer: boolean;
  offeredOrderNumber: string | null;
}

export function listOnlineCouriers(ctx: DbContext, pool: 'REAL' | 'DEMO') {
  return db(ctx).$queryRaw<MapCourierRow[]>`
    SELECT p.id::text AS "partnerId", u.name, (u.is_demo OR u.is_sample) AS "shownToDemo", u.phone,
           p.vehicle_type AS "vehicle", p.vehicle_plate AS "plate",
           CASE WHEN p.last_location IS NULL THEN NULL ELSE ST_Y(p.last_location::geometry) END AS "lat",
           CASE WHEN p.last_location IS NULL THEN NULL ELSE ST_X(p.last_location::geometry) END AS "lng",
           p.last_point_at AS "lastPointAt",
           EXISTS (SELECT 1 FROM delivery_offers f WHERE f.partner_id = p.id AND f.status = 'PENDING') AS "hasOpenOffer",
           (SELECT o.number FROM delivery_offers f JOIN deliveries d ON d.id = f.delivery_id
              JOIN orders o ON o.id = d.order_id
            WHERE f.partner_id = p.id AND f.status = 'PENDING' LIMIT 1) AS "offeredOrderNumber"
    FROM delivery_partners p JOIN users u ON u.id = p.user_id
    WHERE p.is_online AND p.status = 'APPROVED' AND u.is_demo = (${pool} = 'DEMO')
    ORDER BY u.name, p.id`;
}

export function listReadyWithoutCourier(ctx: DbContext, pool: 'REAL' | 'DEMO') {
  return db(ctx).$queryRaw<{ orderId: string; number: string; readyAt: Date }[]>`
    SELECT o.id::text AS "orderId", o.number, o.ready_at AS "readyAt"
    FROM orders o JOIN users u ON u.id = o.user_id
    LEFT JOIN deliveries d ON d.order_id = o.id
    WHERE o.status = 'READY' AND u.is_demo = (${pool} = 'DEMO')
      AND (d.id IS NULL OR d.status NOT IN ('ASSIGNED', 'AT_RESTAURANT', 'PICKED_UP'))
    ORDER BY o.ready_at NULLS LAST, o.id`;
}

// ------------------------------------------------------------------ the platform's writes

export async function insertLocation(
  ctx: DbContext,
  deliveryId: string,
  point: { lat: number; lng: number; heading: number | null; speedKmh: number | null },
) {
  await db(ctx).$executeRaw`
    INSERT INTO delivery_locations (delivery_id, lat, lng, location, heading, speed_kmh, recorded_at)
    VALUES (${deliveryId}::uuid, ${point.lat}, ${point.lng},
            ST_SetSRID(ST_MakePoint(${point.lng}, ${point.lat}), 4326)::geography,
            ${point.heading}, ${point.speedKmh}, app_now())`;
}

export async function lastLocationAt(ctx: DbContext, deliveryId: string): Promise<Date | null> {
  const rows = await db(ctx).$queryRaw<{ at: Date | null }[]>`
    SELECT max(recorded_at) AS "at" FROM delivery_locations WHERE delivery_id = ${deliveryId}::uuid`;
  return rows[0]?.at ?? null;
}

/** ASSIGNED → AT_RESTAURANT by position; true when this call made the change. */
export async function markAtRestaurant(ctx: DbContext, deliveryId: string): Promise<number | null> {
  const rows = await db(ctx).$queryRaw<{ version: number }[]>`
    UPDATE deliveries
    SET status = 'AT_RESTAURANT', at_restaurant_at = app_now(), version = version + 1, updated_at = app_now()
    WHERE id = ${deliveryId}::uuid AND status = 'ASSIGNED'
    RETURNING version`;
  return rows[0]?.version ?? null;
}

export async function markAlmost(ctx: DbContext, deliveryId: string): Promise<boolean> {
  const changed = await db(ctx).$executeRaw`
    UPDATE deliveries SET almost_notified_at = app_now()
    WHERE id = ${deliveryId}::uuid AND status = 'PICKED_UP' AND almost_notified_at IS NULL`;
  return changed > 0;
}

export async function writeRoute(
  ctx: DbContext,
  deliveryId: string,
  route: {
    geojson: unknown;
    distanceM: number;
    durationSec: number;
    etaAt: Date;
    estimated: boolean;
  },
) {
  await db(ctx).$executeRaw`
    UPDATE deliveries
    SET route_geojson = ${route.geojson === null ? null : JSON.stringify(route.geojson)}::jsonb,
        route_distance_m = ${route.distanceM}, route_duration_sec = ${route.durationSec},
        eta_at = ${route.etaAt}, eta_estimated = ${route.estimated}, route_updated_at = app_now()
    WHERE id = ${deliveryId}::uuid`;
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

/** L8.2: rows and stored routes of deliveries that ended before `before`. */
export async function purgeLocations(ctx: DbContext, before: Date) {
  const rows = await db(ctx).$queryRaw<{ result: { rows: number; routes: number } }[]>`
    SELECT app_purge_delivery_locations(${before}::timestamp(3)) AS "result"`;
  return rows[0]?.result ?? { rows: 0, routes: 0 };
}

// ------------------------------------------------------------------ the demo run

export async function findRunningDemo(ctx: DbContext) {
  return db(ctx).demoRun.findFirst({
    where: { status: 'running' },
    select: { id: true, orderId: true, endsAt: true, startedAt: true },
  });
}

export async function listDemoStarts(ctx: DbContext, since: Date) {
  const rows = await db(ctx).demoRun.findMany({
    where: { startedAt: { gte: since } },
    select: { startedAt: true },
  });
  return rows.map((row) => row.startedAt.toISOString());
}

export async function insertDemoRun(
  ctx: DbContext,
  run: { id: string; endsAt: Date; requestedBy: string },
) {
  await db(ctx).demoRun.create({
    data: { id: run.id, endsAt: run.endsAt, requestedBy: run.requestedBy },
    select: { id: true },
  });
}

export async function finishDemoRun(
  ctx: DbContext,
  id: string,
  change: { status: 'done' | 'failed'; orderId?: string },
) {
  await db(ctx).demoRun.update({
    where: { id },
    data: { status: change.status, ...(change.orderId && { orderId: change.orderId }) },
    select: { id: true },
  });
}

export async function setDemoRunOrder(ctx: DbContext, id: string, orderId: string) {
  await db(ctx).demoRun.update({ where: { id }, data: { orderId }, select: { id: true } });
}

export async function findDemoCast(ctx: DbContext) {
  const rows = await db(ctx).$queryRaw<
    { jamieUserId: string; jamiePartnerId: string; danaUserId: string; addressId: string | null }[]
  >`
    SELECT ju.id::text AS "jamieUserId", jp.id::text AS "jamiePartnerId", du.id::text AS "danaUserId",
           (SELECT a.id::text FROM addresses a WHERE a.user_id = du.id ORDER BY a.created_at LIMIT 1) AS "addressId"
    FROM users ju
    JOIN delivery_partners jp ON jp.user_id = ju.id AND jp.is_bot
    CROSS JOIN users du
    WHERE ju.email = 'demo.courier@foodz.example' AND du.email = 'demo.customer@foodz.example'`;
  return rows[0] ?? null;
}

/** P44.3: what staff did to his delivery, for a phone that missed the realtime event. */
export async function setPartnerNotice(
  ctx: DbContext,
  partnerId: string,
  kind: 'confirmed' | 'cancelledBringBack' | 'markedDelivered',
  orderNumber: string,
) {
  await db(ctx).$executeRaw`
    UPDATE delivery_partners
    SET released_kind = ${kind}, released_order_number = ${orderNumber}, released_at = app_now()
    WHERE id = ${partnerId}::uuid`;
}

export async function markOverride(ctx: DbContext, deliveryId: string) {
  await db(ctx).$executeRaw`
    UPDATE deliveries SET handover_how = 'admin-override'
    WHERE id = ${deliveryId}::uuid AND status = 'DELIVERED' AND handover_how IS NULL`;
}

export async function setOrderArea(ctx: DbContext, orderId: string, area: string) {
  await db(ctx).$executeRaw`UPDATE orders SET address_area = ${area} WHERE id = ${orderId}::uuid`;
}

// ------------------------------------------------------------------ small reads

export async function findStorePhone(ctx: DbContext): Promise<string | null> {
  const row = await db(ctx).siteSettings.findUnique({
    where: { id: 1 },
    select: { contactPhone: true },
  });
  return row?.contactPhone ?? null;
}

/** The kitchen's point for the live map (design 3.3). */
export async function findKitchenPoint(
  ctx: DbContext,
): Promise<{ lat: number; lng: number } | null> {
  const row = await db(ctx).siteSettings.findUnique({
    where: { id: 1 },
    select: { lat: true, lng: true },
  });
  return row ? { lat: row.lat, lng: row.lng } : null;
}

/** The caller's own order (run as the customer). */
export async function findOwnOrder(ctx: DbContext, orderId: string, userId: string) {
  return db(ctx).order.findFirst({ where: { id: orderId, userId }, select: { id: true } });
}

/** A paid card order is refunded in full on a cancellation (F5); the amount for the email. */
export async function paidByCard(ctx: DbContext, orderId: string) {
  const row = await db(ctx).order.findUnique({
    where: { id: orderId },
    select: {
      paymentMethod: true,
      paymentStatus: true,
      totalCents: true,
      refundedCents: true,
      stripePaymentIntentId: true,
    },
  });
  // F5's rule: a card payment Stripe still holds money for (a sample card has no PaymentIntent).
  const paidCard =
    row?.paymentMethod === 'CARD' &&
    (row.paymentStatus === 'PAID' || row.paymentStatus === 'PARTIALLY_REFUNDED') &&
    row.stripePaymentIntentId !== null &&
    row.totalCents > row.refundedCents;
  return { paidCard, totalCents: paidCard ? row.totalCents - row.refundedCents : 0 };
}

// ------------------------------------------------------------------ the demo bot (platform only)

export async function createDemoOrder(
  ctx: DbContext,
  userId: string,
  home: { lat: number; lng: number; text: string; line1: string; line2: string; city: string },
) {
  // Two dishes from today's menu, so the demo card and the partner's sheet look real (L10.1).
  const dishes = await db(ctx).menuItem.findMany({
    where: { isAvailable: true },
    orderBy: [{ priceCents: 'asc' }, { id: 'asc' }],
    take: 2,
    select: { id: true, title: true, priceCents: true },
  });
  const subtotalCents = dishes.reduce((sum, dish) => sum + dish.priceCents, 0) || 3200;
  const taxCents = Math.round(subtotalCents * 0.07);
  const order = await db(ctx).order.create({
    data: {
      items: {
        create: dishes.map((dish) => ({
          menuItemId: dish.id,
          title: dish.title,
          unitPriceCents: dish.priceCents,
          quantity: 1,
          flavors: [],
        })),
      },
      userId,
      status: 'READY',
      paymentMethod: 'CARD',
      paymentStatus: 'PAID',
      contactName: 'Dana Demo',
      contactPhone: '+16175550100',
      addressText: home.text,
      addressLine1: home.line1,
      addressLine2: home.line2,
      addressCity: home.city,
      addressArea: 'Fenway',
      addressLat: home.lat,
      addressLng: home.lng,
      distanceKm: 4.3,
      subtotalCents,
      deliveryFeeCents: 399,
      taxCents,
      tipCents: 300,
      totalCents: subtotalCents + 399 + taxCents + 300,
      placedAt: new Date(),
      acceptedAt: new Date(),
      preparingAt: new Date(),
      readyAt: new Date(),
    },
    select: { id: true, number: true },
  });
  const delivery = await db(ctx).delivery.create({
    data: {
      orderId: order.id,
      status: 'SEARCHING',
      pool: 'DEMO',
      readyAt: new Date(),
      searchStartedAt: new Date(),
      tipCents: 300,
    },
    select: { id: true },
  });
  return { orderId: order.id, orderNumber: order.number, deliveryId: delivery.id };
}

export async function offerToBot(
  ctx: DbContext,
  orderId: string,
  partnerId: string,
): Promise<string> {
  const rows = await db(ctx).$queryRaw<{ id: string }[]>`
    INSERT INTO delivery_offers (id, delivery_id, partner_id, status, kind, pay_cents, tip_cents, pickup_m,
                                 expires_at, created_at)
    SELECT gen_random_uuid(), d.id, ${partnerId}::uuid, 'PENDING', 'auto', o.delivery_fee_cents + o.tip_cents,
           o.tip_cents, 0, app_now() + interval '5 minutes', app_now()
    FROM deliveries d JOIN orders o ON o.id = d.order_id
    JOIN delivery_partners p ON p.id = ${partnerId}::uuid AND p.is_bot
    WHERE d.order_id = ${orderId}::uuid AND d.pool = 'DEMO'
    RETURNING id::text`;
  const id = rows[0]?.id;
  if (!id) throw new Error('demo offer was not made');
  return id;
}

export async function botOnline(ctx: DbContext, partnerId: string) {
  await db(ctx).$executeRaw`
    UPDATE delivery_partners p
    SET is_online = true, online_since = app_now(), online_session_id = NULL, offline_reason = NULL,
        offline_at = NULL, last_seen_at = app_now(),
        last_location = ST_SetSRID(ST_MakePoint(k.lng, k.lat), 4326)::geography, updated_at = app_now()
    FROM site_settings k
    WHERE p.id = ${partnerId}::uuid AND p.is_bot AND k.id = 1`;
}

export async function botPoint(
  ctx: DbContext,
  partnerId: string,
  point: { lat: number; lng: number },
) {
  await db(ctx).$executeRaw`
    UPDATE delivery_partners
    SET last_location = ST_SetSRID(ST_MakePoint(${point.lng}, ${point.lat}), 4326)::geography,
        last_seen_at = app_now(), updated_at = app_now()
    WHERE id = ${partnerId}::uuid AND is_bot AND is_online`;
}

export async function botOffline(ctx: DbContext, partnerId: string) {
  await db(ctx).$executeRaw`
    UPDATE delivery_partners
    SET is_online = false, online_since = NULL, online_session_id = NULL, last_location = NULL,
        offline_reason = 'self', offline_at = app_now(), updated_at = app_now()
    WHERE id = ${partnerId}::uuid AND is_bot AND is_online`;
}

/** A run that failed leaves nothing on its way (L10.5). */
export async function cancelDemoDelivery(ctx: DbContext, deliveryId: string) {
  await db(ctx).$executeRaw`
    UPDATE orders o SET status = 'CANCELLED', cancelled_at = app_now(), cancel_reason = 'staff',
           cancel_code = 'other', version = o.version + 1, updated_at = app_now()
    FROM deliveries d
    WHERE d.id = ${deliveryId}::uuid AND o.id = d.order_id AND d.pool = 'DEMO'
      AND o.status NOT IN ('DELIVERED', 'CANCELLED')`;
  await db(ctx).$executeRaw`
    UPDATE deliveries SET status = 'CANCELLED', partner_id = NULL, assigned_at = NULL,
           version = version + 1, updated_at = app_now()
    WHERE id = ${deliveryId}::uuid AND pool = 'DEMO' AND status NOT IN ('DELIVERED', 'CANCELLED')`;
}
