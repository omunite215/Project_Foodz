import 'server-only';
import { db } from '@/server/db/client';
import type { DbContext } from '@/server/db/context';
import { Prisma } from '@/server/db/generated/client';

/*
 * Ratings reads and writes (contract §6, §7). Customers write their own rows under row-level
 * security and the column guard; averages change only through the definer recalculations;
 * partners read nothing here but the aggregate summary function.
 */

// ------------------------------------------------------------------ the customer's order

export interface OrderForRating {
  id: string;
  number: string;
  userId: string;
  status: string;
  deliveredAt: Date | null;
  ratingSkippedAt: Date | null;
}

export async function findOwnOrder(
  ctx: DbContext,
  orderId: string,
  userId: string,
): Promise<OrderForRating | null> {
  return db(ctx).order.findFirst({
    where: { id: orderId, userId },
    select: {
      id: true,
      number: true,
      userId: true,
      status: true,
      deliveredAt: true,
      ratingSkippedAt: true,
    },
  });
}

export interface OrderDish {
  menuItemId: string;
  title: string;
  quantity: number;
  image: string | null;
}

/** Each dish once, whatever the quantity or flavors (S1.1). */
export function orderDishes(ctx: DbContext, orderId: string): Promise<OrderDish[]> {
  return db(ctx).$queryRaw<OrderDish[]>`
    SELECT i.menu_item_id::text AS "menuItemId", min(i.title) AS title, sum(i.quantity)::int AS quantity,
           (SELECT m.images[1] FROM menu_items m WHERE m.id = i.menu_item_id) AS image
    FROM order_items i
    WHERE i.order_id = ${orderId}::uuid
    GROUP BY i.menu_item_id
    ORDER BY min(i.id::text)`;
}

/** Her own account's confirmed email; the shared demo logins count as confirmed (F2). */
export async function emailConfirmed(ctx: DbContext, userId: string): Promise<boolean> {
  const user = await db(ctx).user.findUnique({
    where: { id: userId },
    select: { emailVerified: true, isDemo: true, deletedAt: true },
  });
  return Boolean(user && !user.deletedAt && (user.emailVerified || user.isDemo));
}

export async function rateableCourier(ctx: DbContext, orderId: string): Promise<string | null> {
  const rows = await db(ctx).$queryRaw<{ id: string | null }[]>`
    SELECT app_rateable_courier(${orderId}::uuid)::text AS id`;
  return rows[0]?.id ?? null;
}

/** The courier's first-name source and photo flag, read as the platform for the customer. */
export function courierFacts(ctx: DbContext, partnerId: string) {
  return db(ctx).deliveryPartner.findUnique({
    where: { id: partnerId },
    select: { id: true, photoUploadId: true, user: { select: { name: true } } },
  });
}

export function ownDishRatings(ctx: DbContext, orderId: string) {
  return db(ctx).review.findMany({
    where: { orderId },
    select: { id: true, menuItemId: true, rating: true, tags: true, comment: true, editedAt: true },
  });
}

export function ownCourierRating(ctx: DbContext, orderId: string) {
  return db(ctx).partnerRating.findUnique({
    where: { orderId },
    select: { id: true, partnerId: true, rating: true, tags: true, comment: true, editedAt: true },
  });
}

export interface RatingWrite {
  orderId: string;
  userId: string;
  stars: number;
  tags: string[];
  comment: string | null;
  pool: 'REAL' | 'DEMO';
}

/** Inserts or updates in place; `edited_at` moves only when something changed (V2.1). */
export async function upsertDishRating(
  ctx: DbContext,
  row: RatingWrite & { menuItemId: string },
): Promise<{ id: string; changed: boolean }> {
  const rows = await db(ctx).$queryRaw<{ id: string; changed: boolean }[]>`
    INSERT INTO reviews AS r (id, user_id, menu_item_id, order_id, rating, tags, comment, pool, created_at)
    VALUES (gen_random_uuid(), ${row.userId}::uuid, ${row.menuItemId}::uuid, ${row.orderId}::uuid,
            ${row.stars}::int, ${row.tags}::text[], ${row.comment}, ${row.pool}, app_now())
    ON CONFLICT (order_id, menu_item_id) DO UPDATE SET
      rating = EXCLUDED.rating, tags = EXCLUDED.tags, comment = EXCLUDED.comment,
      edited_at = CASE
        WHEN (r.rating, r.tags, r.comment) IS DISTINCT FROM (EXCLUDED.rating, EXCLUDED.tags, EXCLUDED.comment)
          THEN app_now() ELSE r.edited_at END
    RETURNING r.id::text AS id, (xmax = 0 OR r.edited_at = app_now()) AS changed`;
  const result = rows[0];
  if (!result) throw new Error('rating not saved');
  return result;
}

