import { PrismaPg } from '@prisma/adapter-pg';
import { v7 as uuid } from 'uuid';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { db, prisma } from '@/server/db/client';
import { type Actor, runAs } from '@/server/db/context';
import { PrismaClient } from '@/server/db/generated/client';
import { deliveryCodeHash } from '@/server/security/code-hash';
import { seedCatalog } from '../../prisma/seeding';
import {
  approvedPartner,
  customerAccount,
  goOnlineAt,
  quietDispatch,
  readyOrder,
  type TestPartner,
} from './support/dispatch';

/*
 * The F9 migration at the database level (contract §1–§3, §8, §13): each way a delivery ends
 * writes its courier's entries once, in the transition's transaction; staff entries through the
 * one definer function (roles, version, idempotency, limits); who reads the ledger with the
 * service bypassed, for all three database roles; online sessions; the own-order offer guard;
 * store days across the clocks going back; the nightly reconcile.
 */

let migrator: PrismaClient;
let readonly: PrismaClient;
let luis: TestPartner;
let grace: TestPartner;
let jamie: TestPartner;
let priya: { userId: string; actor: Actor };
let dana: { userId: string; actor: Actor };
const staff = {
  support: uuid(),
  admin: uuid(),
  kitchen: uuid(),
  editor: uuid(),
  demoAdmin: uuid(),
};
const as = (userId: string, role: string, isDemo = false): Actor =>
  ({ kind: 'user', userId, role, isDemo }) as Actor;
const support = () => as(staff.support, 'support');
const admin = () => as(staff.admin, 'admin');
const kitchen = () => as(staff.kitchen, 'kitchen');
const demoAdmin = () => as(staff.demoAdmin, 'admin', true);
const system: Actor = { kind: 'system', reason: 'test' };
const DENIED = /permission denied|row-level security|violates|insufficient/i;
const CODE = '4071';

const call = (
  who: Actor,
  query: (
    ctx: Parameters<Parameters<typeof runAs>[1]>[0],
  ) => Promise<{ result: Record<string, unknown> }[]>,
) => runAs(who, query).then((rows) => rows[0]!.result);

const entriesOf = (deliveryId: string) =>
  migrator.partnerEarning.findMany({
    where: { deliveryId },
    orderBy: { versionAfter: 'asc' },
    select: { type: true, amountCents: true, reason: true, partnerId: true, pool: true },
  });

const ledgerOf = (partnerId: string) => migrator.partnerLedger.findUnique({ where: { partnerId } });

async function delivery(
  partner: TestPartner,
  options: {
    cash?: boolean;
    status?: 'ASSIGNED' | 'PICKED_UP';
    pool?: 'REAL' | 'DEMO';
    customer?: string;
  } = {},
) {
  const order = await readyOrder(migrator, options.customer ?? priya.userId, {
    cash: options.cash ?? true,
  });
  const status = options.status ?? 'ASSIGNED';
  if (status === 'PICKED_UP') {
    await migrator.order.update({ where: { id: order.id }, data: { status: 'PICKED_UP' } });
  }
  const created = await migrator.delivery.create({
    data: {
      orderId: order.id,
      status,
      partnerId: partner.partnerId,
      partnerFeeCents: 764,
      tipCents: 500,
      pool: options.pool ?? 'REAL',
      assignedAt: new Date(),
      ...(status === 'PICKED_UP' && { pickedUpAt: new Date() }),
    },
    select: { id: true },
  });
  return { order, deliveryId: created.id };
}

const pickUp = (deliveryId: string) =>
  call(
    luis.actor,
    (ctx) =>
      db(ctx)
        .$queryRaw`SELECT app_pick_up(${deliveryId}::uuid, 'sealed', ${deliveryCodeHash(deliveryId, CODE)}, false) AS "result"`,
  );

const handOver = (deliveryId: string, cash = true) =>
  call(
    luis.actor,
    (ctx) =>
      db(ctx)
        .$queryRaw`SELECT app_hand_over(${deliveryId}::uuid, ${deliveryCodeHash(deliveryId, CODE)}, ${cash}, false) AS "result"`,
  );

