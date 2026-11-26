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
 * The F8 migration at the database level (contract §4, §5, §11): the courier's steps through the
 * definer functions, the code lock under concurrency, who may read a code and the path, staff
 * finishing a stuck delivery, the bot flag and the 30-day retention cut.
 */

let migrator: PrismaClient;
let luis: TestPartner;
let grace: TestPartner;
let priya: { userId: string; actor: Actor };
let maya: { userId: string; actor: Actor };
const staff = { support: uuid(), admin: uuid(), kitchen: uuid() };
const as = (userId: string, role: string, isDemo = false): Actor =>
  ({ kind: 'user', userId, role, isDemo }) as Actor;
const support = () => as(staff.support, 'support');
const admin = () => as(staff.admin, 'admin');
const DENIED = /permission denied|row-level security|violates|insufficient/i;
const CODE = '4071';

const call = (
  who: Actor,
  query: (
    ctx: Parameters<Parameters<typeof runAs>[1]>[0],
  ) => Promise<{ result: Record<string, unknown> }[]>,
) => runAs(who, query).then((rows) => rows[0]!.result);

async function assigned(options: { cash?: boolean } = {}) {
  const order = await readyOrder(migrator, priya.userId, { cash: options.cash ?? true });
  const delivery = await migrator.delivery.create({
    data: {
      orderId: order.id,
      status: 'ASSIGNED',
      partnerId: luis.partnerId,
      partnerFeeCents: 764,
      tipCents: 500,
      assignedAt: new Date(),
    },
    select: { id: true },
  });
  return { order, deliveryId: delivery.id };
}

const pickUp = (who: TestPartner, deliveryId: string) =>
  call(
    who.actor,
    (ctx) =>
      db(ctx)
        .$queryRaw`SELECT app_pick_up(${deliveryId}::uuid, 'sealed', ${deliveryCodeHash(deliveryId, CODE)}, false) AS "result"`,
  );

const handOver = (deliveryId: string, code: string, cash = true) =>
  call(
    luis.actor,
    (ctx) =>
      db(ctx)
        .$queryRaw`SELECT app_hand_over(${deliveryId}::uuid, ${deliveryCodeHash(deliveryId, code)}, ${cash}, false) AS "result"`,
  );

const confirm = (who: Actor, deliveryId: string, version: number, cash = true) =>
  call(
    who,
    (ctx) =>
      db(ctx)
        .$queryRaw`SELECT app_staff_confirm_handover(${deliveryId}::uuid, ${version}::int, 'customer-confirmed', ${cash}, 300, NULL) AS "result"`,
  );

beforeAll(async () => {
  migrator = new PrismaClient({
    adapter: new PrismaPg({ connectionString: inject('migratorUrl') }),
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
    ],
  });
  luis = await approvedPartner(migrator, 'Luis Moreno');
  grace = await approvedPartner(migrator, 'Grace Okafor', { vehicle: 'BICYCLE', plate: null });
  priya = await customerAccount(migrator, 'Priya Shah');
  maya = await customerAccount(migrator, 'Maya Chen');
});

beforeEach(async () => {
  await quietDispatch(migrator);
  await goOnlineAt(migrator, luis, { km: 0.05 });
});

afterAll(async () => {
  await migrator.$disconnect();
  await prisma.$disconnect();
});

describe('picking up (P38, B1)', () => {
  it('moves the delivery and the order together, once, and only for the holder of a ready order', async () => {
    const { order, deliveryId } = await assigned();
    expect(await pickUp(grace, deliveryId)).toEqual({ outcome: 'not-assigned' });
    await migrator.order.update({ where: { id: order.id }, data: { status: 'PREPARING' } });
    expect(await pickUp(luis, deliveryId)).toMatchObject({
      outcome: 'not-ready',
      orderNumber: order.number,
    });
    await migrator.order.update({ where: { id: order.id }, data: { status: 'READY' } });
    expect(await pickUp(luis, deliveryId)).toMatchObject({ outcome: 'picked-up' });
    expect(await pickUp(luis, deliveryId)).toMatchObject({ outcome: 'replayed' });
    const [row, placed] = [
      await migrator.delivery.findUniqueOrThrow({ where: { id: deliveryId } }),
      await migrator.order.findUniqueOrThrow({ where: { id: order.id } }),
    ];
    expect([row.status, placed.status]).toEqual(['PICKED_UP', 'PICKED_UP']);
    expect(await migrator.deliveryCode.count({ where: { deliveryId } })).toBe(1);
  });
});