export async function upsertCourierRating(
  ctx: DbContext,
  row: RatingWrite & { partnerId: string },
): Promise<{ id: string; changed: boolean }> {
  const rows = await db(ctx).$queryRaw<{ id: string; changed: boolean }[]>`
    INSERT INTO partner_ratings AS r (id, user_id, partner_id, order_id, rating, tags, comment, pool, created_at)
    VALUES (gen_random_uuid(), ${row.userId}::uuid, ${row.partnerId}::uuid, ${row.orderId}::uuid,
            ${row.stars}::int, ${row.tags}::text[], ${row.comment}, ${row.pool}, app_now())
    ON CONFLICT (order_id) DO UPDATE SET
      rating = EXCLUDED.rating, tags = EXCLUDED.tags, comment = EXCLUDED.comment,
      edited_at = CASE
        WHEN (r.rating, r.tags, r.comment) IS DISTINCT FROM (EXCLUDED.rating, EXCLUDED.tags, EXCLUDED.comment)
          THEN app_now() ELSE r.edited_at END
    RETURNING r.id::text AS id, (xmax = 0 OR r.edited_at = app_now()) AS changed`;
  const result = rows[0];
  if (!result) throw new Error('rating not saved');
  return result;
}

export async function recalcDish(ctx: DbContext, menuItemId: string) {
  await db(ctx).$executeRaw`SELECT app_recalc_dish_rating(${menuItemId}::uuid)`;
}

export async function recalcPartner(ctx: DbContext, partnerId: string) {
  await db(ctx).$executeRaw`SELECT app_recalc_partner_rating(${partnerId}::uuid)`;
}

export async function skipRating(ctx: DbContext, orderId: string) {
  const rows = await db(ctx).$queryRaw<{ result: { outcome: string; replayed?: boolean } }[]>`
    SELECT app_skip_rating(${orderId}::uuid) AS result`;
  return rows[0]?.result ?? { outcome: 'not-found' };
}

export async function unlinkOwnRatings(ctx: DbContext): Promise<number> {
  const rows = await db(ctx).$queryRaw<
    { count: number }[]
  >`SELECT app_unlink_own_ratings() AS count`;
  return rows[0]?.count ?? 0;
}

/** Which of these orders have any rating (the Orders list's "Rated", S6.1). */
export async function ratedOrderIds(
  ctx: DbContext,
  orderIds: readonly string[],
): Promise<Set<string>> {
  if (orderIds.length === 0) return new Set();
  const rows = await db(ctx).$queryRaw<{ id: string }[]>`
    SELECT DISTINCT order_id::text AS id FROM reviews WHERE order_id = ANY (${[...orderIds]}::uuid[])
    UNION
    SELECT order_id::text FROM partner_ratings WHERE order_id = ANY (${[...orderIds]}::uuid[])`;
  return new Set(rows.map((row) => row.id));
}

// ------------------------------------------------------------------ staff (A58, A65)

export interface StaffRatingRecord {
  kind: 'dish' | 'courier';
  id: string;
  at: Date;
  editedAt: Date | null;
  orderId: string;
  orderNumber: string;
  customerName: string | null;
  customerDeleted: boolean;
  subjectId: string;
  subject: string;
  stars: number;
  tags: string[];
  comment: string | null;
  status: 'PUBLISHED' | 'HIDDEN';
  excludedReason: string | null;
  excludedNote: string | null;
  moderatedBy: string | null;
  moderatedByName: string | null;
  moderatedAt: Date | null;
  pool: 'REAL' | 'DEMO';
}