interface StaffEntry {
  kind: 'CASH_HANDED_IN' | 'BONUS' | 'ADJUSTMENT' | 'PAYOUT';
  amount: number;
  version: number;
  key?: string;
  direction?: 'add' | 'take-off' | null;
  reason?: string | null;
  message?: string | null;
  orderNumber?: string | null;
  method?: string | null;
  paidOn?: string | null;
}

const record = (who: Actor, partnerId: string, entry: StaffEntry) =>
  call(
    who,
    (ctx) =>
      db(ctx).$queryRaw`
        SELECT app_record_staff_entry(${partnerId}::uuid, ${entry.kind}, ${entry.amount}::int,
          ${entry.direction ?? null}, ${entry.reason ?? null}, ${entry.message ?? null},
          ${entry.orderNumber ?? null}, ${entry.method ?? null}, NULL,
          ${entry.paidOn ?? null}::date, NULL, ${entry.version}::int, ${entry.key ?? uuid()}) AS "result"`,
  );

beforeAll(async () => {
  migrator = new PrismaClient({
    adapter: new PrismaPg({ connectionString: inject('migratorUrl') }),
  });
  readonly = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: inject('databaseUrl').replace(
        'foodz_app:test-app',
        'foodz_readonly:test-readonly',
      ),
    }),
  });
  await migrator.$transaction((tx) => seedCatalog(tx, { now: new Date() }), { timeout: 60_000 });
  await migrator.user.createMany({
    data: [
      {
        id: staff.support,
        name: 'Morgan Diaz',
        email: `s-${staff.support}@test.dev`,
        role: 'support',
      },
      { id: staff.admin, name: 'Foodz Admin', email: `a-${staff.admin}@test.dev`, role: 'admin' },
      {
        id: staff.kitchen,
        name: 'Alex Kim',
        email: `k-${staff.kitchen}@test.dev`,
        role: 'kitchen',
      },
      {
        id: staff.editor,
        name: 'Taylor Brooks',
        email: `e-${staff.editor}@test.dev`,
        role: 'content_editor',
      },
      {
        id: staff.demoAdmin,
        name: 'Demo Admin',
        email: `d-${staff.demoAdmin}@test.dev`,
        role: 'admin',
        isDemo: true,
      },
    ],
  });
  luis = await approvedPartner(migrator, 'Luis Moreno');
  grace = await approvedPartner(migrator, 'Grace Okafor', { vehicle: 'BICYCLE', plate: null });
  jamie = await approvedPartner(migrator, 'Jamie Demo', { demo: true });
  priya = await customerAccount(migrator, 'Priya Shah');
  dana = await customerAccount(migrator, 'Dana Demo', true);
});

beforeEach(async () => {
  await quietDispatch(migrator);
  await goOnlineAt(migrator, luis, { km: 0.05 });
});

afterAll(async () => {
  await migrator.$disconnect();
  await readonly.$disconnect();
  await prisma.$disconnect();
});

