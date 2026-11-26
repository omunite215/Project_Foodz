import 'server-only';
import { db } from '@/server/db/client';
import type { DbContext } from '@/server/db/context';
import { Prisma } from '@/server/db/generated/client';
import type { VehicleType } from '@/server/db/enums';
import type { EarningKind, EntryReason, PayoutMethod } from './schema';

/*
 * The ledger's reads and its one write path (contract §1–§5). Every write goes through the
 * definer functions of the F9 migration; these queries run under the caller's row-level
 * security, so a partner only ever reads his own rows and staff the pool they may see.
 */

// ------------------------------------------------------------------ store time

export async function storeClock(ctx: DbContext) {
  const rows = await db(ctx).$queryRaw<{ today: string; now: Date; zone: string }[]>`
    SELECT app_store_date(app_now())::text AS today, app_now() AS now, app_store_zone() AS zone`;
  const row = rows[0];
  if (!row) throw new Error('store clock unavailable');
  return row;
}

/** The UTC start of each store date. */
export async function dayStarts(
  ctx: DbContext,
  dates: readonly string[],
): Promise<Map<string, Date>> {
  const rows = await db(ctx).$queryRaw<{ date: string; start: Date }[]>`
    SELECT d::text AS date, app_store_day_start(d) AS start
    FROM unnest(${[...dates]}::date[]) AS d`;
  return new Map(rows.map((row) => [row.date, row.start]));
}

export async function storeDateOf(ctx: DbContext, at: Date): Promise<string> {
  const rows = await db(ctx).$queryRaw<{ date: string }[]>`
    SELECT app_store_date(${at}::timestamp(3))::text AS date`;
  return rows[0]?.date ?? at.toISOString().slice(0, 10);
}

// ------------------------------------------------------------------ the partner himself

export function findOwnPartner(ctx: DbContext, userId: string) {
  return db(ctx).deliveryPartner.findUnique({
    where: { userId },
    select: {
      id: true,
      status: true,
      dailyGoalCents: true,
      user: { select: { isDemo: true, name: true } },
    },
  });
}

export async function setDailyGoal(ctx: DbContext, cents: number | null): Promise<boolean> {
  const rows = await db(ctx).$queryRaw<{ ok: boolean }[]>`
    SELECT app_set_daily_goal(${cents}::int) AS ok`;
  return rows[0]?.ok ?? false;
}

export function findLedger(ctx: DbContext, partnerId: string) {
  return db(ctx).partnerLedger.findUnique({
    where: { partnerId },
    select: {
      version: true,
      balanceCents: true,
      holdingCents: true,
      owedSince: true,
      firstEntryAt: true,
      lastPayoutEntryId: true,
    },
  });
}

export interface EntryRow {
  id: string;
  kind: EarningKind;
  reason: EntryReason | null;
  amountCents: number;
  at: Date;
  date: string;
  deliveryId: string | null;
  message: string | null;
  method: PayoutMethod | null;
  reference: string | null;
  balanceAfterCents: number;
  versionAfter: number;
  paidOn: string | null;
}

/** One partner's entries in [from, to), oldest first; no staff fields. */
export function listEntries(
  ctx: DbContext,
  partnerId: string,
  range: { from?: Date | null; to?: Date | null; fromVersion?: number | null; deliveryId?: string },
): Promise<EntryRow[]> {
  return db(ctx).$queryRaw<EntryRow[]>`
    SELECT e.id::text, e.type::text AS kind, e.reason, e.amount_cents AS "amountCents",
           e.occurred_at AS at, app_store_date(e.occurred_at)::text AS date,
           e.delivery_id::text AS "deliveryId", e.partner_message AS message, e.method, e.reference,
           e.balance_after_cents::int AS "balanceAfterCents", e.version_after AS "versionAfter",
           e.paid_on::text AS "paidOn"
    FROM partner_earnings e
    WHERE e.partner_id = ${partnerId}::uuid
      AND (${range.from ?? null}::timestamp(3) IS NULL OR e.occurred_at >= ${range.from ?? null}::timestamp(3))
      AND (${range.to ?? null}::timestamp(3) IS NULL OR e.occurred_at < ${range.to ?? null}::timestamp(3))
      AND (${range.fromVersion ?? null}::int IS NULL OR e.version_after >= ${range.fromVersion ?? null}::int)
      AND (${range.deliveryId ?? null}::uuid IS NULL OR e.delivery_id = ${range.deliveryId ?? null}::uuid)
    ORDER BY e.occurred_at, e.version_after`;
}