const dishColumns = Prisma.sql`
  'dish' AS kind, r.id::text, r.created_at AS at, r.edited_at AS "editedAt", o.id::text AS "orderId",
  o.number AS "orderNumber", cu.name AS "customerName", (r.user_id IS NULL OR cu.deleted_at IS NOT NULL) AS "customerDeleted",
  r.menu_item_id::text AS "subjectId", m.title AS subject, r.rating AS stars, r.tags, r.comment,
  r.status::text AS status, r.excluded_reason AS "excludedReason", r.excluded_note AS "excludedNote",
  r.moderated_by::text AS "moderatedBy", mu.name AS "moderatedByName", r.moderated_at AS "moderatedAt", r.pool`;

const courierColumns = Prisma.sql`
  'courier' AS kind, r.id::text, r.created_at AS at, r.edited_at AS "editedAt", o.id::text AS "orderId",
  o.number AS "orderNumber", cu.name AS "customerName", (r.user_id IS NULL OR cu.deleted_at IS NOT NULL) AS "customerDeleted",
  r.partner_id::text AS "subjectId", pd.name AS subject, r.rating AS stars, r.tags, r.comment,
  r.status::text AS status, r.excluded_reason AS "excludedReason", r.excluded_note AS "excludedNote",
  r.moderated_by::text AS "moderatedBy", mu.name AS "moderatedByName", r.moderated_at AS "moderatedAt", r.pool`;

export async function findStaffRating(ctx: DbContext, kind: 'dish' | 'courier', id: string) {
  const rows =
    kind === 'dish'
      ? await db(ctx).$queryRaw<StaffRatingRecord[]>`
          SELECT ${dishColumns}
          FROM reviews r JOIN orders o ON o.id = r.order_id JOIN menu_items m ON m.id = r.menu_item_id
          LEFT JOIN users cu ON cu.id = r.user_id LEFT JOIN users mu ON mu.id = r.moderated_by
          WHERE r.id = ${id}::uuid`
      : await db(ctx).$queryRaw<StaffRatingRecord[]>`
          SELECT ${courierColumns}
          FROM partner_ratings r JOIN orders o ON o.id = r.order_id
          JOIN partner_directory pd ON pd.id = r.partner_id
          LEFT JOIN users cu ON cu.id = r.user_id LEFT JOIN users mu ON mu.id = r.moderated_by
          WHERE r.id = ${id}::uuid`;
  return rows[0] ?? null;
}

/** Moves a rating between counted and excluded, only from the other state (A58.4). */
export async function moderate(
  ctx: DbContext,
  kind: 'dish' | 'courier',
  id: string,
  change: { exclude: boolean; reason: string | null; note: string | null; by: string },
): Promise<boolean> {
  const from = change.exclude ? 'PUBLISHED' : 'HIDDEN';
  const to = change.exclude ? 'HIDDEN' : 'PUBLISHED';
  const count =
    kind === 'dish'
      ? await db(ctx).$executeRaw`
          UPDATE reviews SET status = ${to}::"ReviewStatus", excluded_reason = ${change.reason},
            excluded_note = ${change.note}, moderated_by = ${change.by}::uuid, moderated_at = app_now()
          WHERE id = ${id}::uuid AND status = ${from}::"ReviewStatus"`
      : await db(ctx).$executeRaw`
          UPDATE partner_ratings SET status = ${to}::"ReviewStatus", excluded_reason = ${change.reason},
            excluded_note = ${change.note}, moderated_by = ${change.by}::uuid, moderated_at = app_now()
          WHERE id = ${id}::uuid AND status = ${from}::"ReviewStatus"`;
  return count > 0;
}