describe('each ending writes its entries once (E2, E3)', () => {
  it('pays fee, tip and the cash taken for a code hand-over, once, whatever is replayed', async () => {
    const before = (await ledgerOf(luis.partnerId))?.balanceCents ?? 0n;
    const { deliveryId } = await delivery(luis, { cash: true });
    await pickUp(deliveryId);
    expect(await handOver(deliveryId)).toMatchObject({ outcome: 'delivered' });
    expect(await handOver(deliveryId)).toMatchObject({ outcome: 'delivered', replayed: true });
    await migrator.$executeRaw`SELECT app_write_delivery_entries(${deliveryId}::uuid)`;
    expect(await entriesOf(deliveryId)).toEqual([
      {
        type: 'DELIVERY_FEE',
        amountCents: 264,
        reason: null,
        partnerId: luis.partnerId,
        pool: 'REAL',
      },
      { type: 'TIP', amountCents: 500, reason: null, partnerId: luis.partnerId, pool: 'REAL' },
      {
        type: 'CASH_COLLECTED',
        amountCents: -5897,
        reason: null,
        partnerId: luis.partnerId,
        pool: 'REAL',
      },
    ]);
    const ledger = await ledgerOf(luis.partnerId);
    expect(ledger!.balanceCents - before).toBe(764n - 5897n);
  });

  it('pays fee and tip for a card order finished by staff, and for the hand-over moved by the platform', async () => {
    const card = await delivery(luis, { cash: false, status: 'PICKED_UP' });
    await migrator.$executeRaw`
      UPDATE deliveries SET status = 'DELIVERED', delivered_at = app_now(), version = version + 1
      WHERE id = ${card.deliveryId}::uuid`;
    expect((await entriesOf(card.deliveryId)).map((entry) => entry.type)).toEqual([
      'DELIVERY_FEE',
      'TIP',
    ]);
    const { version } = await migrator.delivery.findUniqueOrThrow({
      where: { id: card.deliveryId },
    });
    // A second ending can't happen, and a direct replay writes nothing.
    await migrator.$executeRaw`UPDATE deliveries SET status = 'DELIVERED', version = ${version + 1} WHERE id = ${card.deliveryId}::uuid`;
    expect(await entriesOf(card.deliveryId)).toHaveLength(2);
  });

  it('pays only the fee for a cancellation after pickup, even when the cancellation clears the courier', async () => {
    const unreachable = await delivery(luis, { status: 'PICKED_UP' });
    const { version } = await migrator.delivery.findUniqueOrThrow({
      where: { id: unreachable.deliveryId },
    });
    expect(
      await call(
        admin(),
        (ctx) =>
          db(ctx)
            .$queryRaw`SELECT app_staff_cancel_unreachable(${unreachable.deliveryId}::uuid, ${version}::int, NULL) AS "result"`,
      ),
    ).toMatchObject({ outcome: 'cancelled' });
    expect(await entriesOf(unreachable.deliveryId)).toEqual([
      {
        type: 'DELIVERY_FEE',
        amountCents: 264,
        reason: 'cancelled-after-pickup',
        partnerId: luis.partnerId,
        pool: 'REAL',
      },
    ]);
    // F5's cancellation (F7 releaseDelivery) clears partner_id in the same statement.
    const released = await delivery(luis, { status: 'PICKED_UP' });
    await migrator.$executeRaw`
      UPDATE deliveries SET status = 'CANCELLED', partner_id = NULL, assigned_at = NULL, version = version + 1
      WHERE id = ${released.deliveryId}::uuid`;
    expect(await entriesOf(released.deliveryId)).toMatchObject([
      { type: 'DELIVERY_FEE', reason: 'cancelled-after-pickup', partnerId: luis.partnerId },
    ]);
    const row = await migrator.delivery.findUniqueOrThrow({ where: { id: released.deliveryId } });
    expect(row.endedPartnerId).toBe(luis.partnerId);
  });

  it('pays nothing before pickup: cancelled, given back, taken off', async () => {
    const cancelled = await delivery(luis);
    await migrator.$executeRaw`UPDATE deliveries SET status = 'CANCELLED', partner_id = NULL WHERE id = ${cancelled.deliveryId}::uuid`;
    const givenBack = await delivery(luis);
    await migrator.$executeRaw`UPDATE deliveries SET status = 'SEARCHING', partner_id = NULL WHERE id = ${givenBack.deliveryId}::uuid`;
    expect(await entriesOf(cancelled.deliveryId)).toEqual([]);
    expect(await entriesOf(givenBack.deliveryId)).toEqual([]);
  });

  it("writes the demo bot's entries in the demo pool, without cash", async () => {
    const demo = await delivery(jamie, {
      status: 'PICKED_UP',
      pool: 'DEMO',
      cash: true,
      customer: dana.userId,
    });
    await migrator.$executeRaw`UPDATE deliveries SET status = 'DELIVERED', delivered_at = app_now() WHERE id = ${demo.deliveryId}::uuid`;
    expect(await entriesOf(demo.deliveryId)).toEqual([
      {
        type: 'DELIVERY_FEE',
        amountCents: 264,
        reason: null,
        partnerId: jamie.partnerId,
        pool: 'DEMO',
      },
      { type: 'TIP', amountCents: 500, reason: null, partnerId: jamie.partnerId, pool: 'DEMO' },
    ]);
    expect((await ledgerOf(jamie.partnerId))?.pool).toBe('DEMO');
  });
});

