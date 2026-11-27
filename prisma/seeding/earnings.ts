import { v5 as uuidv5 } from 'uuid';
import type { PrismaClient } from '../../server/db/generated/client';

/*
 * F9's earnings and rating fixtures (story "Earnings fixtures", "Rating fixtures"): Luis's and
 * Diego's weeks, Grace's rated deliveries, a payout, a cash hand-in, online sessions and S2209
 * with its window closed. Orders belong to Hana Kim, so Priya's and Maya's lists don't change.
 * Placed relative to `at` (T): "this week" is T's Monday to Sunday, "last week" the one before;
 * an entry that would fall after T is left out. Local and CI databases only. Runs as the
 * migrator, which owns the ledger, so it can clear these partners' rows first (E11.1).
 */

export type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

const NAMESPACE = '8c1d7a52-5b1e-4f0e-9a37-2f4b9d0c6e11';
const seedId = (name: string) => uuidv5(name, NAMESPACE);

export const HANA = { email: 'history.customer@foodz.example', name: 'Hana Kim' };

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

/** Deletes every F9 ledger row of these partners and the ledgers themselves. */
export async function clearEarningsForPartners(tx: Tx, partnerIds: readonly string[]) {
  for (const id of partnerIds) {
    await tx.$executeRaw`SELECT app_clear_partner_ledger(${id}::uuid)`;
  }
}

/**
 * Before orders are deleted (the ledger keeps a delivery with RESTRICT): every partner with an
 * entry on their deliveries loses his whole ledger. Recomputing him from what is left would
 * count later hand-ins and payouts against cash and pay that are gone, which can leave him
 * holding less than nothing (partner_ledgers_counts).
 */
export async function clearEarningsForOrders(tx: Tx, orderIds: readonly string[]) {
  if (orderIds.length === 0) return;
  const partners = await tx.$queryRaw<{ id: string }[]>`
    SELECT DISTINCT e.partner_id::text AS id
    FROM partner_earnings e JOIN deliveries d ON d.id = e.delivery_id
    WHERE d.order_id = ANY (${[...orderIds]}::uuid[])`;
  await clearEarningsForPartners(
    tx,
    partners.map((row) => row.id),
  );
}

/** Splits a day's pay into `count` deliveries whose fee and tip add up exactly. */
function split(totalCents: number, tipsCents: number, count: number) {
  const feeTotal = totalCents - tipsCents;
  return Array.from({ length: count }, (_, index) => {
    const fee = Math.floor(feeTotal / count) + (index === 0 ? feeTotal % count : 0);
    const tip = Math.floor(tipsCents / count) + (index === 0 ? tipsCents % count : 0);
    return { feeCents: fee, tipCents: tip };
  });
}

interface DayPlan {
  partner: 'luis' | 'diego' | 'grace';
  /** Days from T's Monday (negative: last week). */
  day: number;
  /** Minutes after store midnight of the first delivery. */
  startMinutes: number;
  count: number;
  totalCents: number;
  tipsCents: number;
  /** Cash order totals, one per cash delivery (the first ones of the day). */
  cash?: number[];
  /** Fixture order numbers, one per delivery. */
  numbers?: string[];
}