describe('the delivery code (L6, P42, U4)', () => {
  it("is readable by the order's customer only: never the courier, staff or another customer", async () => {
    const { deliveryId } = await assigned();
    await pickUp(luis, deliveryId);
    const read = (who: Actor) =>
      runAs(who, (ctx) => db(ctx).deliveryCode.count({ where: { deliveryId } }));
    expect(await read(priya.actor)).toBe(1);
    expect(await read(maya.actor)).toBe(0);
    expect(await read(luis.actor)).toBe(0);
    expect(await read(support())).toBe(0);
    expect(await read(admin())).toBe(0);
    await expect(
      runAs(
        priya.actor,
        (ctx) => db(ctx).$executeRaw`UPDATE delivery_codes SET code_hash = repeat('0', 64)`,
      ),
    ).resolves.toBe(0);
  });

  it('counts wrong tries, locks at the fifth, and five sent at once stay five', async () => {
    const { deliveryId } = await assigned();
    await pickUp(luis, deliveryId);
    expect(await handOver(deliveryId, '1111')).toMatchObject({ outcome: 'wrong', triesLeft: 4 });
    // Five different wrong codes (the same one again within seconds isn't counted, gate S8).
    const wrongCodes = ['2222', '3333', '4444', '5555', '6666'];
    const together = await Promise.all(wrongCodes.map((code) => handOver(deliveryId, code)));
    const outcomes = together.map((result) => result.outcome);
    expect(outcomes.filter((outcome) => outcome === 'locked')).toHaveLength(2);
    const row = await migrator.delivery.findUniqueOrThrow({ where: { id: deliveryId } });
    expect(row.otpWrongTries).toBe(5);
    expect(row.otpLockedAt).not.toBeNull();
    expect(await handOver(deliveryId, CODE)).toEqual({ outcome: 'locked' });
    const events = await migrator.orderEvent.findMany({
      where: { type: { in: ['otp-wrong', 'otp-locked'] } },
    });
    for (const code of wrongCodes) expect(JSON.stringify(events)).not.toContain(code);
  });

  it("doesn't count a re-send of the same wrong code within seconds (gate S8)", async () => {
    const { deliveryId } = await assigned();
    await pickUp(luis, deliveryId);
    expect(await handOver(deliveryId, '1111')).toMatchObject({ outcome: 'wrong', triesLeft: 4 });
    expect(await handOver(deliveryId, '1111')).toMatchObject({
      outcome: 'wrong',
      triesLeft: 4,
      repeat: true,
    });
    expect(await handOver(deliveryId, '2222')).toMatchObject({ outcome: 'wrong', triesLeft: 3 });
    let row = await migrator.delivery.findUniqueOrThrow({ where: { id: deliveryId } });
    expect(row.otpWrongTries).toBe(2);
    // After the window the same wrong code counts again.
    await migrator.$executeRaw`UPDATE delivery_codes SET last_wrong_at = last_wrong_at - interval '20 seconds' WHERE delivery_id = ${deliveryId}::uuid`;
    expect(await handOver(deliveryId, '2222')).toMatchObject({ outcome: 'wrong', triesLeft: 2 });
    row = await migrator.delivery.findUniqueOrThrow({ where: { id: deliveryId } });
    expect(row.otpWrongTries).toBe(3);
    const events = await migrator.orderEvent.findMany({
      where: { orderId: row.orderId, type: 'otp-wrong' },
    });
    expect(events).toHaveLength(3);
  });

  it('needs the cash tick, then delivers: order paid, code deleted, end time stamped', async () => {
    const { order, deliveryId } = await assigned({ cash: true });
    await pickUp(luis, deliveryId);
    expect(await handOver(deliveryId, CODE, false)).toEqual({ outcome: 'cash-required' });
    expect(await handOver(deliveryId, CODE, true)).toMatchObject({
      outcome: 'delivered',
      payCents: 764,
      cashCents: 5897,
    });
    expect(await handOver(deliveryId, CODE, true)).toMatchObject({
      outcome: 'delivered',
      replayed: true,
    });
    const row = await migrator.delivery.findUniqueOrThrow({ where: { id: deliveryId } });
    const placed = await migrator.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(row).toMatchObject({ status: 'DELIVERED', handoverHow: 'code' });
    expect(row.endedAt).not.toBeNull();
    expect(placed).toMatchObject({ status: 'DELIVERED', paymentStatus: 'PAID' });
    expect(await migrator.deliveryCode.count({ where: { deliveryId } })).toBe(0);
  });
});