describe('staff entries (A60–A62, A67)', () => {
  let diego: TestPartner;
  beforeAll(async () => {
    diego = await approvedPartner(migrator, 'Diego Alvarez');
  });

  it('refuses the wrong roles, demo staff and a demo partner', async () => {
    const entry: StaffEntry = { kind: 'CASH_HANDED_IN', amount: 100, version: 0 };
    await expect(record(kitchen(), diego.partnerId, entry)).rejects.toThrow(DENIED);
    await expect(
      record(as(staff.editor, 'content_editor'), diego.partnerId, entry),
    ).rejects.toThrow(DENIED);
    await expect(record(diego.actor, diego.partnerId, entry)).rejects.toThrow(DENIED);
    await expect(record(demoAdmin(), diego.partnerId, entry)).rejects.toThrow(DENIED);
    await expect(
      record(support(), diego.partnerId, {
        kind: 'PAYOUT',
        amount: 100,
        version: 0,
        method: 'other',
        paidOn: '2026-11-20',
      }),
    ).rejects.toThrow(DENIED);
    await expect(
      record(support(), diego.partnerId, {
        kind: 'BONUS',
        amount: 100,
        version: 0,
        message: 'Thanks',
      }),
    ).rejects.toThrow(DENIED);
    expect(await record(admin(), jamie.partnerId, { ...entry, version: 2 })).toEqual({
      outcome: 'not-found',
    });
  });

  it('records cash up to what he holds, answers a stale version with the newest entry, and replays a key', async () => {
    const { deliveryId } = await delivery(diego, { status: 'PICKED_UP', cash: true });
    await migrator.$executeRaw`UPDATE deliveries SET status = 'DELIVERED', delivered_at = app_now() WHERE id = ${deliveryId}::uuid`;
    const ledger = (await ledgerOf(diego.partnerId))!;
    expect(ledger).toMatchObject({ balanceCents: 764n - 5897n, holdingCents: 5897n, version: 3 });
    expect(ledger.owedSince).not.toBeNull();
    expect(
      await record(support(), diego.partnerId, {
        kind: 'CASH_HANDED_IN',
        amount: 5898,
        version: 3,
      }),
    ).toMatchObject({
      outcome: 'over-limit',
      which: 'holding',
    });
    expect(
      await record(support(), diego.partnerId, { kind: 'CASH_HANDED_IN', amount: 100, version: 2 }),
    ).toMatchObject({
      outcome: 'changed',
      version: 3,
      latest: { kind: 'CASH_COLLECTED', amountCents: -5897, byName: null },
    });
    const key = uuid();
    const first = await record(support(), diego.partnerId, {
      kind: 'CASH_HANDED_IN',
      amount: 5133,
      version: 3,
      key,
    });
    expect(first).toMatchObject({
      outcome: 'recorded',
      balanceCents: 0,
      holdingCents: 764,
      version: 4,
    });
    expect(
      await record(support(), diego.partnerId, {
        kind: 'CASH_HANDED_IN',
        amount: 5133,
        version: 3,
        key,
      }),
    ).toMatchObject({
      outcome: 'replayed',
      entryId: first.entryId,
    });
    const staffRow = await migrator.partnerEarningStaff.findUniqueOrThrow({
      where: { earningId: first.entryId as string },
    });
    expect(staffRow).toMatchObject({
      recordedBy: staff.support,
      recordedName: 'Morgan Diaz',
      recordedRole: 'support',
    });
    expect((await ledgerOf(diego.partnerId))!.owedSince).toBeNull();
  });

  it('records one payout when two admins press at once, never more than the balance, never in the future', async () => {
    const { deliveryId } = await delivery(grace, { status: 'PICKED_UP', cash: false });
    await migrator.$executeRaw`UPDATE deliveries SET status = 'DELIVERED', delivered_at = app_now() WHERE id = ${deliveryId}::uuid`;
    const { version, balanceCents } = (await ledgerOf(grace.partnerId))!;
    const today = (
      await migrator.$queryRaw<{ d: string }[]>`SELECT app_store_date(app_now())::text AS d`
    )[0]!.d;
    const payout = (amount: number, paidOn = today) =>
      record(admin(), grace.partnerId, {
        kind: 'PAYOUT',
        amount,
        version,
        method: 'bank-transfer',
        paidOn,
      });
    expect(await payout(Number(balanceCents) + 1)).toMatchObject({
      outcome: 'over-limit',
      which: 'balance',
    });
    expect(await payout(100, '2999-01-01')).toMatchObject({
      outcome: 'over-limit',
      which: 'paid-on',
    });
    const both = await Promise.all([payout(Number(balanceCents)), payout(Number(balanceCents))]);
    expect(
      both.map((result) => String(result.outcome)).toSorted((x, y) => x.localeCompare(y)),
    ).toEqual(['changed', 'recorded']);
    expect((await ledgerOf(grace.partnerId))!.balanceCents).toBe(0n);
    expect(await payout(1)).toMatchObject({ outcome: 'changed' });
  });

  it('adjusts within $500, ties an order only when he had it, and keeps the message', async () => {
    const { order, deliveryId } = await delivery(diego, { status: 'PICKED_UP', cash: false });
    await migrator.$executeRaw`UPDATE deliveries SET status = 'DELIVERED', delivered_at = app_now() WHERE id = ${deliveryId}::uuid`;
    const { version } = (await ledgerOf(diego.partnerId))!;
    const adjust = (amount: number, orderNumber: string | null, v = version) =>
      record(admin(), diego.partnerId, {
        kind: 'ADJUSTMENT',
        amount,
        version: v,
        direction: 'take-off',
        reason: 'correction',
        message: 'Wrong tip entered.',
        orderNumber,
      });
    expect(await adjust(50_001, null)).toMatchObject({
      outcome: 'over-limit',
      which: 'adjust-cap',
    });
    const other = await readyOrder(migrator, priya.userId);
    expect(await adjust(200, other.number)).toMatchObject({ outcome: 'not-his-order' });
    expect(await adjust(200, order.number)).toMatchObject({ outcome: 'recorded' });
    const entry = await migrator.partnerEarning.findFirstOrThrow({
      where: { partnerId: diego.partnerId, type: 'ADJUSTMENT' },
    });
    expect(entry).toMatchObject({
      amountCents: -200,
      reason: 'correction',
      partnerMessage: 'Wrong tip entered.',
      deliveryId,
    });
  });
});