const PLAN: readonly DayPlan[] = [
  // Luis, last week: 14 deliveries, $96.40 incl. $22.00 tips, no cash.
  { partner: 'luis', day: -7, startMinutes: 11 * 60, count: 4, totalCents: 2_760, tipsCents: 600 },
  { partner: 'luis', day: -5, startMinutes: 17 * 60, count: 5, totalCents: 3_440, tipsCents: 800 },
  { partner: 'luis', day: -3, startMinutes: 18 * 60, count: 5, totalCents: 3_440, tipsCents: 800 },
  // Luis, this week before T.
  { partner: 'luis', day: 0, startMinutes: 12 * 60, count: 4, totalCents: 2_840, tipsCents: 900 },
  {
    partner: 'luis',
    day: 2,
    startMinutes: 17 * 60,
    count: 6,
    totalCents: 4_185,
    tipsCents: 1_250,
    cash: [4_620, 3_875],
  },
  { partner: 'luis', day: 3, startMinutes: 18 * 60, count: 5, totalCents: 3_620, tipsCents: 1_000 },
  {
    partner: 'luis',
    day: 4,
    startMinutes: 11 * 60 + 45,
    count: 2,
    totalCents: 1_193,
    tipsCents: 300,
  },
  // Diego, this week: Tuesday, 3 cash deliveries, $22.10 incl. $4.00 tips, $164.80 collected.
  {
    partner: 'diego',
    day: 1,
    startMinutes: 20 * 60 + 40,
    count: 3,
    totalCents: 2_210,
    tipsCents: 400,
    cash: [5_480, 5_520, 5_480],
  },
  // Grace: S2201–S2205 and S2209 last week, S2206–S2208 this week.
  {
    partner: 'grace',
    day: -7,
    startMinutes: 12 * 60,
    count: 2,
    totalCents: 1_400,
    tipsCents: 300,
    numbers: ['S2201', 'S2202'],
  },
  {
    partner: 'grace',
    day: -6,
    startMinutes: 12 * 60,
    count: 2,
    totalCents: 1_400,
    tipsCents: 300,
    numbers: ['S2203', 'S2209'],
  },
  {
    partner: 'grace',
    day: -4,
    startMinutes: 18 * 60,
    count: 2,
    totalCents: 1_400,
    tipsCents: 300,
    numbers: ['S2204', 'S2205'],
  },
  {
    partner: 'grace',
    day: 0,
    startMinutes: 18 * 60,
    count: 1,
    totalCents: 700,
    tipsCents: 150,
    numbers: ['S2206'],
  },
  {
    partner: 'grace',
    day: 1,
    startMinutes: 18 * 60,
    count: 2,
    totalCents: 1_400,
    tipsCents: 300,
    numbers: ['S2207', 'S2208'],
  },
];

/** Grace's ratings by Hana on S2201–S2208: 4.5 · 8, with the story's tags. */
const GRACE_RATINGS: readonly { number: string; stars: number; tags: string[] }[] = [
  { number: 'S2201', stars: 5, tags: ['friendly', 'on-time'] },
  { number: 'S2202', stars: 5, tags: ['friendly', 'careful-with-food'] },
  { number: 'S2203', stars: 4, tags: ['on-time'] },
  { number: 'S2204', stars: 5, tags: ['friendly', 'on-time', 'careful-with-food'] },
  { number: 'S2205', stars: 3, tags: ['late'] },
  { number: 'S2206', stars: 5, tags: ['friendly'] },
  { number: 'S2207', stars: 4, tags: ['on-time', 'careful-with-food'] },
  { number: 'S2208', stars: 5, tags: ['friendly'] },
];

export interface EarningsPeople {
  luis: string;
  diego: string;
  grace: string;
  morgan: string;
  admin: string;
}

async function storeDayStart(tx: Tx, at: Date, days: number): Promise<Date> {
  const rows = await tx.$queryRaw<{ start: Date }[]>`
    SELECT app_store_day_start(app_store_date(${at}::timestamp(3)) + ${days}::int) AS start`;
  return rows[0]?.start ?? at;
}

async function mondayStart(tx: Tx, at: Date): Promise<Date> {
  const rows = await tx.$queryRaw<{ start: Date }[]>`
    SELECT app_store_day_start(date_trunc('week', app_store_date(${at}::timestamp(3)))::date) AS start`;
  return rows[0]?.start ?? at;
}

async function ensureHana(tx: Tx, at: Date): Promise<string> {
  const found = await tx.user.findUnique({ where: { email: HANA.email }, select: { id: true } });
  if (found) return found.id;
  const id = seedId('history-customer');
  await tx.user.create({
    data: {
      id,
      name: HANA.name,
      email: HANA.email,
      emailVerified: true,
      isSample: true,
      createdAt: new Date(at.getTime() - 60 * DAY_MS),
    },
  });
  return id;
}

