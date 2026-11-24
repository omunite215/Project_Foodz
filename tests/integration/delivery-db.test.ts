import { PrismaPg } from '@prisma/adapter-pg';
import { v7 as uuid } from 'uuid';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { db, prisma } from '@/server/db/client';
import { type Actor, runAs } from '@/server/db/context';
import { PrismaClient } from '@/server/db/generated/client';
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
 * The F7 migration at the database level (contract §8, §12): partners write deliveries and
 * offers only through the definer functions, the kitchen and the demo admin write nothing,
 * staff stay inside the guard trigger, the partial unique indexes hold, the database's clock
 * decides the grace, and an accept racing the expiry ends one way only (W6.2).
 */

let migrator: PrismaClient;
let luis: TestPartner;
let grace: TestPartner;
let customer: { userId: string; actor: Actor };

const as = (userId: string, role: string, isDemo = false): Actor =>
  ({ kind: 'user', userId, role, isDemo }) as Actor;
const staff = { support: uuid(), admin: uuid(), kitchen: uuid(), demoAdmin: uuid() };

const DENIED = /permission denied|row-level security|violates|insufficient/i;

async function searchingDelivery(orderId: string) {
  return migrator.delivery.create({
    data: { orderId, status: 'SEARCHING', searchStartedAt: new Date(), readyAt: new Date() },
    select: { id: true, version: true },
  });
}

async function openOffer(deliveryId: string, partnerId: string, secondsLeft = 25) {
  const rows = await migrator.$queryRaw<{ id: string }[]>`
    INSERT INTO delivery_offers (id, delivery_id, partner_id, status, kind, pay_cents, tip_cents,
                                 pickup_m, expires_at, created_at)
    VALUES (gen_random_uuid(), ${deliveryId}::uuid, ${partnerId}::uuid, 'PENDING', 'auto', 764, 500,
            210, app_now() + make_interval(secs => ${secondsLeft}), app_now() - interval '5 seconds')
    RETURNING id::text`;
  return rows[0]!.id;
}

const accept = (who: TestPartner, offerId: string) =>
  runAs(
    who.actor,
    (ctx) =>
      db(ctx).$queryRaw<{ result: Record<string, unknown> }[]>`
        SELECT app_accept_offer(${offerId}::uuid, 2) AS "result"`,
  ).then((rows) => rows[0]!.result);

const expireAsJob = (offerId: string) =>
  migrator.$executeRaw`
    UPDATE delivery_offers SET status = 'EXPIRED', ended_reason = 'expired'
    WHERE id = ${offerId}::uuid AND status = 'PENDING' AND app_now() >= expires_at + interval '2 seconds'`;

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
  customer = await customerAccount(migrator, 'Priya Shah');
});

beforeEach(async () => {
  await quietDispatch(migrator);
  await goOnlineAt(migrator, luis, { km: 0.2 });
  await goOnlineAt(migrator, grace, { km: 1.4, waitingMinutes: 10 });
});

afterAll(async () => {
  await migrator.$disconnect();
  await prisma.$disconnect();
});