describe('who reads the ledger, with the service bypassed (E9, P60.1)', () => {
  it('lets a partner read his own rows only, staff the real pool, the demo admin the demo pool, and no one else', async () => {
    const count = (who: Actor) =>
      runAs(who, async (ctx) => ({
        entries: await db(ctx).partnerEarning.count(),
        luis: await db(ctx).partnerEarning.count({ where: { partnerId: luis.partnerId } }),
        demo: await db(ctx).partnerEarning.count({ where: { pool: 'DEMO' } }),
        ledgers: await db(ctx).partnerLedger.count(),
        days: await db(ctx).partnerLedgerDay.count(),
        staffRows: await db(ctx).partnerEarningStaff.count(),
      }));
    const all = await migrator.partnerEarning.count();
    const real = await migrator.partnerEarning.count({ where: { pool: 'REAL' } });
    const mine = await migrator.partnerEarning.count({ where: { partnerId: luis.partnerId } });
    expect(mine).toBeGreaterThan(0);
    expect(await count(luis.actor)).toMatchObject({
      entries: mine,
      luis: mine,
      demo: 0,
      staffRows: 0,
    });
    expect(await count(grace.actor)).toMatchObject({ luis: 0, staffRows: 0 });
    expect(await count(support())).toMatchObject({ entries: real, demo: 0 });
    expect((await count(support())).staffRows).toBeGreaterThan(0);
    expect(await count(demoAdmin())).toMatchObject({ entries: all - real, luis: 0, staffRows: 0 });
    for (const who of [kitchen(), as(staff.editor, 'content_editor'), priya.actor]) {
      expect(await count(who)).toEqual({
        entries: 0,
        luis: 0,
        demo: 0,
        ledgers: 0,
        days: 0,
        staffRows: 0,
      });
    }
    await expect(readonly.partnerEarning.count()).rejects.toThrow(DENIED);
    await expect(readonly.review.count()).rejects.toThrow(DENIED);
  });

  it("keeps the ledger append-only for the app's role, whoever runs it", async () => {
    for (const who of [admin(), system, luis.actor]) {
      await expect(
        runAs(
          who,
          (ctx) => db(ctx).$executeRaw`UPDATE partner_earnings SET amount_cents = amount_cents + 1`,
        ),
      ).rejects.toThrow(DENIED);
      await expect(
        runAs(who, (ctx) => db(ctx).$executeRaw`DELETE FROM partner_earnings`),
      ).rejects.toThrow(DENIED);
      await expect(
        runAs(who, (ctx) => db(ctx).$executeRaw`UPDATE partner_ledgers SET balance_cents = 0`),
      ).rejects.toThrow(DENIED);
    }
    await expect(
      runAs(
        system,
        (ctx) =>
          db(ctx)
            .$executeRaw`SELECT app_append_entry(NULL, 'BONUS', 1, NULL, 'bonus', 'x', NULL, NULL, NULL, 'REAL', 'k', app_now(), 'staff')`,
      ),
    ).rejects.toThrow(DENIED);
  });

  it('gives a partner the facts of deliveries he was paid for, and nothing about other deliveries', async () => {
    const { deliveryId } = await delivery(luis, { status: 'PICKED_UP', cash: false });
    await migrator.$executeRaw`UPDATE deliveries SET status = 'DELIVERED', delivered_at = app_now() WHERE id = ${deliveryId}::uuid`;
    const facts = (who: Actor) =>
      runAs(
        who,
        (ctx) =>
          db(ctx).$queryRaw<
            { order_number: string }[]
          >`SELECT * FROM app_partner_delivery_facts(ARRAY[${deliveryId}::uuid])`,
      );
    expect(await facts(luis.actor)).toHaveLength(1);
    expect(await facts(grace.actor)).toHaveLength(0);
    expect(Object.keys((await facts(luis.actor))[0]!)).not.toContain('address_text');
  });
});