/** Puts the fixtures back for T = `at`. Returns how many deliveries were written. */
export async function resetEarningsFixtures(
  tx: Tx,
  people: EarningsPeople,
  at: Date,
): Promise<number> {
  const hana = await ensureHana(tx, at);
  const partners: Record<DayPlan['partner'], string> = {
    luis: people.luis,
    diego: people.diego,
    grace: people.grace,
  };
  const ids = Object.values(partners);

  // Earlier runs: their orders (and everything under them) and these partners' ledgers go.
  const oldOrders = await tx.order.findMany({
    where: { userId: hana, number: { startsWith: 'S2' } },
    select: { id: true },
  });
  await clearEarningsForPartners(tx, ids);
  // Anyone else with an entry on those orders (a staff adjustment naming one, say).
  await clearEarningsForOrders(
    tx,
    oldOrders.map((order) => order.id),
  );
  await tx.$executeRaw`DELETE FROM partner_rating_snapshots WHERE partner_id = ANY (${ids}::uuid[])`;
  await tx.order.deleteMany({ where: { id: { in: oldOrders.map((order) => order.id) } } });
  await tx.partnerOnlineSession.deleteMany({
    where: { partnerId: { in: ids }, endedAt: { not: null } },
  });

  const dish = await tx.menuItem.findFirst({
    orderBy: { slug: 'asc' },
    select: { id: true, title: true, priceCents: true },
  });
  if (!dish) throw new Error('Seed the menu first.');
  const monday = await mondayStart(tx, at);
  let written = 0;
  let counter = 0;

  for (const plan of PLAN) {
    const dayStart = await storeDayStart(tx, monday, plan.day);
    const pieces = split(plan.totalCents, plan.tipsCents, plan.count);
    for (const [index, piece] of pieces.entries()) {
      const deliveredAt = new Date(
        dayStart.getTime() + (plan.startMinutes + index * 40) * MINUTE_MS,
      );
      if (deliveredAt.getTime() > at.getTime()) continue;
      counter += 1;
      const cash = plan.cash?.[index];
      const number = plan.numbers?.[index] ?? `S2${String(counter).padStart(3, '0')}`;
      const orderId = seedId(`earnings-order:${number}`);
      const total = cash ?? 4_800;
      await tx.order.create({
        data: {
          id: orderId,
          number,
          userId: hana,
          status: 'DELIVERED',
          paymentMethod: cash ? 'CASH' : 'CARD',
          paymentStatus: 'PAID',
          contactName: HANA.name,
          contactPhone: '+16175550188',
          addressText: '75 State Street, Boston, MA 02109',
          addressLine1: '75 State Street',
          addressCity: 'Boston, MA 02109',
          addressLat: 42.3588,
          addressLng: -71.0553,
          distanceKm: 1.2,
          subtotalCents: total - piece.feeCents - piece.tipCents,
          deliveryFeeCents: piece.feeCents,
          taxCents: 0,
          tipCents: piece.tipCents,
          totalCents: total,
          placedAt: new Date(deliveredAt.getTime() - 40 * MINUTE_MS),
          pickedUpAt: new Date(deliveredAt.getTime() - 10 * MINUTE_MS),
          deliveredAt,
          createdAt: new Date(deliveredAt.getTime() - 41 * MINUTE_MS),
          items: {
            create: {
              menuItemId: dish.id,
              title: dish.title,
              unitPriceCents: dish.priceCents,
              quantity: 1,
              flavors: [],
            },
          },
        },
      });
      const delivery = await tx.delivery.create({
        data: {
          orderId,
          status: 'PICKED_UP',
          partnerId: partners[plan.partner],
          partnerFeeCents: piece.feeCents + piece.tipCents,
          tipCents: piece.tipCents,
          assignedAt: new Date(deliveredAt.getTime() - 16 * MINUTE_MS),
          pickedUpAt: new Date(deliveredAt.getTime() - 10 * MINUTE_MS),
        },
        select: { id: true },
      });
      // The ledger trigger writes the entries at the delivered time.
      await tx.$executeRaw`
        UPDATE deliveries SET status = 'DELIVERED', delivered_at = ${deliveredAt}::timestamp(3),
          ended_at = ${deliveredAt}::timestamp(3), handover_how = 'code'
        WHERE id = ${delivery.id}::uuid`;
      written += 1;
    }
  }

  // Luis: the payout for last week (Monday 10:05 am) and the hand-in (Thursday 2:10 pm, Morgan).
  const payoutAt = new Date(
    (await storeDayStart(tx, monday, 0)).getTime() + (10 * 60 + 5) * MINUTE_MS,
  );
  if (payoutAt.getTime() <= at.getTime()) {
    await tx.$executeRaw`
      SELECT app_append_entry(${people.luis}::uuid, 'PAYOUT', -9640, NULL, NULL, NULL, 'bank-transfer',
        'Week of Nov 9', app_store_date(${payoutAt}::timestamp(3)), 'REAL',
        ${`seed-payout-${people.luis}`}, ${payoutAt}::timestamp(3), 'staff')`;
    await tx.$executeRaw`
      INSERT INTO partner_earning_staff (earning_id, recorded_by, recorded_name, recorded_role)
      SELECT id, ${people.admin}::uuid, 'Foodz Admin', 'admin' FROM partner_earnings
      WHERE idempotency_key = ${`seed-payout-${people.luis}`}`;
  }
  const handInAt = new Date(
    (await storeDayStart(tx, monday, 3)).getTime() + (14 * 60 + 10) * MINUTE_MS,
  );
  if (handInAt.getTime() <= at.getTime()) {
    await tx.$executeRaw`
      SELECT app_append_entry(${people.luis}::uuid, 'CASH_HANDED_IN', 8495, NULL, NULL, NULL, NULL, NULL, NULL,
        'REAL', ${`seed-handin-${people.luis}`}, ${handInAt}::timestamp(3), 'staff')`;
    await tx.$executeRaw`
      INSERT INTO partner_earning_staff (earning_id, recorded_by, recorded_name, recorded_role)
      SELECT id, ${people.morgan}::uuid, 'Morgan Diaz', 'support' FROM partner_earnings
      WHERE idempotency_key = ${`seed-handin-${people.luis}`}`;
  }
  for (const id of ids) await tx.$executeRaw`SELECT app_rebuild_partner_ledger(${id}::uuid)`;

  // Online sessions: Luis Mon 3 h 10, Wed 4 h 05, Thu 3 h 40, Fri 11:30–1:30; Diego Tue 2 h 30.
  const sessions: [string, number, number, number][] = [
    [people.luis, 0, 11 * 60 + 40, 190],
    [people.luis, 2, 16 * 60 + 40, 245],
    [people.luis, 3, 17 * 60 + 40, 220],
    [people.luis, 4, 11 * 60 + 30, 120],
    [people.diego, 1, 18 * 60 + 40, 150],
  ];
  for (const [partnerId, day, start, minutes] of sessions) {
    const startedAt = new Date(
      (await storeDayStart(tx, monday, day)).getTime() + start * MINUTE_MS,
    );
    const endedAt = new Date(startedAt.getTime() + minutes * MINUTE_MS);
    if (endedAt.getTime() > at.getTime()) continue;
    await tx.partnerOnlineSession.create({
      data: { partnerId, startedAt, endedAt, endReason: 'self', pool: 'REAL' },
    });
  }

  // Grace's ratings; S2209 stays unrated (its window closed).
  for (const rating of GRACE_RATINGS) {
    const orderId = seedId(`earnings-order:${rating.number}`);
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: { id: true, deliveredAt: true },
    });
    if (!order?.deliveredAt) continue;
    await tx.partnerRating.create({
      data: {
        userId: hana,
        partnerId: people.grace,
        orderId,
        rating: rating.stars,
        tags: rating.tags,
        createdAt: new Date(order.deliveredAt.getTime() + 20 * MINUTE_MS),
      },
    });
  }
  await tx.$executeRaw`SELECT app_recalc_partner_rating(${people.grace}::uuid)`;
  return written;
}