export function findEntryVersion(ctx: DbContext, entryId: string) {
  return db(ctx).partnerEarning.findUnique({
    where: { id: entryId },
    select: {
      versionAfter: true,
      occurredAt: true,
      amountCents: true,
      method: true,
      reference: true,
      paidOn: true,
    },
  });
}

export interface DeliveryFacts {
  deliveryId: string;
  orderNumber: string;
  addressCity: string | null;
  distanceKm: number | null;
  acceptedAt: Date | null;
  pickedUpAt: Date | null;
  deliveredAt: Date | null;
  endedAt: Date | null;
  status: string;
  handoverHow: string | null;
}

/** What the partner may know about deliveries he was paid for (definer function, P55.2). */
export function partnerDeliveryFacts(
  ctx: DbContext,
  ids: readonly string[],
): Promise<DeliveryFacts[]> {
  if (ids.length === 0) return Promise.resolve([]);
  return db(ctx).$queryRaw<DeliveryFacts[]>`
    SELECT delivery_id::text AS "deliveryId", order_number AS "orderNumber", address_city AS "addressCity",
           distance_km AS "distanceKm", accepted_at AS "acceptedAt", picked_up_at AS "pickedUpAt",
           delivered_at AS "deliveredAt", ended_at AS "endedAt", status, handover_how AS "handoverHow"
    FROM app_partner_delivery_facts(${[...ids]}::uuid[])`;
}

export interface DayRow {
  date: string;
  deliveries: number;
  deliveryPayCents: number;
  tipsCents: number;
  adjustmentsCents: number;
  cashCollectedCents: number;
  cashHandedInCents: number;
  paidOutCents: number;
  netCents: number;
}

export function listDays(
  ctx: DbContext,
  partnerId: string,
  from: string,
  to: string,
): Promise<DayRow[]> {
  return db(ctx).$queryRaw<DayRow[]>`
    SELECT day::text AS date, deliveries, delivery_pay_cents::int AS "deliveryPayCents",
           tips_cents::int AS "tipsCents", adjustments_cents::int AS "adjustmentsCents",
           cash_collected_cents::int AS "cashCollectedCents", cash_handed_in_cents::int AS "cashHandedInCents",
           paid_out_cents::int AS "paidOutCents", net_cents::int AS "netCents"
    FROM partner_ledger_days
    WHERE partner_id = ${partnerId}::uuid AND day BETWEEN ${from}::date AND ${to}::date
    ORDER BY day`;
}

export function listSessions(ctx: DbContext, partnerId: string, from: Date, to: Date) {
  return db(ctx).partnerOnlineSession.findMany({
    where: {
      partnerId,
      startedAt: { lt: to },
      OR: [{ endedAt: null }, { endedAt: { gt: from } }],
    },
    select: { startedAt: true, endedAt: true },
  });
}

/** The delivery fee a partner keeps for an order cancelled after pickup (P57.3). */
export async function cancelledFee(
  ctx: DbContext,
  partnerId: string,
  orderNumber: string,
): Promise<number | null> {
  const rows = await db(ctx).$queryRaw<{ amount: number }[]>`
    SELECT e.amount_cents AS amount
    FROM partner_earnings e
    JOIN deliveries d ON d.id = e.delivery_id
    JOIN orders o ON o.id = d.order_id
    WHERE e.partner_id = ${partnerId}::uuid AND e.reason = 'cancelled-after-pickup' AND o.number = ${orderNumber}
    LIMIT 1`;
  return rows[0]?.amount ?? null;
}

// ------------------------------------------------------------------ staff reads

export interface StaffPartnerRow {
  id: string;
  userId: string;
  name: string;
  masked: boolean;
  isDemo: boolean;
  vehicle: string;
  status: string;
  deleted: boolean;
}