describe('online sessions (E6)', () => {
  it('opens on going online and closes on any reason; a lost location stops 2 minutes after the last point', async () => {
    const lena = await approvedPartner(migrator, 'Lena Fischer');
    await goOnlineAt(migrator, lena, { km: 0.2 });
    expect(
      await migrator.partnerOnlineSession.count({
        where: { partnerId: lena.partnerId, endedAt: null },
      }),
    ).toBe(1);
    await migrator.$executeRaw`
      UPDATE delivery_partners SET is_online = false, online_session_id = NULL, last_location = NULL,
        offline_reason = 'self', offline_at = now()
      WHERE id = ${lena.partnerId}::uuid`;
    const closed = await migrator.partnerOnlineSession.findFirstOrThrow({
      where: { partnerId: lena.partnerId },
    });
    expect(closed.endReason).toBe('self');
    expect(closed.endedAt).not.toBeNull();

    await goOnlineAt(migrator, lena, { km: 0.2 });
    await migrator.$executeRaw`UPDATE partner_online_sessions SET started_at = app_now() - interval '30 minutes' WHERE partner_id = ${lena.partnerId}::uuid AND ended_at IS NULL`;
    await migrator.$executeRaw`UPDATE delivery_partners SET last_seen_at = app_now() - interval '20 minutes' WHERE id = ${lena.partnerId}::uuid`;
    await migrator.$executeRaw`
      UPDATE delivery_partners SET is_online = false, online_session_id = NULL, last_location = NULL,
        offline_reason = 'no-location', offline_at = now()
      WHERE id = ${lena.partnerId}::uuid`;
    const rows = await migrator.$queryRaw<{ minutes: number }[]>`
      SELECT round(extract(epoch FROM ended_at - started_at) / 60)::int AS minutes
      FROM partner_online_sessions WHERE partner_id = ${lena.partnerId}::uuid AND end_reason = 'no-location'`;
    expect(rows[0]!.minutes).toBe(12);
  });

  it('lets a partner read his own sessions only', async () => {
    const own = await runAs(luis.actor, (ctx) => db(ctx).partnerOnlineSession.count());
    const mine = await migrator.partnerOnlineSession.count({
      where: { partnerId: luis.partnerId },
    });
    expect(own).toBe(mine);
    expect(await runAs(support(), (ctx) => db(ctx).partnerOnlineSession.count())).toBe(0);
  });
});

describe('store days (E5)', () => {
  it('puts 11:59:59 pm and midnight on their own days, and gives the Sunday the clocks went back 25 hours', async () => {
    const rows = await migrator.$queryRaw<{ late: string; early: string; hours: number }[]>`
      SELECT app_store_date(TIMESTAMP '2026-11-21 04:59:59')::text AS late,
             app_store_date(TIMESTAMP '2026-11-21 05:00:00')::text AS early,
             (extract(epoch FROM app_store_day_start(DATE '2026-11-02') - app_store_day_start(DATE '2026-11-01')) / 3600)::int AS hours`;
    expect(rows[0]).toEqual({ late: '2026-11-20', early: '2026-11-21', hours: 25 });
  });
});

