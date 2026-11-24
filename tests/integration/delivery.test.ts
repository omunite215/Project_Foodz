import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it, vi } from 'vitest';
import { PrismaClient } from '@/server/db/generated/client';
import { seedCatalog } from '../../prisma/seeding';
import { asBrowser, nextHeaders } from './support/browser';
import {
  approvedPartner,
  customerAccount,
  goOnlineAt,
  kitchenPoint,
  quietDispatch,
  readyOrder,
  type TestPartner,
} from './support/dispatch';
import { type StaffMember, staffMember } from './support/staff';

/*
 * F7's services against the real database (contract §2 to §9): the search's ten rules and its
 * order with PostGIS, the run's turns and the re-check after a missed event (lead decision on
 * question 6), misses and the third-miss offline, withdrawal on going offline, give back, staff
 * offers and take-offs with audit, the F5 hooks, the customer's card, the board's line and the
 * demo partner's practice offers.
 */

const mocks = vi.hoisted(() => ({
  send: vi.fn<(event: unknown) => Promise<unknown>>(async () => ({ ids: ['evt'] })),
  publish: vi.fn<(channel: string, event: string, data: unknown) => Promise<void>>(
    async () => undefined,
  ),
}));
vi.mock('next/headers', () => nextHeaders);
vi.mock('next/headers.js', () => nextHeaders);
vi.mock('@/server/jobs/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/jobs/client')>()),
  inngest: { send: mocks.send },
}));
vi.mock('@/server/realtime/pusher', () => ({
  publish: mocks.publish,
  signSubscription: vi.fn<() => void>(),
}));
vi.mock('@/server/security/breached-passwords', () => ({
  checkPasswordBreach: async () => 'clean',
}));
vi.mock('@/server/security/turnstile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/security/turnstile')>()),
  checkTurnstile: async () => 'passed',
}));

const dispatch = await import('@/server/modules/delivery/service');
const partners = await import('@/server/modules/partners/service');
const actions = await import('@/server/modules/delivery/actions');
const board = await import('@/server/modules/board/service');

let migrator: PrismaClient;
let morgan: StaffMember;
let alex: StaffMember;
let demoAdmin: StaffMember;
let luis: TestPartner;
let diego: TestPartner;
let grace: TestPartner;
let omar: TestPartner;
let lena: TestPartner;
let riley: TestPartner;
let priya: Awaited<ReturnType<typeof customerAccount>>;
let maya: Awaited<ReturnType<typeof customerAccount>>;

const sentEvents = (name: string) =>
  mocks.send.mock.calls
    .map(([event]) => event as { name: string; data: Record<string, unknown> })
    .filter((event) => event.name === name);

const published = (event: string) => mocks.publish.mock.calls.filter(([, name]) => name === event);

async function openSearchFor(orderId: string) {
  const opened = await dispatch.openSearch({
    orderId,
    readyEventId: crypto.randomUUID(),
    restart: false,
  });
  expect(opened).not.toBeNull();
  return opened!.deliveryId;
}

const offerOf = (offerId: string) =>
  migrator.deliveryOffer.findUniqueOrThrow({ where: { id: offerId } });
const deliveryOf = (deliveryId: string) =>
  migrator.delivery.findUniqueOrThrow({ where: { id: deliveryId } });

/** The offer's time is up by the database's clock; the expiry job's step closes it. */
async function timeOut(offerId: string, seen = true) {
  await migrator.$executeRaw`
    UPDATE delivery_offers
    SET expires_at = app_now() - interval '3 seconds',
        seen_at = CASE WHEN ${seen} THEN app_now() - interval '20 seconds' END
    WHERE id = ${offerId}::uuid`;
  return dispatch.expireOffer(offerId);
}

async function partnerNamed(id: string) {
  return [luis, diego, grace, omar, lena].find((partner) => partner.partnerId === id)?.name;
}