describe('who may write deliveries and offers', () => {
  it('refuses partners writing offers or deliveries directly', async () => {
    const order = await readyOrder(migrator, customer.userId);
    const delivery = await searchingDelivery(order.id);
    const offerId = await openOffer(delivery.id, luis.partnerId);
    await expect(
      runAs(luis.actor, (ctx) =>
        db(ctx).deliveryOffer.update({
          where: { id: offerId },
          data: { status: 'ACCEPTED', endedReason: 'accepted' },
        }),
      ),
    ).rejects.toThrow(/record|not found/i);
    await expect(
      runAs(
        luis.actor,
        (ctx) =>
          db(ctx)
            .$executeRaw`UPDATE deliveries SET status = 'ASSIGNED', partner_id = ${luis.partnerId}::uuid WHERE id = ${delivery.id}::uuid`,
      ),
    ).resolves.toBe(0);
    const row = await migrator.delivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(row.status).toBe('SEARCHING');
  });

  it('shows a partner only his own offers', async () => {
    const order = await readyOrder(migrator, customer.userId);
    const delivery = await searchingDelivery(order.id);
    const offerId = await openOffer(delivery.id, luis.partnerId);
    const seenByGrace = await runAs(grace.actor, (ctx) =>
      db(ctx).deliveryOffer.findMany({ where: { id: offerId }, select: { id: true } }),
    );
    const seenByLuis = await runAs(luis.actor, (ctx) =>
      db(ctx).deliveryOffer.findMany({ where: { id: offerId }, select: { id: true } }),
    );
    expect(seenByGrace).toHaveLength(0);
    expect(seenByLuis).toHaveLength(1);
  });

  it('lets the kitchen and the demo admin change nothing', async () => {
    const order = await readyOrder(migrator, customer.userId);
    const delivery = await searchingDelivery(order.id);
    for (const actor of [as(staff.kitchen, 'kitchen'), as(staff.demoAdmin, 'admin', true)]) {
      await expect(
        runAs(
          actor,
          (ctx) =>
            db(ctx)
              .$executeRaw`UPDATE deliveries SET version = version + 1 WHERE id = ${delivery.id}::uuid`,
        ),
      ).resolves.toBe(0);
    }
  });

  it('keeps staff inside their steps: no direct assignment, the version always rises', async () => {
    const order = await readyOrder(migrator, customer.userId);
    const delivery = await searchingDelivery(order.id);
    const support = as(staff.support, 'support');
    await expect(
      runAs(
        support,
        (ctx) =>
          db(ctx)
            .$executeRaw`UPDATE deliveries SET status = 'ASSIGNED', partner_id = ${luis.partnerId}::uuid, version = version + 1 WHERE id = ${delivery.id}::uuid`,
      ),
    ).rejects.toThrow(DENIED);
    await expect(
      runAs(
        support,
        (ctx) =>
          db(ctx)
            .$executeRaw`UPDATE deliveries SET search_stopped_at = now() WHERE id = ${delivery.id}::uuid`,
      ),
    ).rejects.toThrow(DENIED);
    await expect(
      runAs(
        support,
        (ctx) =>
          db(ctx)
            .$executeRaw`UPDATE deliveries SET search_stopped_at = now(), version = version + 1 WHERE id = ${delivery.id}::uuid`,
      ),
    ).resolves.toBe(1);
  });

  it('lets staff send only their own open offers of a minute or less', async () => {
    const order = await readyOrder(migrator, customer.userId);
    const delivery = await searchingDelivery(order.id);
    const support = as(staff.support, 'support');
    await expect(
      runAs(
        support,
        (ctx) =>
          db(ctx).$executeRaw`
          INSERT INTO delivery_offers (id, delivery_id, partner_id, status, kind, offered_by, expires_at)
          VALUES (gen_random_uuid(), ${delivery.id}::uuid, ${luis.partnerId}::uuid, 'PENDING', 'staff',
                  ${staff.admin}::uuid, app_now() + interval '60 seconds')`,
      ),
    ).rejects.toThrow(DENIED);
    await expect(
      runAs(
        support,
        (ctx) =>
          db(ctx).$executeRaw`
          INSERT INTO delivery_offers (id, delivery_id, partner_id, status, kind, offered_by, expires_at)
          VALUES (gen_random_uuid(), ${delivery.id}::uuid, ${luis.partnerId}::uuid, 'PENDING', 'staff',
                  ${staff.support}::uuid, app_now() + interval '10 minutes')`,
      ),
    ).rejects.toThrow(DENIED);
    await expect(
      runAs(
        support,
        (ctx) =>
          db(ctx).$executeRaw`
          INSERT INTO delivery_offers (id, delivery_id, partner_id, status, kind, offered_by, expires_at)
          VALUES (gen_random_uuid(), ${delivery.id}::uuid, ${luis.partnerId}::uuid, 'PENDING', 'staff',
                  ${staff.support}::uuid, app_now() + interval '60 seconds')`,
      ),
    ).resolves.toBe(1);
  });
});

describe('the partial unique indexes (B2)', () => {
  it('allow one open offer per order and one per partner', async () => {
    const first = await readyOrder(migrator, customer.userId);
    const second = await readyOrder(migrator, customer.userId);
    const a = await searchingDelivery(first.id);
    const b = await searchingDelivery(second.id);
    await openOffer(a.id, luis.partnerId);
    await expect(openOffer(a.id, grace.partnerId)).rejects.toThrow(/unique|duplicate/i);
    await expect(openOffer(b.id, luis.partnerId)).rejects.toThrow(/unique|duplicate/i);
  });

  it('allow one active order per partner, and the same partner offered an order twice', async () => {
    const first = await readyOrder(migrator, customer.userId);
    const second = await readyOrder(migrator, customer.userId);
    await migrator.delivery.create({
      data: { orderId: first.id, status: 'ASSIGNED', partnerId: luis.partnerId },
    });
    await expect(
      migrator.delivery.create({
        data: { orderId: second.id, status: 'ASSIGNED', partnerId: luis.partnerId },
      }),
    ).rejects.toThrow(/unique|duplicate/i);
    const third = await readyOrder(migrator, customer.userId);
    const delivery = await searchingDelivery(third.id);
    const offerId = await openOffer(delivery.id, grace.partnerId);
    await expireAsJob(offerId);
    await migrator.$executeRaw`UPDATE delivery_offers SET status = 'EXPIRED', ended_reason = 'expired' WHERE id = ${offerId}::uuid`;
    await expect(openOffer(delivery.id, grace.partnerId)).resolves.toBeTruthy();
  });
});