export async function findPartnerForStaff(
  ctx: DbContext,
  partnerId: string,
): Promise<StaffPartnerRow | null> {
  const rows = await db(ctx).$queryRaw<StaffPartnerRow[]>`
    SELECT pd.id::text, pd.user_id::text AS "userId", pd.name, pd.masked, pd.is_demo AS "isDemo",
           pd.vehicle_type::text AS vehicle, pd.status::text AS status,
           coalesce((SELECT u.deleted_at IS NOT NULL FROM users u WHERE u.id = pd.user_id), false) AS deleted
    FROM partner_directory pd
    WHERE pd.id = ${partnerId}::uuid`;
  return rows[0] ?? null;
}

export interface StaffEntryCall {
  partnerId: string;
  kind: 'CASH_HANDED_IN' | 'BONUS' | 'ADJUSTMENT' | 'PAYOUT';
  amountCents: number;
  direction: 'add' | 'take-off' | null;
  reason: string | null;
  message: string | null;
  orderNumber: string | null;
  method: PayoutMethod | null;
  reference: string | null;
  paidOn: string | null;
  staffNote: string | null;
  expectedVersion: number;
  idempotencyKey: string;
}

export interface StaffEntryOutcome {
  outcome: 'recorded' | 'replayed' | 'changed' | 'over-limit' | 'not-his-order' | 'not-found';
  entryId?: string;
  kind?: EarningKind;
  amountCents?: number;
  version?: number;
  balanceCents?: number;
  holdingCents?: number;
  which?: 'holding' | 'nothing-held' | 'balance' | 'nothing-owed' | 'paid-on' | 'adjust-cap';
  latest?: {
    kind: EarningKind;
    amountCents: number;
    reason: EntryReason | null;
    at: string;
    orderNumber: string | null;
    byName: string | null;
    byRole: string | null;
  } | null;
}

/** The one write path for staff entries (contract §2.2). */
export async function recordStaffEntry(
  ctx: DbContext,
  call: StaffEntryCall,
): Promise<StaffEntryOutcome> {
  const rows = await db(ctx).$queryRaw<{ result: StaffEntryOutcome }[]>`
    SELECT app_record_staff_entry(${call.partnerId}::uuid, ${call.kind}, ${call.amountCents}::int,
      ${call.direction}, ${call.reason}, ${call.message}, ${call.orderNumber}, ${call.method},
      ${call.reference}, ${call.paidOn}::date, ${call.staffNote}, ${call.expectedVersion}::int,
      ${call.idempotencyKey}) AS result`;
  const result = rows[0]?.result;
  if (!result) throw new Error('staff entry returned nothing');
  return result;
}

export interface StaffLedgerRow {
  id: string;
  at: Date;
  kind: EarningKind;
  reason: EntryReason | null;
  message: string | null;
  staffNote: string | null;
  orderId: string | null;
  orderNumber: string | null;
  amountCents: number;
  balanceAfterCents: number;
  recordedKind: 'system' | 'staff';
  recordedName: string | null;
  recordedRole: 'support' | 'admin' | null;
  method: PayoutMethod | null;
  reference: string | null;
  paidOn: string | null;
}

/** The staff ledger table (A59.2): one page, or every row of the range for the CSV. */
export function staffLedgerRows(
  ctx: DbContext,
  partnerId: string,
  range: { from: Date; to: Date },
  page: { dir: 'asc' | 'desc'; limit: number; offset: number },
): Promise<StaffLedgerRow[]> {
  const direction = page.dir === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
  return db(ctx).$queryRaw<StaffLedgerRow[]>`
    SELECT e.id::text, e.occurred_at AS at, e.type::text AS kind, e.reason, e.partner_message AS message,
           s.staff_note AS "staffNote", o.id::text AS "orderId", o.number AS "orderNumber",
           e.amount_cents AS "amountCents", e.balance_after_cents::int AS "balanceAfterCents",
           e.recorded_kind AS "recordedKind", s.recorded_name AS "recordedName",
           s.recorded_role AS "recordedRole", e.method, e.reference, e.paid_on::text AS "paidOn"
    FROM partner_earnings e
    LEFT JOIN partner_earning_staff s ON s.earning_id = e.id
    LEFT JOIN deliveries d ON d.id = e.delivery_id
    LEFT JOIN orders o ON o.id = d.order_id
    WHERE e.partner_id = ${partnerId}::uuid
      AND e.occurred_at >= ${range.from}::timestamp(3) AND e.occurred_at < ${range.to}::timestamp(3)
    ORDER BY e.occurred_at ${direction}, e.version_after ${direction}
    LIMIT ${page.limit} OFFSET ${page.offset}`;
}