export function partnerRatingRows(
  ctx: DbContext,
  partnerId: string,
  cursor: { at: Date; id: string } | null,
  limit: number,
): Promise<StaffRatingRecord[]> {
  return db(ctx).$queryRaw<StaffRatingRecord[]>`
    SELECT ${courierColumns}
    FROM partner_ratings r JOIN orders o ON o.id = r.order_id
    JOIN partner_directory pd ON pd.id = r.partner_id
    LEFT JOIN users cu ON cu.id = r.user_id LEFT JOIN users mu ON mu.id = r.moderated_by
    WHERE r.partner_id = ${partnerId}::uuid
      AND (${cursor?.at ?? null}::timestamp(3) IS NULL
           OR (r.created_at, r.id) < (${cursor?.at ?? null}::timestamp(3), ${cursor?.id ?? null}::uuid))
    ORDER BY r.created_at DESC, r.id DESC
    LIMIT ${limit}`;
}

export async function partnerRatingStats(ctx: DbContext, partnerId: string, tagsSince: Date) {
  const rows = await db(ctx).$queryRaw<
    {
      total: number;
      spread: { stars: number; count: number }[];
      tags: { tag: string; count: number }[];
    }[]
  >`
    SELECT
      (SELECT count(*)::int FROM partner_ratings WHERE partner_id = ${partnerId}::uuid) AS total,
      (SELECT coalesce(jsonb_agg(jsonb_build_object('stars', s.rating, 'count', s.c)), '[]'::jsonb)
       FROM (SELECT rating, count(*)::int AS c FROM partner_ratings
             WHERE partner_id = ${partnerId}::uuid AND status = 'PUBLISHED' GROUP BY rating) s) AS spread,
      (SELECT coalesce(jsonb_agg(jsonb_build_object('tag', t.tag, 'count', t.c) ORDER BY t.c DESC, t.tag), '[]'::jsonb)
       FROM (SELECT x.tag, count(*)::int AS c FROM partner_ratings r CROSS JOIN LATERAL unnest(r.tags) AS x(tag)
             WHERE r.partner_id = ${partnerId}::uuid AND r.status = 'PUBLISHED' AND r.created_at >= ${tagsSince}::timestamp(3)
             GROUP BY x.tag) t) AS tags`;
  return rows[0] ?? { total: 0, spread: [], tags: [] };
}

export function partnerFigures(ctx: DbContext, partnerId: string) {
  return db(ctx).$queryRaw<
    { ratingAvg: number; ratingCount: number; baseCount: number; isDemo: boolean }[]
  >`
    SELECT p.rating_avg AS "ratingAvg", p.rating_count AS "ratingCount", p.rating_base_count AS "baseCount",
           pd.is_demo AS "isDemo"
    FROM partner_directory pd LEFT JOIN delivery_partners p ON p.id = pd.id
    WHERE pd.id = ${partnerId}::uuid`;
}

export function orderRatingRecords(ctx: DbContext, orderId: string): Promise<StaffRatingRecord[]> {
  return db(ctx).$queryRaw<StaffRatingRecord[]>`
    SELECT ${dishColumns}
    FROM reviews r JOIN orders o ON o.id = r.order_id JOIN menu_items m ON m.id = r.menu_item_id
    LEFT JOIN users cu ON cu.id = r.user_id LEFT JOIN users mu ON mu.id = r.moderated_by
    WHERE r.order_id = ${orderId}::uuid
    UNION ALL
    SELECT ${courierColumns}
    FROM partner_ratings r JOIN orders o ON o.id = r.order_id
    JOIN partner_directory pd ON pd.id = r.partner_id
    LEFT JOIN users cu ON cu.id = r.user_id LEFT JOIN users mu ON mu.id = r.moderated_by
    WHERE r.order_id = ${orderId}::uuid`;
}

export function findOrderForStaff(ctx: DbContext, orderId: string) {
  return db(ctx).order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      number: true,
      status: true,
      deliveredAt: true,
      ratingSkippedAt: true,
      user: { select: { isDemo: true } },
    },
  });
}

export async function deliveredCourier(ctx: DbContext, orderId: string) {
  const rows = await db(ctx).$queryRaw<{ partnerId: string; name: string }[]>`
    SELECT pd.id::text AS "partnerId", pd.name
    FROM deliveries d JOIN partner_directory pd ON pd.id = coalesce(d.partner_id, d.ended_partner_id)
    WHERE d.order_id = ${orderId}::uuid AND d.status = 'DELIVERED'`;
  return rows[0] ?? null;
}