describe('accepting an offer (W6)', () => {
  it('assigns the order once, answers a repeat the same, and refuses anyone else', async () => {
    const order = await readyOrder(migrator, customer.userId);
    const delivery = await searchingDelivery(order.id);
    const offerId = await openOffer(delivery.id, luis.partnerId);
    expect(await accept(grace, offerId)).toEqual({ outcome: 'not-found' });
    expect(await accept(luis, offerId)).toMatchObject({
      outcome: 'accepted',
      orderNumber: order.number,
    });
    expect(await accept(luis, offerId)).toMatchObject({ outcome: 'replayed' });
    const row = await migrator.delivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(row).toMatchObject({
      status: 'ASSIGNED',
      partnerId: luis.partnerId,
      partnerFeeCents: 764,
      tipCents: 500,
    });
    const events = await migrator.orderEvent.findMany({
      where: { orderId: order.id, type: 'courier-assigned' },
    });
    expect(events).toHaveLength(1);
  });

  it('takes an answer until the end plus 2 seconds by the database clock, and none after', async () => {
    const order = await readyOrder(migrator, customer.userId);
    const delivery = await searchingDelivery(order.id);
    const late = await openOffer(delivery.id, luis.partnerId, -3);
    expect(await accept(luis, late)).toEqual({ outcome: 'gone', why: 'expired' });
    await expireAsJob(late);
    const closed = await migrator.deliveryOffer.findUniqueOrThrow({ where: { id: late } });
    expect(closed).toMatchObject({ status: 'EXPIRED', endedReason: 'expired' });
    const inGrace = await openOffer(delivery.id, luis.partnerId, -1);
    expect(await accept(luis, inGrace)).toMatchObject({ outcome: 'accepted' });
  });

  it('ends a race between the accept and the expiry one way only, in either order (W6.2)', async () => {
    const modes = ['together', 'together', 'expiry-first', 'accept-first'] as const;
    const outcomes = [];
    for (const mode of modes) {
      const order = await readyOrder(migrator, customer.userId);
      const delivery = await searchingDelivery(order.id);
      // At the edge of the grace for the race; clearly inside or past it for the ordered runs.
      const secondsLeft = { together: -2, 'expiry-first': -2.5, 'accept-first': -1 }[mode];
      const offerId = await openOffer(delivery.id, luis.partnerId, secondsLeft);
      let accepted: Record<string, unknown>;
      if (mode === 'together') {
        [accepted] = await Promise.all([accept(luis, offerId), expireAsJob(offerId)]);
      } else if (mode === 'expiry-first') {
        await expireAsJob(offerId);
        accepted = await accept(luis, offerId);
      } else {
        accepted = await accept(luis, offerId);
        await expireAsJob(offerId);
      }
      const offer = await migrator.deliveryOffer.findUniqueOrThrow({ where: { id: offerId } });
      const row = await migrator.delivery.findUniqueOrThrow({ where: { id: delivery.id } });
      outcomes.push({ mode, accepted, offer: offer.status, delivery: row.status });
      await migrator.$executeRaw`UPDATE deliveries SET status = 'CANCELLED', partner_id = NULL WHERE id = ${delivery.id}::uuid`;
    }
    // Each run ended one way only: assigned with the offer accepted, or still searching with
    // the offer expired and the accept refused.
    const oneWay = outcomes.map((outcome) =>
      outcome.offer === 'ACCEPTED'
        ? outcome.delivery === 'ASSIGNED' && outcome.accepted.outcome === 'accepted'
        : outcome.offer === 'EXPIRED' &&
          outcome.delivery === 'SEARCHING' &&
          outcome.accepted.outcome === 'gone',
    );
    expect(oneWay).toEqual([true, true, true, true]);
    expect(outcomes.find((outcome) => outcome.mode === 'expiry-first')?.offer).toBe('EXPIRED');
    expect(outcomes.find((outcome) => outcome.mode === 'accept-first')?.offer).toBe('ACCEPTED');
  });

  it('refuses a partner who went offline or holds another order', async () => {
    const first = await readyOrder(migrator, customer.userId);
    await migrator.delivery.create({
      data: { orderId: first.id, status: 'ASSIGNED', partnerId: grace.partnerId },
    });
    const order = await readyOrder(migrator, customer.userId);
    const delivery = await searchingDelivery(order.id);
    const offerId = await openOffer(delivery.id, grace.partnerId);
    expect(await accept(grace, offerId)).toEqual({ outcome: 'busy', orderNumber: first.number });
  });

  it('records a decline, excludes the partner and keeps the outcome', async () => {
    const order = await readyOrder(migrator, customer.userId);
    const delivery = await searchingDelivery(order.id);
    const offerId = await openOffer(delivery.id, luis.partnerId);
    const [result] = await runAs(
      luis.actor,
      (ctx) =>
        db(ctx).$queryRaw<{ result: Record<string, unknown> }[]>`
        SELECT app_decline_offer(${offerId}::uuid, NULL, 2) AS "result"`,
    );
    expect(result?.result).toMatchObject({ outcome: 'declined' });
    const row = await migrator.delivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(row.excludedPartnerIds).toContain(luis.partnerId);
    expect(row.version).toBe(delivery.version + 1);
  });
});