export async function countStaffLedgerRows(
  ctx: DbContext,
  partnerId: string,
  range: { from: Date; to: Date },
): Promise<number> {
  const rows = await db(ctx).$queryRaw<{ count: number }[]>`
    SELECT count(*)::int AS count FROM partner_earnings
    WHERE partner_id = ${partnerId}::uuid
      AND occurred_at >= ${range.from}::timestamp(3) AND occurred_at < ${range.to}::timestamp(3)`;
  return rows[0]?.count ?? 0;
}

// ------------------------------------------------------------------ the report (A63)

export interface ReportSumsRow {
  partnerId: string;
  name: string;
  masked: boolean;
  isDemo: boolean;
  vehicle: VehicleType;
  deleted: boolean;
  deliveries: number;
  deliveryPayCents: number;
  tipsCents: number;
  adjustmentsCents: number;
  cashCollectedCents: number;
  cashHandedInCents: number;
  paidOutCents: number;
  openingCents: number;
  activeDays: number;
}

/** Every partner's sums for a range from the day totals of one pool (A63.6). */
export function reportSums(
  ctx: DbContext,
  range: { from: string; to: string },
  pool: 'REAL' | 'DEMO',
): Promise<ReportSumsRow[]> {
  return db(ctx).$queryRaw<ReportSumsRow[]>`
    WITH sums AS (
      SELECT d.partner_id,
        coalesce(sum(d.deliveries) FILTER (WHERE d.day >= ${range.from}::date), 0)::int AS deliveries,
        coalesce(sum(d.delivery_pay_cents) FILTER (WHERE d.day >= ${range.from}::date), 0)::bigint AS pay,
        coalesce(sum(d.tips_cents) FILTER (WHERE d.day >= ${range.from}::date), 0)::bigint AS tips,
        coalesce(sum(d.adjustments_cents) FILTER (WHERE d.day >= ${range.from}::date), 0)::bigint AS adj,
        coalesce(sum(d.cash_collected_cents) FILTER (WHERE d.day >= ${range.from}::date), 0)::bigint AS cash,
        coalesce(sum(d.cash_handed_in_cents) FILTER (WHERE d.day >= ${range.from}::date), 0)::bigint AS handed,
        coalesce(sum(d.paid_out_cents) FILTER (WHERE d.day >= ${range.from}::date), 0)::bigint AS paid,
        coalesce(sum(d.net_cents) FILTER (WHERE d.day < ${range.from}::date), 0)::bigint AS opening,
        count(*) FILTER (WHERE d.day >= ${range.from}::date)::int AS active
      FROM partner_ledger_days d
      WHERE d.pool = ${pool} AND d.day <= ${range.to}::date
      GROUP BY d.partner_id
    )
    SELECT s.partner_id::text AS "partnerId", pd.name, pd.masked, pd.is_demo AS "isDemo",
           pd.vehicle_type::text AS vehicle,
           coalesce((SELECT u.deleted_at IS NOT NULL FROM users u WHERE u.id = pd.user_id), false) AS deleted,
           s.deliveries, s.pay::float8 AS "deliveryPayCents", s.tips::float8 AS "tipsCents",
           s.adj::float8 AS "adjustmentsCents", s.cash::float8 AS "cashCollectedCents",
           s.handed::float8 AS "cashHandedInCents", s.paid::float8 AS "paidOutCents",
           s.opening::float8 AS "openingCents", s.active AS "activeDays"
    FROM sums s
    JOIN partner_directory pd ON pd.id = s.partner_id`;
}

/**
 * The demo admin's rows for real partners (approved and suspended), no figures (A66): the name
 * as `partner_directory` shows it to demo staff (sample partners shown, others masked).
 */