describe('staff finishing a stuck delivery (A50)', () => {
  it('lets support confirm only after a lock or a run-out wait; admin always; nobody on an old version', async () => {
    const { deliveryId } = await assigned();
    await pickUp(luis, deliveryId);
    const { version } = await migrator.delivery.findUniqueOrThrow({ where: { id: deliveryId } });
    expect(await confirm(support(), deliveryId, version)).toEqual({ outcome: 'not-stuck' });
    expect(await confirm(support(), deliveryId, version - 1)).toMatchObject({ outcome: 'changed' });
    await expect(confirm(as(staff.kitchen, 'kitchen'), deliveryId, version)).rejects.toThrow(
      DENIED,
    );
    await migrator.$executeRaw`UPDATE deliveries SET no_answer_since = app_now() - interval '6 minutes' WHERE id = ${deliveryId}::uuid`;
    expect(await confirm(support(), deliveryId, version)).toMatchObject({
      outcome: 'delivered',
      how: 'staff-confirmed',
    });
    const second = await assigned();
    await pickUp(luis, second.deliveryId);
    const fresh = await migrator.delivery.findUniqueOrThrow({ where: { id: second.deliveryId } });
    expect(await confirm(admin(), second.deliveryId, fresh.version)).toMatchObject({
      how: 'admin-override',
    });
  });

  it('fixes the support wait at 5 minutes and lets support cancel only a stuck delivery (S4, S5)', async () => {
    const { deliveryId } = await assigned();
    await pickUp(luis, deliveryId);
    await migrator.$executeRaw`UPDATE deliveries SET no_answer_since = app_now() - interval '2 minutes' WHERE id = ${deliveryId}::uuid`;
    const { version } = await migrator.delivery.findUniqueOrThrow({ where: { id: deliveryId } });
    const shortWait = await call(
      support(),
      (ctx) =>
        db(ctx)
          .$queryRaw`SELECT app_staff_confirm_handover(${deliveryId}::uuid, ${version}::int, 'customer-confirmed', true, 1, NULL) AS "result"`,
    );
    expect(shortWait).toEqual({ outcome: 'not-stuck' });
    const early = await call(
      support(),
      (ctx) =>
        db(ctx)
          .$queryRaw`SELECT app_staff_cancel_unreachable(${deliveryId}::uuid, ${version}::int, NULL) AS "result"`,
    );
    expect(early).toEqual({ outcome: 'not-stuck' });
    await migrator.$executeRaw`UPDATE deliveries SET problem_kind = 'address', problem_at = app_now() WHERE id = ${deliveryId}::uuid`;
    const stuck = await call(
      support(),
      (ctx) =>
        db(ctx)
          .$queryRaw`SELECT app_staff_cancel_unreachable(${deliveryId}::uuid, ${version}::int, NULL) AS "result"`,
    );
    expect(stuck).toMatchObject({ outcome: 'cancelled' });
  });

  it('cancels and brings it back with "Customer couldn\'t be reached"', async () => {
    const { order, deliveryId } = await assigned();
    await pickUp(luis, deliveryId);
    await migrator.$executeRaw`UPDATE deliveries SET otp_locked_at = app_now(), otp_wrong_tries = 5 WHERE id = ${deliveryId}::uuid`;
    const { version } = await migrator.delivery.findUniqueOrThrow({ where: { id: deliveryId } });
    const result = await call(
      support(),
      (ctx) =>
        db(ctx)
          .$queryRaw`SELECT app_staff_cancel_unreachable(${deliveryId}::uuid, ${version}::int, NULL) AS "result"`,
    );
    expect(result).toMatchObject({ outcome: 'cancelled' });
    const placed = await migrator.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(placed).toMatchObject({
      status: 'CANCELLED',
      cancelReason: 'staff',
      cancelCode: 'customer-unreachable',
    });
    expect(await migrator.deliveryCode.count({ where: { deliveryId } })).toBe(0);
  });
});