describe('giving back and the partner bookkeeping', () => {
  it('gives an order back only before pickup, and sends the partner to the back of the line', async () => {
    const order = await readyOrder(migrator, customer.userId);
    const delivery = await migrator.delivery.create({
      data: { orderId: order.id, status: 'ASSIGNED', partnerId: luis.partnerId },
    });
    const giveBack = (who: TestPartner) =>
      runAs(
        who.actor,
        (ctx) =>
          db(ctx).$queryRaw<{ result: Record<string, unknown> }[]>`
          SELECT app_give_back(${delivery.id}::uuid, 'vehicle') AS "result"`,
      ).then((rows) => rows[0]!.result);
    expect(await giveBack(grace)).toEqual({ outcome: 'not-assigned' });
    const before = await migrator.deliveryPartner.findUniqueOrThrow({
      where: { id: luis.partnerId },
    });
    expect(await giveBack(luis)).toMatchObject({ outcome: 'gave-back' });
    const row = await migrator.delivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(row).toMatchObject({ status: 'SEARCHING', partnerId: null, courierChanged: true });
    expect(row.excludedPartnerIds).toContain(luis.partnerId);
    const after = await migrator.deliveryPartner.findUniqueOrThrow({
      where: { id: luis.partnerId },
    });
    expect(after.waitingSince!.getTime()).toBeGreaterThan(before.waitingSince!.getTime());

    const picked = await readyOrder(migrator, customer.userId);
    const carried = await migrator.delivery.create({
      data: { orderId: picked.id, status: 'PICKED_UP', partnerId: luis.partnerId },
    });
    const [closed] = await runAs(
      luis.actor,
      (ctx) =>
        db(ctx).$queryRaw<{ result: Record<string, unknown> }[]>`
        SELECT app_give_back(${carried.id}::uuid, 'vehicle') AS "result"`,
    );
    expect(closed?.result).toMatchObject({ outcome: 'closed', status: 'PICKED_UP' });
  });

  it('stamps the wait and the point itself; a partner can set neither', async () => {
    await expect(
      runAs(
        luis.actor,
        (ctx) =>
          db(ctx)
            .$executeRaw`UPDATE delivery_partners SET waiting_since = now() - interval '2 hours' WHERE id = ${luis.partnerId}::uuid`,
      ),
    ).rejects.toThrow(DENIED);
    await migrator.$executeRaw`UPDATE delivery_partners SET unseen_in_row = 1, last_point_at = app_now() - interval '1 minute' WHERE id = ${luis.partnerId}::uuid`;
    await runAs(
      luis.actor,
      (ctx) =>
        db(ctx)
          .$executeRaw`UPDATE delivery_partners SET last_seen_at = now() WHERE id = ${luis.partnerId}::uuid`,
    );
    const row = await migrator.deliveryPartner.findUniqueOrThrow({ where: { id: luis.partnerId } });
    expect(row.unseenInRow).toBe(0);
    expect(Date.now() - row.lastPointAt!.getTime()).toBeLessThan(10_000);
  });
});