describe('a partner is never offered his own order (B10)', () => {
  it('refuses the offer row, automatic or staff', async () => {
    const own = await readyOrder(migrator, luis.userId);
    const searching = await migrator.delivery.create({
      data: { orderId: own.id, status: 'SEARCHING' },
      select: { id: true },
    });
    await expect(
      migrator.deliveryOffer.create({
        data: {
          deliveryId: searching.id,
          partnerId: luis.partnerId,
          expiresAt: new Date(Date.now() + 30_000),
        },
      }),
    ).rejects.toThrow(/own order/);
    await expect(
      migrator.deliveryOffer.create({
        data: {
          deliveryId: searching.id,
          partnerId: grace.partnerId,
          expiresAt: new Date(Date.now() + 30_000),
        },
      }),
    ).resolves.toBeTruthy();
  });
});

/** E7's check, as the platform. */
const check = () =>
  runAs(
    system,
    (ctx) =>
      db(ctx).$queryRaw<
        { result: Record<string, string[]> }[]
      >`SELECT app_reconcile_earnings() AS "result"`,
  ).then((rows) => rows[0]!.result);

describe('the nightly reconcile (E7)', () => {
  it('finds nothing on a consistent ledger and names a delivery whose entry went missing', async () => {
    await migrator.$executeRaw`
      UPDATE delivery_partners SET is_online = false, online_session_id = NULL, last_location = NULL, offline_reason = 'self'
      WHERE is_online`;
    expect(await check()).toEqual({
      deliveries: [],
      ledgers: [],
      sessions: [],
      stuckDeliveries: [],
    });
    const { deliveryId } = await delivery(grace, { status: 'PICKED_UP', cash: false });
    await migrator.$executeRaw`UPDATE deliveries SET status = 'DELIVERED', delivered_at = app_now() WHERE id = ${deliveryId}::uuid`;
    await migrator.$executeRaw`DELETE FROM partner_earnings WHERE delivery_id = ${deliveryId}::uuid AND type = 'TIP'`;
    const found = await check();
    expect(found.deliveries).toEqual([deliveryId]);
    expect(found.ledgers).toContain(grace.partnerId);
    await expect(
      runAs(admin(), (ctx) => db(ctx).$queryRaw`SELECT app_reconcile_earnings()`),
    ).rejects.toThrow(DENIED);
    await migrator.$executeRaw`SELECT app_write_delivery_entries(${deliveryId}::uuid)`;
    await migrator.$executeRaw`SELECT app_rebuild_partner_ledger(${grace.partnerId}::uuid)`;
    expect(await check()).toEqual({
      deliveries: [],
      ledgers: [],
      sessions: [],
      stuckDeliveries: [],
    });
  });
});