beforeAll(async () => {
  migrator = new PrismaClient({
    adapter: new PrismaPg({ connectionString: inject('migratorUrl') }),
  });
  await migrator.$transaction((tx) => seedCatalog(tx, { now: new Date() }), { timeout: 60_000 });
  morgan = await staffMember(migrator, 'support', { name: 'Morgan Diaz', sample: true });
  alex = await staffMember(migrator, 'kitchen', { name: 'Alex Kim', sample: true });
  demoAdmin = await staffMember(migrator, 'admin', { name: 'Demo Admin', demo: true });
  luis = await approvedPartner(migrator, 'Luis Moreno');
  diego = await approvedPartner(migrator, 'Diego Alvarez', {
    vehicle: 'SCOOTER',
    plate: '2FD 881',
  });
  grace = await approvedPartner(migrator, 'Grace Okafor', { vehicle: 'BICYCLE', plate: null });
  omar = await approvedPartner(migrator, 'Omar Haddad', { vehicle: 'CAR', plate: '5OH 318' });
  lena = await approvedPartner(migrator, 'Lena Fischer', { vehicle: 'BICYCLE', plate: null });
  riley = await approvedPartner(migrator, 'Riley Demo', { demo: true });
  priya = await customerAccount(migrator, 'Priya Shah');
  maya = await customerAccount(migrator, 'Maya Chen');
}, 180_000);

beforeEach(async () => {
  await quietDispatch(migrator);
  mocks.send.mockClear();
  mocks.publish.mockClear();
});

afterAll(async () => {
  await migrator.$disconnect();
});

describe('the search (W2, W3, W4)', () => {
  it('offers the partner waiting longest within 2 km, then walks the reaches in W3.4 order', async () => {
    // Line-up L: Lena (6.6 km), Omar (2.7 km), Grace (1.4 km), Diego (0.2 km), Luis (at the door).
    await goOnlineAt(migrator, lena, { km: 6.6, waitingMinutes: 20 });
    await goOnlineAt(migrator, omar, { km: 2.7, waitingMinutes: 15 });
    await goOnlineAt(migrator, grace, { km: 1.4, waitingMinutes: 10 });
    await goOnlineAt(migrator, diego, { km: 0.2, waitingMinutes: 7 });
    await goOnlineAt(migrator, luis, { km: 0.02, waitingMinutes: 5 });
    const order = await readyOrder(migrator, priya.userId);
    const deliveryId = await openSearchFor(order.id);

    const offered: (string | undefined)[] = [];
    for (let turn = 0; turn < 5; turn += 1) {
      const result = await dispatch.searchTurn(deliveryId);
      expect(result.kind).toBe('offered');
      if (result.kind !== 'offered') break;
      const offer = await offerOf(result.offerId);
      offered.push(await partnerNamed(offer.partnerId));
      expect(await timeOut(result.offerId)).toMatchObject({ outcome: 'expired' });
    }
    expect(offered).toEqual([
      'Grace Okafor',
      'Diego Alvarez',
      'Luis Moreno',
      'Omar Haddad',
      'Lena Fischer',
    ]);
    const first = await migrator.deliveryOffer.findFirstOrThrow({
      where: { deliveryId },
      orderBy: { createdAt: 'asc' },
    });
    // U12: the delivery fee before any discount plus the whole tip, frozen on the offer.
    expect(first).toMatchObject({ payCents: 764, tipCents: 500, reachKm: 2, kind: 'auto' });
    expect(sentEvents('delivery.offer.created')).toHaveLength(5);
    expect(published('offer.created')).toHaveLength(5);
  });

  it('applies each of the ten rules (W2.1)', async () => {
    const kitchen = await kitchenPoint(migrator);
    const far = kitchen.deliveryRadiusKm + 0.5;
    await goOnlineAt(migrator, grace, { km: 1.4, pointSecondsAgo: 60 }); // stale
    await goOnlineAt(migrator, omar, { km: far }); // out of the radius
    await goOnlineAt(migrator, lena, { km: 0.5, unseenInRow: 2 }); // paused
    await goOnlineAt(migrator, riley, { km: 0.1 }); // the demo partner, other pool
    await goOnlineAt(migrator, diego, { km: 0.3 });
    const busyOrder = await readyOrder(migrator, maya.userId);
    await migrator.delivery.create({
      data: { orderId: busyOrder.id, status: 'ASSIGNED', partnerId: diego.partnerId },
    });
    const order = await readyOrder(migrator, priya.userId);
    const deliveryId = await openSearchFor(order.id);
    const result = await dispatch.searchTurn(deliveryId);
    expect(result).toMatchObject({ kind: 'nobody', escalated: true });
    expect(await migrator.deliveryOffer.count({ where: { deliveryId } })).toBe(0);
  });

  it('gives the oldest ready order first pick when one partner fits two (W9)', async () => {
    await goOnlineAt(migrator, grace, { km: 1.4, waitingMinutes: 10 });
    await goOnlineAt(migrator, diego, { km: 0.2, waitingMinutes: 7 });
    const older = await readyOrder(migrator, priya.userId, { readyMinutes: 3 });
    const newer = await readyOrder(migrator, maya.userId, { readyMinutes: 1 });
    const olderDelivery = await openSearchFor(older.id);
    const newerDelivery = await openSearchFor(newer.id);
    const forNewer = await dispatch.searchTurn(newerDelivery);
    const forOlder = await dispatch.searchTurn(olderDelivery);
    expect(forNewer.kind === 'offered' && (await offerOf(forNewer.offerId)).partnerId).toBe(
      diego.partnerId,
    );
    expect(forOlder.kind === 'offered' && (await offerOf(forOlder.offerId)).partnerId).toBe(
      grace.partnerId,
    );
  });
});