describe('the path, the bot and retention (L8, U14)', () => {
  it('keeps the path from the customer and the courier', async () => {
    const { deliveryId } = await assigned();
    await migrator.$executeRaw`
      INSERT INTO delivery_locations (delivery_id, lat, lng, recorded_at) VALUES (${deliveryId}::uuid, 42.35, -71.05, now())`;
    const read = (who: Actor) =>
      runAs(who, (ctx) => db(ctx).deliveryLocation.count({ where: { deliveryId } }));
    expect(await read(priya.actor)).toBe(0);
    expect(await read(luis.actor)).toBe(0);
    expect(await read(support())).toBe(1);
    await expect(
      runAs(
        luis.actor,
        (ctx) =>
          db(ctx)
            .$executeRaw`INSERT INTO delivery_locations (delivery_id, lat, lng) VALUES (${deliveryId}::uuid, 1, 1)`,
      ),
    ).rejects.toThrow(DENIED);
  });

  it('lets only the platform make a bot', async () => {
    await expect(
      runAs(
        luis.actor,
        (ctx) =>
          db(ctx)
            .$executeRaw`UPDATE delivery_partners SET is_bot = true WHERE id = ${luis.partnerId}::uuid`,
      ),
    ).rejects.toThrow(DENIED);
  });

  it('deletes the path 30 days after a delivery ended, and keeps a 29-day-old one', async () => {
    const old = await assigned();
    await migrator.$executeRaw`UPDATE deliveries SET status = 'CANCELLED', partner_id = NULL, ended_at = app_now() - interval '31 days', route_geojson = '{}'::jsonb WHERE id = ${old.deliveryId}::uuid`;
    const recent = await assigned();
    await migrator.$executeRaw`UPDATE deliveries SET status = 'CANCELLED', partner_id = NULL, ended_at = app_now() - interval '29 days' WHERE id = ${recent.deliveryId}::uuid`;
    for (const id of [old.deliveryId, recent.deliveryId]) {
      await migrator.$executeRaw`INSERT INTO delivery_locations (delivery_id, lat, lng) VALUES (${id}::uuid, 42.35, -71.05)`;
    }
    const { purgeOldLocations } = await import('@/server/modules/tracking/service');
    await purgeOldLocations();
    expect(await migrator.deliveryLocation.count({ where: { deliveryId: old.deliveryId } })).toBe(
      0,
    );
    expect(
      await migrator.deliveryLocation.count({ where: { deliveryId: recent.deliveryId } }),
    ).toBe(1);
    expect(
      (await migrator.delivery.findUniqueOrThrow({ where: { id: old.deliveryId } })).routeGeoJson,
    ).toBeNull();
  });
});