describe('security gate fixes (S2, S4, S5)', () => {
  it("refuses a staff key that is not a UUID, so it can never take an automatic entry's key (S4)", async () => {
    const partner = await approvedPartner(migrator, 'Key Partner');
    await expect(
      record(admin(), partner.partnerId, {
        kind: 'BONUS',
        amount: 100,
        version: 0,
        message: 'Thanks',
        key: `delivery:${uuid()}:TIP`,
      }),
    ).rejects.toThrow(/invalid entry/);
    expect(
      await record(admin(), partner.partnerId, {
        kind: 'BONUS',
        amount: 100,
        version: 0,
        message: 'Thanks',
      }),
    ).toMatchObject({ outcome: 'recorded' });
  });

  it("locks an adjustment's delivery before the ledger, the order a delivery's ending takes (S5)", async () => {
    const partner = await approvedPartner(migrator, 'Lock Partner');
    const { order, deliveryId } = await delivery(partner, { status: 'PICKED_UP', cash: false });
    await migrator.$executeRaw`UPDATE deliveries SET status = 'DELIVERED', delivered_at = app_now() WHERE id = ${deliveryId}::uuid`;
    const { version } = (await ledgerOf(partner.partnerId))!;
    let release!: () => void;
    let locked!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const isLocked = new Promise<void>((resolve) => {
      locked = resolve;
    });
    // Another transaction holds the delivery row, as an ending in progress would.
    const holder = migrator.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT 1 FROM deliveries WHERE id = ${deliveryId}::uuid FOR UPDATE`;
        locked();
        await held;
      },
      { timeout: 20_000 },
    );
    await isLocked;
    const adjusting = record(admin(), partner.partnerId, {
      kind: 'ADJUSTMENT',
      amount: 200,
      version,
      direction: 'add',
      reason: 'correction',
      message: 'Waited at the kitchen.',
      orderNumber: order.number,
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
    // While the adjustment waits for the delivery, the ledger row is free.
    await expect(
      migrator.$transaction(
        (tx) =>
          tx.$executeRaw`SELECT 1 FROM partner_ledgers WHERE partner_id = ${partner.partnerId}::uuid FOR UPDATE NOWAIT`,
      ),
    ).resolves.toBe(1);
    release();
    await holder;
    expect(await adjusting).toMatchObject({ outcome: 'recorded' });
  });

  it("refuses to settle a partner's deletion while his balance isn't zero, with a row to lock even before any entry (S2, T20)", async () => {
    const partner = await approvedPartner(migrator, 'Settle Partner');
    const settle = () =>
      runAs(
        partner.actor,
        (ctx) =>
          db(ctx).$queryRaw<{ ok: boolean }[]>`SELECT app_settle_own_partner_for_deletion() AS ok`,
      ).then((rows) => rows[0]!.ok);
    expect(await settle()).toBe(true);
    expect(await ledgerOf(partner.partnerId)).toMatchObject({ balanceCents: 0n, version: 0 });
    expect(
      await record(admin(), partner.partnerId, {
        kind: 'BONUS',
        amount: 300,
        version: 0,
        message: 'Thanks',
      }),
    ).toMatchObject({ outcome: 'recorded' });
    expect(await settle()).toBe(false);
    await goOnlineAt(migrator, partner, { km: 0.3 });
    await migrator.$executeRaw`
      UPDATE delivery_partners SET is_online = false, online_session_id = NULL, last_location = NULL, offline_reason = 'self'
      WHERE id = ${partner.partnerId}::uuid`;
    const today = (
      await migrator.$queryRaw<{ d: string }[]>`SELECT app_store_date(app_now())::text AS d`
    )[0]!.d;
    expect(
      await record(admin(), partner.partnerId, {
        kind: 'PAYOUT',
        amount: 300,
        version: 1,
        method: 'bank-transfer',
        paidOn: today,
      }),
    ).toMatchObject({ outcome: 'recorded', balanceCents: 0 });
    expect(await settle()).toBe(true);
    expect(
      await migrator.partnerOnlineSession.count({ where: { partnerId: partner.partnerId } }),
    ).toBe(0);
  });

  it("lets only the recalculation and the platform set a dish's rating (S2)", async () => {
    const dish = await migrator.menuItem.findFirstOrThrow({
      select: { id: true, ratingAvg: true },
    });
    for (const who of [admin(), as(staff.editor, 'content_editor'), kitchen()]) {
      await expect(
        runAs(
          who,
          (ctx) =>
            db(ctx)
              .$executeRaw`UPDATE menu_items SET rating_avg = 5, rating_count = 9999 WHERE id = ${dish.id}::uuid`,
        ),
      ).rejects.toThrow(DENIED);
      await expect(
        runAs(
          who,
          (ctx) =>
            db(ctx)
              .$executeRaw`UPDATE menu_items SET rating_base_avg = 5 WHERE id = ${dish.id}::uuid`,
        ),
      ).rejects.toThrow(DENIED);
    }
    // Other columns stay ADMIN's to change; the recalculation runs for anyone.
    await expect(
      runAs(
        admin(),
        (ctx) =>
          db(ctx)
            .$executeRaw`UPDATE menu_items SET prep_minutes = prep_minutes WHERE id = ${dish.id}::uuid`,
      ),
    ).resolves.toBe(1);
    await runAs(
      priya.actor,
      (ctx) => db(ctx).$executeRaw`SELECT app_recalc_dish_rating(${dish.id}::uuid)`,
    );
    await expect(
      runAs(
        system,
        (ctx) =>
          db(ctx)
            .$executeRaw`UPDATE menu_items SET rating_count = rating_count WHERE id = ${dish.id}::uuid`,
      ),
    ).resolves.toBe(1);
  });
});