// ------------------------------------------------------------------ the partner (V8)

/** The UTC start of today in store time. */
export async function startOfToday(ctx: DbContext): Promise<Date> {
  const rows = await db(ctx).$queryRaw<{ start: Date }[]>`
    SELECT app_store_day_start(app_store_date(app_now())) AS start`;
  return rows[0]?.start ?? new Date();
}

export async function mySummary(ctx: DbContext, before: Date, tagsSince: Date) {
  const rows = await db(ctx).$queryRaw<
    {
      result: {
        count: number;
        average: number | null;
        tagsShown: boolean;
        tags: { tag: string; count: number }[];
        through: string;
      } | null;
    }[]
  >`SELECT app_my_rating_summary(${before}::timestamp(3), ${tagsSince}::timestamp(3)) AS result`;
  return rows[0]?.result ?? null;
}

// ------------------------------------------------------------------ the reminder (V6)

/** Claims the one reminder for an order, as the platform, when every S4.2 condition holds. */
export async function claimReminder(ctx: DbContext, orderId: string, windowDays: number) {
  const rows = await db(ctx).$queryRaw<{ userId: string; number: string }[]>`
    UPDATE orders o SET rating_reminded_at = app_now()
    FROM users u
    WHERE o.id = ${orderId}::uuid AND u.id = o.user_id
      AND o.rating_reminded_at IS NULL AND o.rating_skipped_at IS NULL
      AND o.status <> 'CANCELLED' AND o.delivered_at IS NOT NULL
      AND app_now() <= o.delivered_at + make_interval(secs => ${Math.round(windowDays * 86_400)})
      AND u.deleted_at IS NULL AND NOT u.is_demo
      AND NOT EXISTS (SELECT 1 FROM reviews r WHERE r.order_id = o.id)
      AND NOT EXISTS (SELECT 1 FROM partner_ratings r WHERE r.order_id = o.id)
    RETURNING o.user_id::text AS "userId", o.number`;
  return rows[0] ?? null;
}

export async function courierFirstNameForOrder(
  ctx: DbContext,
  orderId: string,
): Promise<string | null> {
  const id = await rateableCourierAsPlatform(ctx, orderId);
  if (!id) return null;
  const partner = await courierFacts(ctx, id);
  return partner?.user.name ?? null;
}

async function rateableCourierAsPlatform(ctx: DbContext, orderId: string) {
  const rows = await db(ctx).$queryRaw<{ id: string }[]>`
    SELECT p.id::text AS id
    FROM deliveries d
    JOIN orders o ON o.id = d.order_id
    JOIN delivery_partners p ON p.id = coalesce(d.partner_id, d.ended_partner_id)
    JOIN users u ON u.id = p.user_id
    WHERE d.order_id = ${orderId}::uuid AND d.status = 'DELIVERED'
      AND p.user_id <> o.user_id AND u.deleted_at IS NULL`;
  return rows[0]?.id ?? null;
}

// ------------------------------------------------------------------ account data (V9)

export function ratingsForExport(ctx: DbContext, userId: string) {
  return db(ctx).$queryRaw<
    {
      orderNumber: string;
      kind: 'dish' | 'courier';
      subject: string;
      stars: number;
      tags: string[];
      comment: string | null;
      createdAt: Date;
      editedAt: Date | null;
    }[]
  >`
    SELECT o.number AS "orderNumber", 'dish' AS kind, m.title AS subject, r.rating AS stars, r.tags,
           r.comment, r.created_at AS "createdAt", r.edited_at AS "editedAt"
    FROM reviews r JOIN orders o ON o.id = r.order_id JOIN menu_items m ON m.id = r.menu_item_id
    WHERE r.user_id = ${userId}::uuid
    UNION ALL
    SELECT o.number, 'courier', 'Courier', r.rating, r.tags, r.comment, r.created_at, r.edited_at
    FROM partner_ratings r JOIN orders o ON o.id = r.order_id
    WHERE r.user_id = ${userId}::uuid
    ORDER BY 7`;
}