describe('answers, misses and the re-check (W4 to W7)', () => {
  it('assigns on accept, and the next turn finds the order taken without a second offer', async () => {
    await goOnlineAt(migrator, grace, { km: 1.4, waitingMinutes: 10 });
    await goOnlineAt(migrator, diego, { km: 0.2 });
    const order = await readyOrder(migrator, priya.userId);
    const deliveryId = await openSearchFor(order.id);
    const turn = await dispatch.searchTurn(deliveryId);
    if (turn.kind !== 'offered') throw new Error('expected an offer');
    const current = await dispatch.getCurrentOffer(grace.actor, null);
    expect(current.offer).toMatchObject({
      offerId: turn.offerId,
      payText: '$7.64',
      tipText: 'includes $5.00 tip',
      dropoffText: 'Boston 02109 · 1.3 km from the kitchen',
      payment: { kind: 'cash', text: 'Cash order · collect $58.97' },
    });
    expect(JSON.stringify(current)).not.toMatch(/Faneuil|Priya|\+1617/);
    await dispatch.markOfferSeen(grace.actor, turn.offerId);
    expect(await dispatch.acceptOffer(grace.actor, turn.offerId)).toMatchObject({
      orderNumber: order.number,
      replayed: false,
    });
    // The run's wait missed the end event and timed out: it re-reads the database first.
    expect(await dispatch.searchTurn(deliveryId)).toEqual({ kind: 'done' });
    expect(await migrator.deliveryOffer.count({ where: { deliveryId } })).toBe(1);
    expect(await dispatch.acceptOffer(grace.actor, turn.offerId)).toMatchObject({ replayed: true });
    expect((await deliveryOf(deliveryId)).status).toBe('ASSIGNED');
  });

  it('refuses an offer that is not his, and an offer that ended', async () => {
    await goOnlineAt(migrator, grace, { km: 1.4 });
    const order = await readyOrder(migrator, priya.userId);
    const deliveryId = await openSearchFor(order.id);
    const turn = await dispatch.searchTurn(deliveryId);
    if (turn.kind !== 'offered') throw new Error('expected an offer');
    await expect(dispatch.getOffer(diego.actor, turn.offerId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(dispatch.acceptOffer(diego.actor, turn.offerId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await timeOut(turn.offerId);
    await expect(dispatch.acceptOffer(grace.actor, turn.offerId)).rejects.toMatchObject({
      code: 'OFFER_GONE',
      details: { why: 'expired' },
    });
  });

  it('counts misses, warns at two and takes the partner offline at three (P25)', async () => {
    await goOnlineAt(migrator, grace, { km: 1.4 });
    const results = [];
    for (let round = 0; round < 3; round += 1) {
      const order = await readyOrder(migrator, priya.userId);
      const deliveryId = await openSearchFor(order.id);
      const turn = await dispatch.searchTurn(deliveryId);
      if (turn.kind !== 'offered') throw new Error('expected an offer');
      results.push(await timeOut(turn.offerId));
      await migrator.delivery.update({ where: { id: deliveryId }, data: { status: 'CANCELLED' } });
    }
    expect(
      results.map((result) => result.outcome === 'expired' && [result.warn, result.takeOffline]),
    ).toEqual([
      [false, false],
      [true, false],
      [false, true],
    ]);
    await partners.takeOfflineForMissedOffers(grace.partnerId);
    const row = await migrator.deliveryPartner.findUniqueOrThrow({
      where: { id: grace.partnerId },
    });
    expect(row).toMatchObject({ isOnline: false, offlineReason: 'missed-offers', missedInRow: 0 });
    const notice = await migrator.notification.findFirst({
      where: { userId: grace.userId, type: 'partner.offline-missed-offers' },
    });
    expect(notice?.body).toContain('missed 3 offers in a row');
  });

  it('takes a late accept only after the offer ended, so it never stands in for an answer (S2)', async () => {
    await goOnlineAt(migrator, grace, { km: 1.4 });
    const order = await readyOrder(migrator, priya.userId);
    const deliveryId = await openSearchFor(order.id);
    const turn = await dispatch.searchTurn(deliveryId);
    if (turn.kind !== 'offered') throw new Error('expected an offer');
    await migrator.$executeRaw`
      UPDATE delivery_offers SET created_at = app_now() - interval '10 seconds' WHERE id = ${turn.offerId}::uuid`;
    const pressedAt = new Date(Date.now() - 5000).toISOString();
    expect(await dispatch.recordLateAccept(grace.actor, turn.offerId, { pressedAt })).toEqual({
      recorded: false,
    });
    expect(await timeOut(turn.offerId)).toMatchObject({ outcome: 'expired' });
    const missed = await migrator.deliveryPartner.findUniqueOrThrow({
      where: { id: grace.partnerId },
    });
    expect(missed.missedInRow).toBe(1);
    // Sent after the end, for a press before it (P28.2): kept, and the miss is taken back.
    expect(await dispatch.recordLateAccept(grace.actor, turn.offerId, { pressedAt })).toEqual({
      recorded: true,
    });
    const after = await migrator.deliveryPartner.findUniqueOrThrow({
      where: { id: grace.partnerId },
    });
    expect(after.missedInRow).toBe(0);
  });

  it('counts an offer that never reached the phone toward the pause, not the misses (W7.4)', async () => {
    await goOnlineAt(migrator, grace, { km: 1.4 });
    const order = await readyOrder(migrator, priya.userId);
    const deliveryId = await openSearchFor(order.id);
    const turn = await dispatch.searchTurn(deliveryId);
    if (turn.kind !== 'offered') throw new Error('expected an offer');
    await timeOut(turn.offerId, false);
    const row = await migrator.deliveryPartner.findUniqueOrThrow({
      where: { id: grace.partnerId },
    });
    expect(row).toMatchObject({ missedInRow: 0, unseenInRow: 1 });
    await dispatch.getCurrentOffer(grace.actor, null);
    expect(
      (await migrator.deliveryPartner.findUniqueOrThrow({ where: { id: grace.partnerId } }))
        .unseenInRow,
    ).toBe(0);
  });

  it('withdraws the open offer when the partner goes offline, and the next partner is asked (W7.1)', async () => {
    await goOnlineAt(migrator, grace, { km: 1.4, waitingMinutes: 10 });
    await goOnlineAt(migrator, diego, { km: 0.2 });
    const order = await readyOrder(migrator, priya.userId);
    const deliveryId = await openSearchFor(order.id);
    const turn = await dispatch.searchTurn(deliveryId);
    if (turn.kind !== 'offered') throw new Error('expected an offer');
    await partners.takePartnerOffline(grace.partnerId, 'self');
    expect(await offerOf(turn.offerId)).toMatchObject({
      status: 'WITHDRAWN',
      endedReason: 'withdrawn-offline',
    });
    expect(published('offer.ended').at(-1)?.[2]).toEqual({
      offerId: turn.offerId,
      why: 'withdrawn-offline',
    });
    expect(sentEvents('delivery.offer.ended').at(-1)?.data).toMatchObject({
      ending: 'withdrawn-offline',
    });
    const next = await dispatch.searchTurn(deliveryId);
    expect(next.kind === 'offered' && (await offerOf(next.offerId)).partnerId).toBe(
      diego.partnerId,
    );
  });

  it('keeps an order through a reload, and gives it back only with "Give back and go offline" (P30.4)', async () => {
    await goOnlineAt(migrator, grace, { km: 1.4 });
    const order = await readyOrder(migrator, priya.userId);
    const deliveryId = await openSearchFor(order.id);
    const turn = await dispatch.searchTurn(deliveryId);
    if (turn.kind !== 'offered') throw new Error('expected an offer');
    await dispatch.acceptOffer(grace.actor, turn.offerId);
    await expect(
      partners.setAvailability(grace.actor, null, { online: false }),
    ).rejects.toMatchObject({
      code: 'PARTNER_BUSY',
      details: { orderNumber: order.number },
    });
    expect((await deliveryOf(deliveryId)).status).toBe('ASSIGNED');
    await partners.setAvailability(grace.actor, null, { online: false, giveBack: true });
    const row = await deliveryOf(deliveryId);
    expect(row).toMatchObject({ status: 'SEARCHING', partnerId: null, courierChanged: true });
    expect(row.excludedPartnerIds).toContain(grace.partnerId);
    expect(sentEvents('dispatch.restart-requested')).toHaveLength(1);
    expect(
      (await migrator.deliveryPartner.findUniqueOrThrow({ where: { id: grace.partnerId } }))
        .isOnline,
    ).toBe(false);
  });

  it('never takes a partner holding an order offline automatically (W7.3)', async () => {
    await goOnlineAt(migrator, grace, { km: 1.4, pointSecondsAgo: 11 * 60 });
    const order = await readyOrder(migrator, priya.userId);
    await migrator.delivery.create({
      data: { orderId: order.id, status: 'ASSIGNED', partnerId: grace.partnerId },
    });
    await partners.sweepIdlePartners(new Date(Date.now() + 15 * 60_000));
    expect(
      (await migrator.deliveryPartner.findUniqueOrThrow({ where: { id: grace.partnerId } }))
        .isOnline,
    ).toBe(true);
  });
});

describe('staff (A37 to A39)', () => {
  it('sends a 60-second staff offer, withdrawing the open automatic one, with an audit row', async () => {
    await goOnlineAt(migrator, grace, { km: 1.4, waitingMinutes: 10 });
    await goOnlineAt(migrator, diego, { km: 0.2 });
    const order = await readyOrder(migrator, priya.userId);
    const deliveryId = await openSearchFor(order.id);
    const turn = await dispatch.searchTurn(deliveryId);
    if (turn.kind !== 'offered') throw new Error('expected an offer');
    const { version } = await deliveryOf(deliveryId);
    const result = await asBrowser(morgan.browser, () =>
      actions.sendStaffOfferAction({
        orderId: order.id,
        partnerId: diego.partnerId,
        expectedVersion: version,
      }),
    );
    expect(result?.serverError).toBeUndefined();
    expect(await offerOf(turn.offerId)).toMatchObject({
      status: 'WITHDRAWN',
      endedReason: 'withdrawn-staff',
    });
    const staffOffer = await migrator.deliveryOffer.findFirstOrThrow({
      where: { deliveryId, kind: 'staff' },
    });
    expect(staffOffer).toMatchObject({
      partnerId: diego.partnerId,
      offeredBy: morgan.userId,
      status: 'PENDING',
    });
    expect(staffOffer.expiresAt.getTime() - staffOffer.createdAt.getTime()).toBe(60_000);
    expect(await dispatch.searchTurn(deliveryId)).toMatchObject({
      kind: 'staffOfferOpen',
      offerId: staffOffer.id,
    });
    const entry = await migrator.auditLog.findFirst({
      where: { action: 'delivery.offer-sent', targetId: order.id },
      select: { actorId: true },
    });
    expect(entry?.actorId).toBe(morgan.userId);

    const stale = await asBrowser(morgan.browser, () =>
      actions.sendStaffOfferAction({
        orderId: order.id,
        partnerId: grace.partnerId,
        expectedVersion: version,
      }),
    );
    expect(stale?.serverError).toMatchObject({
      code: 'DELIVERY_CHANGED',
      details: { how: 'offered' },
    });
  });

  it('tags a courier who declined a staff offer in the assign list (A37.2, review S1)', async () => {
    await goOnlineAt(migrator, diego, { km: 0.05, waitingMinutes: 0 });
    const order = await readyOrder(migrator, priya.userId);
    const sent = await asBrowser(morgan.browser, () =>
      actions.sendStaffOfferAction({
        orderId: order.id,
        partnerId: diego.partnerId,
        expectedVersion: 0,
      }),
    );
    expect(sent?.serverError).toBeUndefined();
    const offer = await migrator.deliveryOffer.findFirstOrThrow({
      where: { partnerId: diego.partnerId, status: 'PENDING' },
    });
    await dispatch.declineOffer(diego.actor, offer.id, {});
    const list = await asBrowser(morgan.browser, () =>
      actions.assignableCouriersAction({ orderId: order.id }),
    );
    const row = list?.data?.rows.find((item) => item.partnerId === diego.partnerId);
    expect(row?.tags.declinedAt).toBeTruthy();
    expect(row?.words).toMatch(/ · at the kitchen · waiting under 1 min$/);
  });

  it('refuses the kitchen and the demo admin', async () => {
    await goOnlineAt(migrator, diego, { km: 0.2 });
    const order = await readyOrder(migrator, priya.userId);
    const input = { orderId: order.id, partnerId: diego.partnerId, expectedVersion: 0 };
    const kitchen = await asBrowser(alex.browser, () => actions.sendStaffOfferAction(input));
    expect(kitchen?.serverError).toMatchObject({ code: 'FORBIDDEN' });
    const demo = await asBrowser(demoAdmin.browser, () => actions.sendStaffOfferAction(input));
    expect(demo?.serverError?.code).toMatch(/DEMO|FORBIDDEN/);
    expect(await migrator.delivery.count({ where: { orderId: order.id } })).toBe(0);
  });

  it('takes an order off its courier before pickup and starts a new search at once (A38)', async () => {
    await goOnlineAt(migrator, grace, { km: 1.4 });
    const order = await readyOrder(migrator, priya.userId);
    const deliveryId = await openSearchFor(order.id);
    const turn = await dispatch.searchTurn(deliveryId);
    if (turn.kind !== 'offered') throw new Error('expected an offer');
    await dispatch.acceptOffer(grace.actor, turn.offerId);
    const { version } = await deliveryOf(deliveryId);
    const missingNote = await asBrowser(morgan.browser, () =>
      actions.takeOffCourierAction({
        orderId: order.id,
        expectedVersion: version,
        reason: 'other',
      }),
    );
    expect(missingNote?.validationErrors ?? missingNote?.serverError).toBeTruthy();
    const result = await asBrowser(morgan.browser, () =>
      actions.takeOffCourierAction({
        orderId: order.id,
        expectedVersion: version,
        reason: 'not-responding',
      }),
    );
    expect(result?.serverError).toBeUndefined();
    const row = await deliveryOf(deliveryId);
    expect(row).toMatchObject({ status: 'SEARCHING', partnerId: null });
    expect(row.excludedPartnerIds).toContain(grace.partnerId);
    const partner = await migrator.deliveryPartner.findUniqueOrThrow({
      where: { id: grace.partnerId },
    });
    expect(partner).toMatchObject({ releasedKind: 'takenOff', releasedOrderNumber: order.number });
    expect(sentEvents('dispatch.restart-requested')).toHaveLength(1);
    expect(
      published('delivery.changed').some(
        ([channel]) => channel === `private-partner-${grace.partnerId}`,
      ),
    ).toBe(true);
    expect(
      await migrator.auditLog.count({
        where: { action: 'delivery.unassigned', targetId: order.id },
      }),
    ).toBe(1);
  });

  it('finds a courier again after the search stopped (A39.4)', async () => {
    const order = await readyOrder(migrator, priya.userId, { readyMinutes: 70 });
    const deliveryId = await openSearchFor(order.id);
    expect(await dispatch.searchTurn(deliveryId)).toEqual({ kind: 'stopped' });
    const { version, searchStoppedAt } = await deliveryOf(deliveryId);
    expect(searchStoppedAt).not.toBeNull();
    const result = await asBrowser(morgan.browser, () =>
      actions.restartSearchAction({ orderId: order.id, expectedVersion: version }),
    );
    expect(result?.serverError).toBeUndefined();
    expect((await deliveryOf(deliveryId)).searchStoppedAt).toBeNull();
    expect(sentEvents('dispatch.restart-requested')).toHaveLength(1);
    const restarted = await dispatch.openSearch({
      orderId: order.id,
      readyEventId: crypto.randomUUID(),
      restart: true,
    });
    expect(restarted).not.toBeNull();
    expect(await dispatch.searchTurn(deliveryId)).toMatchObject({ kind: 'nobody' });
  });
});

describe('order changes (F5 hooks) and what people see', () => {
  it('releases the courier on a cancellation and gives back his place in line (W3.3)', async () => {
    await goOnlineAt(migrator, grace, { km: 1.4, waitingMinutes: 30 });
    const order = await readyOrder(migrator, priya.userId);
    const deliveryId = await openSearchFor(order.id);
    const turn = await dispatch.searchTurn(deliveryId);
    if (turn.kind !== 'offered') throw new Error('expected an offer');
    const before = await migrator.deliveryPartner.findUniqueOrThrow({
      where: { id: grace.partnerId },
    });
    await dispatch.acceptOffer(grace.actor, turn.offerId);
    await migrator.order.update({ where: { id: order.id }, data: { status: 'CANCELLED' } });
    await dispatch.orderChanged(order.id, 'cancelled');
    expect((await deliveryOf(deliveryId)).status).toBe('CANCELLED');
    const after = await migrator.deliveryPartner.findUniqueOrThrow({
      where: { id: grace.partnerId },
    });
    expect(after.waitingSince?.getTime()).toBe(before.waitingSince?.getTime());
    expect(after.releasedKind).toBe('cancelled');
    expect(sentEvents('delivery.assignment-ended').at(-1)?.data).toMatchObject({
      how: 'cancelled',
    });
  });

  it("shows the customer who is coming, and nobody else's order", async () => {
    await goOnlineAt(migrator, omar, { km: 0.4 });
    const order = await readyOrder(migrator, priya.userId);
    const deliveryId = await openSearchFor(order.id);
    expect(await dispatch.getCustomerDispatch(priya.actor, order.id)).toMatchObject({
      state: 'searching',
      courier: null,
    });
    const turn = await dispatch.searchTurn(deliveryId);
    if (turn.kind !== 'offered') throw new Error('expected an offer');
    expect(await dispatch.getCustomerDispatch(priya.actor, order.id)).toMatchObject({
      state: 'searching',
      courier: null,
    });
    await dispatch.acceptOffer(omar.actor, turn.offerId);
    const view = await dispatch.getCustomerDispatch(priya.actor, order.id);
    expect(view).toMatchObject({
      state: 'assigned',
      courier: { firstName: 'Omar', vehicleWords: 'Car · 5OH 318' },
      changed: false,
    });
    expect(JSON.stringify(view)).not.toMatch(/Haddad|\+1617/);
    expect(await dispatch.getCustomerDispatch(maya.actor, order.id)).toBeNull();
    expect(view?.assignedAt).toBeTruthy();

    // "Delivered by Omar.": only his first name once the order is delivered (security S8).
    await migrator.order.update({ where: { id: order.id }, data: { status: 'PICKED_UP' } });
    await dispatch.orderChanged(order.id, 'picked-up-by-courier');
    await migrator.order.update({ where: { id: order.id }, data: { status: 'DELIVERED' } });
    await dispatch.orderChanged(order.id, 'delivered');
    const delivered = await dispatch.getCustomerDispatch(priya.actor, order.id);
    expect(delivered).toMatchObject({
      state: 'delivered',
      courier: null,
      deliveredBy: { firstName: 'Omar' },
      changed: false,
    });
    expect(JSON.stringify(delivered)).not.toMatch(/5OH 318|photoUrl|rating|vehicle/);
    expect(await dispatch.courierPhotoLink(priya.actor, { orderId: order.id })).toBeNull();
    expect(delivered?.assignedAt).toBe(view?.assignedAt);
    expect(delivered?.pickedUpAt).toBeTruthy();
    expect(delivered?.deliveredAt).toBeTruthy();
    expect(JSON.stringify(delivered)).not.toMatch(/Haddad|\+1617/);
  });

  it("words the board's courier line and masks a real partner for the demo admin (A34.1, A36.5)", async () => {
    await goOnlineAt(migrator, grace, { km: 1.4 });
    const order = await readyOrder(migrator, priya.userId);
    const deliveryId = await openSearchFor(order.id);
    await dispatch.searchTurn(deliveryId);
    const facts = [{ id: order.id, status: 'READY', readyAt: new Date(Date.now() - 60_000) }];
    const line = (await dispatch.courierLines({ isDemo: false }, facts)).get(order.id);
    expect(line).toMatchObject({ state: 'offered', words: 'Offered to Grace O.', tone: 'neutral' });
    const masked = (await dispatch.courierLines({ isDemo: true }, facts)).get(order.id);
    expect(masked?.words).not.toContain('Grace');
  });

  it('puts the courier milestones on the staff timeline, masked for the demo admin (design 2.5)', async () => {
    await goOnlineAt(migrator, grace, { km: 1.4 });
    // A sample customer, so the demo admin may open the order; Grace stays a real person.
    const sample = await customerAccount(migrator, 'Sam Sample');
    await migrator.user.update({ where: { id: sample.userId }, data: { isSample: true } });
    const order = await readyOrder(migrator, sample.userId);
    const deliveryId = await openSearchFor(order.id);
    const turn = await dispatch.searchTurn(deliveryId);
    if (turn.kind !== 'offered') throw new Error('expected an offer');
    await dispatch.acceptOffer(grace.actor, turn.offerId);
    const { version } = await deliveryOf(deliveryId);
    const takeOff = await asBrowser(morgan.browser, () =>
      actions.takeOffCourierAction({
        orderId: order.id,
        expectedVersion: version,
        reason: 'too-far',
      }),
    );
    expect(takeOff?.serverError).toBeUndefined();

    const words = async (who: StaffMember) => {
      const detail = await asBrowser(who.browser, () =>
        board.getStaffOrderDetail(who.actor, order.id),
      );
      return (detail?.timeline ?? []).flatMap((entry) =>
        entry.type === 'courier' ? [entry.words] : [],
      );
    };
    expect(await words(morgan)).toEqual([
      'Looking for a courier · Foodz (automatic)',
      'Grace Okafor accepted · 1.4 km from the kitchen',
      'Morgan Diaz (Support) took it off Grace Okafor · Courier is too far away',
    ]);
    const masked = await words(demoAdmin);
    expect(masked).toHaveLength(3);
    expect(masked.join(' ')).not.toContain('Grace');
  });

  it("never shows a real courier's plate to the demo admin (S1)", async () => {
    await goOnlineAt(migrator, diego, { km: 0.2 });
    const order = await readyOrder(migrator, priya.userId);
    const deliveryId = await openSearchFor(order.id);
    const turn = await dispatch.searchTurn(deliveryId);
    if (turn.kind !== 'offered') throw new Error('expected an offer');
    await dispatch.acceptOffer(diego.actor, turn.offerId);
    const facts = [{ id: order.id, status: 'READY', readyAt: new Date(Date.now() - 60_000) }];
    const staffLine = (await dispatch.courierLines({ isDemo: false }, facts)).get(order.id);
    expect(staffLine).toMatchObject({ state: 'assigned', plate: '2FD 881' });
    expect(staffLine?.words).toContain('2FD 881');
    const demoLine = (await dispatch.courierLines({ isDemo: true }, facts)).get(order.id);
    expect(demoLine).toMatchObject({ state: 'assigned', plate: null, vehicleWords: 'Scooter' });
    expect(JSON.stringify(demoLine)).not.toContain('2FD');
  });

  it('gives the demo partner practice offers only, never in the delivery tables (P34, W12)', async () => {
    const sessionId = crypto.randomUUID();
    const practice = await dispatch.sendPracticeOffer(riley.actor, sessionId);
    expect(practice.offer).toMatchObject({
      kind: 'practice',
      payText: '$5.64',
      heading: 'Practice offer',
    });
    await expect(dispatch.sendPracticeOffer(riley.actor, sessionId)).rejects.toMatchObject({
      code: 'PRACTICE_OPEN',
    });
    expect(
      await dispatch.acceptOffer(riley.actor, practice.offer!.offerId, sessionId),
    ).toMatchObject({
      orderNumber: 'practice',
    });
    expect(await migrator.deliveryOffer.count({ where: { partnerId: riley.partnerId } })).toBe(0);
    await expect(dispatch.sendPracticeOffer(luis.actor, sessionId)).rejects.toMatchObject({
      code: 'DEMO_POOL',
    });
  });
});