export function realPartnersForDemo(ctx: DbContext) {
  return db(ctx).$queryRaw<
    { partnerId: string; name: string; masked: boolean; vehicle: VehicleType }[]
  >`
    SELECT pd.id::text AS "partnerId", pd.name, pd.masked, pd.vehicle_type::text AS vehicle
    FROM partner_directory pd
    WHERE NOT pd.is_demo AND pd.status IN ('APPROVED', 'SUSPENDED')`;
}

// ------------------------------------------------------------------ the partners list (A57)

export interface ListMoneyRow {
  partnerId: string;
  isDemo: boolean;
  ratingAvg: number;
  ratingCount: number;
  balanceCents: number | null;
  holdingCents: number | null;
  owedSince: Date | null;
  weekDeliveries: number;
  weekEarnedCents: number;
}

export function listMoney(
  ctx: DbContext,
  partnerIds: readonly string[],
  week: { from: string; to: string },
): Promise<ListMoneyRow[]> {
  if (partnerIds.length === 0) return Promise.resolve([]);
  return db(ctx).$queryRaw<ListMoneyRow[]>`
    SELECT pd.id::text AS "partnerId", pd.is_demo AS "isDemo",
           coalesce(p.rating_avg, 0) AS "ratingAvg", coalesce(p.rating_count, 0) AS "ratingCount",
           l.balance_cents::float8 AS "balanceCents", l.holding_cents::float8 AS "holdingCents",
           l.owed_since AS "owedSince",
           coalesce(w.deliveries, 0)::int AS "weekDeliveries", coalesce(w.earned, 0)::float8 AS "weekEarnedCents"
    FROM partner_directory pd
    LEFT JOIN delivery_partners p ON p.id = pd.id
    LEFT JOIN partner_ledgers l ON l.partner_id = pd.id
    LEFT JOIN LATERAL (
      SELECT sum(d.deliveries) AS deliveries,
             sum(d.delivery_pay_cents + d.tips_cents + d.adjustments_cents) AS earned
      FROM partner_ledger_days d
      WHERE d.partner_id = pd.id AND d.day BETWEEN ${week.from}::date AND ${week.to}::date
    ) w ON true
    WHERE pd.id = ANY (${[...partnerIds]}::uuid[])`;
}

/** Demo partners' current figures for the demo admin, who can't read partner rows (A66.1). */
export function demoPartnerRatings(ctx: DbContext, partnerIds: readonly string[]) {
  return db(ctx).deliveryPartner.findMany({
    where: { id: { in: [...partnerIds] }, user: { isDemo: true } },
    select: { id: true, ratingAvg: true, ratingCount: true },
  });
}

/** U22: false while the partner's balance isn't zero; otherwise his sessions are removed. */
export async function settleForDeletion(ctx: DbContext): Promise<boolean> {
  const rows = await db(ctx).$queryRaw<{ ok: boolean }[]>`
    SELECT app_settle_own_partner_for_deletion() AS ok`;
  return rows[0]?.ok ?? false;
}

// ------------------------------------------------------------------ nightly jobs (E7, U20)

export interface ReconcileResult {
  deliveries: string[];
  ledgers: string[];
  sessions: string[];
  stuckDeliveries: string[];
}

export async function reconcile(ctx: DbContext): Promise<ReconcileResult> {
  const rows = await db(ctx).$queryRaw<
    { result: ReconcileResult }[]
  >`SELECT app_reconcile_earnings() AS result`;
  return rows[0]?.result ?? { deliveries: [], ledgers: [], sessions: [], stuckDeliveries: [] };
}

export async function resetDemo(ctx: DbContext) {
  const rows = await db(ctx).$queryRaw<
    { result: { entries: number; ratings: number; orders: number } }[]
  >`
    SELECT app_reset_demo_f9() AS result`;
  return rows[0]?.result ?? { entries: 0, ratings: 0, orders: 0 };
}

/** The UTC start of the store day `now` falls in. */
export async function dayStartOf(ctx: DbContext, now: Date): Promise<Date> {
  const rows = await db(ctx).$queryRaw<{ start: Date }[]>`
    SELECT app_store_day_start(app_store_date(${now}::timestamp(3))) AS start`;
  return rows[0]?.start ?? now;
}
