import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it, vi } from 'vitest';
import { channels } from '@/lib/realtime/channels';
import { PrismaClient } from '@/server/db/generated/client';
import { seedCatalog } from '../../prisma/seeding';
import { ensureDemoCourier } from '../../prisma/seeding/partners';
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
import { signedInAgo, type StaffMember, staffMember } from './support/staff';

/*
 * F8's services against the real database (contract §2 to §10): the courier's steps, the code on
 * the customer's page only, the location pipeline's publishing and stages, the door problems,
 * staff finishing a stuck delivery, the channels' refusals, the live map's pools, the board's
 * lines, the estimate and the demo run.
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

const tracking = await import('@/server/modules/tracking/service');
const actions = await import('@/server/modules/tracking/actions');
const { canSubscribe } = await import('@/server/modules/realtime/service');
const { redis } = await import('@/server/redis');

let migrator: PrismaClient;
let morgan: StaffMember;
let daniel: StaffMember;
let demoAdmin: StaffMember;
let luis: TestPartner;
let priya: Awaited<ReturnType<typeof customerAccount>>;
let maya: Awaited<ReturnType<typeof customerAccount>>;

const sent = (name: string) =>
  mocks.send.mock.calls
    .map(([event]) => event as { name: string; data: Record<string, unknown> })
    .filter((event) => event.name === name);
const published = (event: string) => mocks.publish.mock.calls.filter(([, name]) => name === event);

async function heldOrder(options: { cash?: boolean } = {}) {
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

const point = (lat: number, lng: number) => ({ lat, lng, heading: 90, speed: 8 });

const sub = (userId: string, role: string, isDemo = false, twoFactorEnabled = true) =>
  ({ userId, role, isDemo, twoFactorEnabled }) as Parameters<typeof canSubscribe>[0];

beforeAll(async () => {
  migrator = new PrismaClient({
    adapter: new PrismaPg({ connectionString: inject('migratorUrl') }),
  });
  await migrator.$transaction((tx) => seedCatalog(tx, { now: new Date() }), { timeout: 60_000 });
  morgan = await staffMember(migrator, 'support', { name: 'Morgan Diaz', sample: true });
  daniel = await staffMember(migrator, 'admin', { name: 'Foodz Admin' });
  demoAdmin = await staffMember(migrator, 'admin', { name: 'Demo Admin', demo: true });
  luis = await approvedPartner(migrator, 'Luis Moreno');
  priya = await customerAccount(migrator, 'Priya Shah');
  maya = await customerAccount(migrator, 'Maya Chen');
}, 180_000);

beforeEach(async () => {
  await quietDispatch(migrator);
  await goOnlineAt(migrator, luis, { km: 1.2 });
  const keys = await redis.keys('pub:*');
  if (keys.length > 0) await redis.del(...keys);
  mocks.send.mockClear();
  mocks.publish.mockClear();
});

afterAll(async () => {
  await migrator.$disconnect();
});

describe("the courier's steps (P37 to P42)", () => {
  it("arrives at the kitchen by position, picks up, and hands over with the customer's code", async () => {
    const { order, deliveryId } = await heldOrder();
    const kitchen = await kitchenPoint(migrator);
    expect(await tracking.getCustomerTracking(priya.actor, order.id)).toMatchObject({
      stage: 'toKitchen',
      code: null,
      courierPoint: null,
    });
    await tracking.pointAccepted({
      partnerId: luis.partnerId,
      isDemo: false,
      point: point(kitchen.lat + 0.0004, kitchen.lng),
      acceptedAt: new Date(),
    });
    expect((await migrator.delivery.findUniqueOrThrow({ where: { id: deliveryId } })).status).toBe(
      'AT_RESTAURANT',
    );
    expect(published('courier.location')).toHaveLength(0);

    expect(await tracking.pickUp(luis.actor, deliveryId, {})).toMatchObject({ replayed: false });
    expect(await tracking.pickUp(luis.actor, deliveryId, {})).toMatchObject({ replayed: true });
    const mine = await tracking.getCustomerTracking(priya.actor, order.id);
    expect(mine).toMatchObject({ stage: 'delivering' });
    expect(mine?.code).toMatch(/^\d{4}$/);
    expect(await tracking.getCustomerTracking(maya.actor, order.id)).toBeNull();

    const current = await tracking.getCurrentDeliveryF8(luis.actor);
    expect(current).toMatchObject({
      stage: 'delivering',
      dropoff: { firstName: 'Priya', phone: '+16175550101' },
      otp: { locked: false, triesLeft: 5 },
    });
    expect(JSON.stringify(current)).not.toContain(mine?.code ?? 'none');

    const code = mine?.code ?? '';
    const wrong = `${code.slice(0, 3)}${(Number(code[3]) + 1) % 10}`;
    expect(
      await tracking.handOver(luis.actor, deliveryId, { code: wrong, cashCollected: true }),
    ).toEqual({ outcome: 'wrong', triesLeft: 4 });
    expect(await tracking.handOver(luis.actor, deliveryId, { code, cashCollected: true })).toEqual({
      outcome: 'delivered',
      payWords: `Order ${order.number} delivered · You earned $7.64`,
      // F9 P51.3: today's figures, read in the hand-over's own transaction.
      today: { earnedCents: 764, deliveries: 1 },
    });
    expect(sent('delivery.delivered')).toHaveLength(1);
    expect(await tracking.getCustomerTracking(priya.actor, order.id)).toBeNull();
    expect(await tracking.getCurrentDeliveryF8(luis.actor)).toBeNull();
  });

  it('refuses a pickup while the kitchen has moved the order back', async () => {
    const { order, deliveryId } = await heldOrder();
    await migrator.order.update({ where: { id: order.id }, data: { status: 'PREPARING' } });
    await expect(tracking.pickUp(luis.actor, deliveryId, {})).rejects.toMatchObject({
      code: 'ORDER_NOT_READY',
    });
  });
});

describe('the location pipeline (L1 to L3)', () => {
  it('publishes to the customer at most every 4 s, rounded, and to the real map only', async () => {
    const { deliveryId } = await heldOrder();
    await tracking.pickUp(luis.actor, deliveryId, {});
    mocks.publish.mockClear();
    await tracking.pointAccepted({
      partnerId: luis.partnerId,
      isDemo: false,
      point: point(42.3553219, -71.0506123),
      acceptedAt: new Date(),
    });
    await tracking.pointAccepted({
      partnerId: luis.partnerId,
      isDemo: false,
      point: point(42.3554, -71.0507),
      acceptedAt: new Date(),
    });
    const track = published('courier.location');
    expect(track).toHaveLength(1);
    expect(track[0]?.[0]).toMatch(/^private-track-/);
    expect(track[0]?.[2]).toMatchObject({ lat: 42.35532, lng: -71.05061 });
    const map = published('courier.position');
    expect(map.every(([channel]) => channel === channels.opsMap)).toBe(true);
    expect(JSON.stringify(mocks.publish.mock.calls)).not.toMatch(/Priya|Faneuil|\+1617/);
    expect(await migrator.deliveryLocation.count({ where: { deliveryId } })).toBe(1);
  });

  it('keeps one clock for the customer and staff when a phone repeats its fix (review S7)', async () => {
    const { order, deliveryId } = await heldOrder();
    await tracking.pickUp(luis.actor, deliveryId, {});
    await redis.del(`partner:loc:${luis.partnerId}`);
    const { onlineSessionId } = await migrator.deliveryPartner.findUniqueOrThrow({
      where: { id: luis.partnerId },
      select: { onlineSessionId: true },
    });
    const partners = await import('@/server/modules/partners/service');
    const start = Date.now();
    const at = (seconds: number) => new Date(start + seconds * 1000);
    const send = (seconds: number) =>
      partners.recordLocations(
        luis.actor,
        onlineSessionId,
        {
          points: [
            { lat: 42.3521, lng: -71.0469, accuracy: 15, recordedAt: at(seconds).toISOString() },
          ],
        },
        at(seconds),
      );
    // He stands still and the phone repeats the same fix every 15 s for 3 minutes.
    for (let seconds = 0; seconds <= 180; seconds += 15) await send(seconds);
    const capped = at(120).toISOString();
    expect((await tracking.getCustomerTracking(priya.actor, order.id))?.courierPoint?.at).toBe(
      capped,
    );
    const map = await asBrowser(daniel.browser, () => tracking.getOpsMap(daniel.actor, at(180)));
    expect(map.couriers.find((courier) => courier.partnerId === luis.partnerId)).toMatchObject({
      at: capped,
      freshness: 'hollow',
    });
    const board = await tracking.boardTracking({ isDemo: false }, 'America/New_York', at(250));
    expect(board.lines.get(order.id)).toMatchObject({
      state: 'noLocation',
      tone: 'amber',
      // QA A48.1: the board reads it again when it turns red, by the same clock.
      changesAt: new Date(Date.parse(capped) + 600_000).toISOString(),
    });
    expect(
      (await tracking.boardTracking({ isDemo: false }, 'America/New_York', at(130))).lines.get(
        order.id,
      )?.changesAt,
    ).toBe(new Date(Date.parse(capped) + 120_000).toISOString());
    expect(
      published('courier.position')
        .map(([, , data]) => (data as { at: string }).at)
        .every((value) => value <= capped),
    ).toBe(true);
  });

  it("tells her page when he's almost there, about 2 minutes at most (QA S4.1)", async () => {
    const { order, deliveryId } = await heldOrder();
    await tracking.pickUp(luis.actor, deliveryId, {});
    await migrator.delivery.update({ where: { id: deliveryId }, data: { routeDurationSec: 240 } });
    const door = await migrator.order.findUniqueOrThrow({
      where: { id: order.id },
      select: { addressLat: true, addressLng: true },
    });
    mocks.publish.mockClear();
    await tracking.pointAccepted({
      partnerId: luis.partnerId,
      isDemo: false,
      point: point(door.addressLat, door.addressLng),
      acceptedAt: new Date(),
    });
    expect(
      published('delivery.changed').some(([channel]) => channel === channels.order(order.id)),
    ).toBe(true);
    const notice = await migrator.notification.findFirstOrThrow({
      where: { userId: priya.userId, type: 'order.almost-here' },
      orderBy: { createdAt: 'desc' },
    });
    expect(notice.body).toMatch(/^Luis is about [12] minutes? away\./);
  });

  it('stores a straight-line estimate, flagged as estimated', async () => {
    const { deliveryId } = await heldOrder();
    const result = await tracking.refreshEstimate(deliveryId);
    expect(result).toMatchObject({ active: true, route: { estimated: true } });
    expect(
      (await migrator.delivery.findUniqueOrThrow({ where: { id: deliveryId } })).etaEstimated,
    ).toBe(true);
  });
});

describe('who may subscribe (L9)', () => {
  it('keeps real positions from the kitchen, the demo admin, other customers and partners', async () => {
    const { order } = await heldOrder();
    expect(await canSubscribe(sub(priya.userId, 'customer'), channels.track(order.id))).toBe(true);
    expect(await canSubscribe(sub(maya.userId, 'customer'), channels.track(order.id))).toBe(false);
    expect(await canSubscribe(sub(luis.userId, 'partner'), channels.track(order.id))).toBe(false);
    expect(await canSubscribe(sub(luis.userId, 'partner'), channels.order(order.id))).toBe(false);
    expect(await canSubscribe(sub(morgan.userId, 'support'), channels.track(order.id))).toBe(false);
    expect(await canSubscribe(sub(morgan.userId, 'support'), channels.opsMap)).toBe(true);
    expect(await canSubscribe(sub(morgan.userId, 'kitchen'), channels.opsMap)).toBe(false);
    expect(await canSubscribe(sub(demoAdmin.userId, 'admin', true), channels.opsMap)).toBe(false);
    expect(await canSubscribe(sub(demoAdmin.userId, 'admin', true), channels.opsMapDemo)).toBe(
      true,
    );
    expect(await canSubscribe(sub(daniel.userId, 'admin'), channels.opsMapDemo)).toBe(false);
  });
});

describe('door problems and staff (P43, A50)', () => {
  it('waits 5 minutes before support may confirm, then confirms with an audit row', async () => {
    const { order, deliveryId } = await heldOrder();
    await tracking.pickUp(luis.actor, deliveryId, {});
    await tracking.reportProblem(luis.actor, deliveryId, { kind: 'no-answer' });
    expect(sent('delivery.no-answer-started')).toHaveLength(1);
    expect(
      await migrator.notification.count({
        where: { userId: priya.userId, type: 'order.courier-at-door' },
      }),
    ).toBe(1);
    await expect(tracking.reportNoAnswer(luis.actor, deliveryId)).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
    const { version } = await migrator.delivery.findUniqueOrThrow({ where: { id: deliveryId } });
    const early = await asBrowser(morgan.browser, () =>
      actions.confirmHandoverAction({
        orderId: order.id,
        expectedVersion: version,
        reason: 'customer-confirmed',
        cashCollected: true,
      }),
    );
    expect(early?.serverError).toMatchObject({ code: 'CONFIRM_NOT_ALLOWED' });
    await migrator.$executeRaw`UPDATE deliveries SET no_answer_since = app_now() - interval '6 minutes' WHERE id = ${deliveryId}::uuid`;
    expect(await tracking.noAnswerDue(deliveryId, new Date().toISOString())).toBe('moved-on');
    const done = await asBrowser(morgan.browser, () =>
      actions.confirmHandoverAction({
        orderId: order.id,
        expectedVersion: version,
        reason: 'customer-confirmed',
        cashCollected: true,
      }),
    );
    expect(done?.serverError).toBeUndefined();
    expect(
      await migrator.auditLog.count({
        where: { action: 'tracking.handover-confirmed', targetId: order.id },
      }),
    ).toBe(1);
    // Review S10: staff steps name the person (design 3.13).
    const { getStaffOrderDetail } = await import('@/server/modules/board/service');
    const detail = await asBrowser(morgan.browser, () =>
      getStaffOrderDetail(morgan.actor, order.id),
    );
    expect(
      (detail?.timeline ?? []).flatMap((entry) => (entry.type === 'courier' ? [entry.words] : [])),
    ).toContain('Hand-over confirmed by Morgan Diaz (Support): Customer confirmed by phone');
    expect(
      published('delivery.changed').some(
        ([channel, , data]) =>
          channel === channels.partner(luis.partnerId) &&
          (data as { notice?: string }).notice === 'confirmed',
      ),
    ).toBe(true);
  });

  it('asks the courier to wait, then cancels and brings it back', async () => {
    const { order, deliveryId } = await heldOrder();
    await tracking.pickUp(luis.actor, deliveryId, {});
    await tracking.reportProblem(luis.actor, deliveryId, { kind: 'no-answer' });
    const first = await migrator.delivery.findUniqueOrThrow({ where: { id: deliveryId } });
    const wait = await asBrowser(morgan.browser, () =>
      actions.askToWaitAction({ orderId: order.id, expectedVersion: first.version }),
    );
    expect(wait?.serverError).toBeUndefined();
    const second = await migrator.delivery.findUniqueOrThrow({ where: { id: deliveryId } });
    expect(second.noAnswerWaitRestartedAt).not.toBeNull();
    expect((await tracking.getCurrentDeliveryF8(luis.actor))?.notice).toMatchObject({
      kind: 'askedToWait',
      orderNumber: order.number,
    });
    // Review S1: the card the change named comes back with its "asked to wait" line, so the
    // board reads it within 2 s, not at the next full read.
    const { boardCardsAction } = await import('@/server/modules/board/actions');
    const cards = await asBrowser(morgan.browser, () => boardCardsAction({ orderIds: [order.id] }));
    expect(cards?.data?.cards[0]?.delivery).toMatchObject({
      state: 'askedToWait',
      tone: 'amber',
      icon: 'hourglass',
      words: expect.stringMatching(/^Luis M\. · \S+ isn't answering · asked to wait · 0 min$/),
    });
    // Review S10: the timeline names who asked (design 3.13).
    const { getStaffOrderDetail } = await import('@/server/modules/board/service');
    const detail = await asBrowser(morgan.browser, () =>
      getStaffOrderDetail(morgan.actor, order.id),
    );
    expect(
      (detail?.timeline ?? []).flatMap((entry) => (entry.type === 'courier' ? [entry.words] : [])),
    ).toContain('Morgan Diaz (Support) asked Luis Moreno to wait 5 more minutes');
    await migrator.$executeRaw`UPDATE deliveries SET no_answer_since = app_now() - interval '6 minutes' WHERE id = ${deliveryId}::uuid`;
    const cancel = await asBrowser(morgan.browser, () =>
      actions.cancelUnreachableAction({ orderId: order.id, expectedVersion: second.version }),
    );
    expect(cancel?.serverError).toBeUndefined();
    expect(await migrator.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({
      status: 'CANCELLED',
      cancelCode: 'customer-unreachable',
    });
  });

  it('refunds a paid card order brought back after pickup, once a code is checked (U6)', async () => {
    const { order, deliveryId } = await heldOrder({ cash: false });
    await migrator.order.update({
      where: { id: order.id },
      data: {
        paymentStatus: 'PAID',
        stripePaymentIntentId: `pi_unreachable_${order.id.slice(0, 8)}`,
      },
    });
    await tracking.pickUp(luis.actor, deliveryId, {});
    await tracking.reportProblem(luis.actor, deliveryId, { kind: 'no-answer' });
    // Support cancels only a stuck delivery (S4): the 5-minute wait has run out.
    await migrator.$executeRaw`UPDATE deliveries SET no_answer_since = app_now() - interval '6 minutes' WHERE id = ${deliveryId}::uuid`;
    const held = await migrator.delivery.findUniqueOrThrow({ where: { id: deliveryId } });
    await signedInAgo(migrator, morgan.userId, 11);
    const asked = await asBrowser(morgan.browser, () =>
      actions.cancelUnreachableAction({ orderId: order.id, expectedVersion: held.version }),
    );
    expect(asked?.serverError?.code).toBe('STEP_UP_REQUIRED');
    const code = await morgan.code();
    const cancel = await asBrowser(morgan.browser, () =>
      actions.cancelUnreachableAction({
        orderId: order.id,
        expectedVersion: held.version,
        stepUp: { method: 'totp', code },
      }),
    );
    expect(cancel?.serverError).toBeUndefined();
    expect(await migrator.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({
      status: 'CANCELLED',
      cancelCode: 'customer-unreachable',
      autoRefundReason: 'staff-cancel',
    });
    const event = await migrator.orderEvent.findFirstOrThrow({
      where: { orderId: order.id, type: 'cancelled' },
    });
    expect(event.data).toMatchObject({ refundAnnounced: true });
  });

  it('gives staff the steps and the route, never the kitchen, and tells the courier of a hand-marked delivery', async () => {
    const { order, deliveryId } = await heldOrder();
    await tracking.pickUp(luis.actor, deliveryId, {});
    await tracking.refreshEstimate(deliveryId);
    const detail = await tracking.staffTrackingDetail({ role: 'support', isDemo: false }, order.id);
    expect(detail).toMatchObject({
      steps: { pickedUpAt: expect.any(String) },
      route: { estimated: true },
      late: false,
    });
    expect(detail?.point).not.toBeNull();
    expect(
      await tracking.staffTrackingDetail({ role: 'kitchen', isDemo: false }, order.id),
    ).toBeNull();
    expect(
      (await tracking.staffTrackingDetail({ role: 'admin', isDemo: true }, order.id))?.point,
    ).toBeNull();
    await migrator.order.update({ where: { id: order.id }, data: { status: 'DELIVERED' } });
    await migrator.delivery.update({ where: { id: deliveryId }, data: { status: 'DELIVERED' } });
    await tracking.notifyMarkedDelivered(order.id);
    expect(
      published('delivery.changed').some(
        ([channel, , data]) =>
          channel === channels.partner(luis.partnerId) &&
          (data as { notice?: string }).notice === 'markedDelivered',
      ),
    ).toBe(true);
    expect(
      (await migrator.delivery.findUniqueOrThrow({ where: { id: deliveryId } })).handoverHow,
    ).toBe('admin-override');
    // F9 reads the courier's pay from this event: the tip is part of it, never left out.
    expect(sent('delivery.delivered').at(-1)?.data).toMatchObject({
      how: 'admin-override',
      payCents: 764,
      tipCents: 500,
    });
    const { partnerDispatchState } = await import('@/server/modules/delivery/service');
    expect((await partnerDispatchState(luis.partnerId)).notice).toMatchObject({
      kind: 'markedDelivered',
      orderNumber: order.number,
    });
  });

  it('puts a locked code on the board, oldest first', async () => {
    const { order, deliveryId } = await heldOrder();
    await tracking.pickUp(luis.actor, deliveryId, {});
    await migrator.$executeRaw`UPDATE deliveries SET otp_locked_at = app_now(), otp_wrong_tries = 5 WHERE id = ${deliveryId}::uuid`;
    const board = await tracking.boardTracking({ isDemo: false }, 'America/New_York');
    expect(board.lines.get(order.id)).toMatchObject({
      state: 'locked',
      tone: 'red',
      words: 'Luis M. · code locked',
    });
    expect(board.attention[0]).toMatchObject({
      kind: 'locked',
      words: `Order ${order.number}: the delivery code is locked after 5 wrong tries.`,
    });
    // QA A50.1: after a lock, support may also ask him to wait 5 more minutes.
    const locked = await migrator.delivery.findUniqueOrThrow({ where: { id: deliveryId } });
    const wait = await asBrowser(morgan.browser, () =>
      actions.askToWaitAction({ orderId: order.id, expectedVersion: locked.version }),
    );
    expect(wait?.serverError).toBeUndefined();
    expect(
      (await migrator.delivery.findUniqueOrThrow({ where: { id: deliveryId } }))
        .noAnswerWaitRestartedAt,
    ).not.toBeNull();
    // The live map carries the same banners and the kitchen's pin (design 3.3, 3.9).
    const map = await asBrowser(daniel.browser, () => actions.opsMapAction());
    expect(map?.data?.attention?.[0]).toMatchObject({ kind: 'locked', orderNumber: order.number });
    expect(map?.data?.kitchen).toEqual({ lat: expect.any(Number), lng: expect.any(Number) });
  });
});

describe('the live map and the demo run (A46, A54, L10)', () => {
  it('shows each viewer only their pool, and runs the demo delivery to the end', async () => {
    vi.stubEnv('FOODZ_TEST_TIMING', '1');
    vi.stubEnv('DEMO_RUN_SPEED', '600');
    await migrator.user.upsert({
      where: { email: 'demo.customer@foodz.example' },
      create: {
        id: crypto.randomUUID(),
        email: 'demo.customer@foodz.example',
        name: 'Dana Customer',
        isDemo: true,
      },
      update: { isDemo: true },
      select: { id: true },
    });
    await migrator.$transaction((tx) => ensureDemoCourier(tx));
    const real = await asBrowser(daniel.browser, () => actions.opsMapAction());
    expect(real?.data?.pool).toBe('REAL');
    expect(real?.data?.couriers.some((courier) => courier.fullName === 'Luis Moreno')).toBe(true);

    const started = await asBrowser(demoAdmin.browser, () => actions.startDemoDeliveryAction({}));
    expect(started?.serverError).toBeUndefined();
    const again = await asBrowser(demoAdmin.browser, () => actions.startDemoDeliveryAction({}));
    expect(again?.serverError).toMatchObject({ code: 'DEMO_RUN_BUSY' });
    const runId = started?.data?.runId ?? '';
    const prepared = await tracking.demoPrepare(runId);
    expect(prepared?.points).toBeGreaterThan(0);
    expect(await migrator.orderItem.count({ where: { orderId: prepared?.orderId } })).toBe(2);
    // Design 3.7 and B9: the run's order is D-1, D-2…, and its start is audited.
    expect(
      (await migrator.order.findUniqueOrThrow({ where: { id: prepared!.orderId } })).number,
    ).toMatch(/^D-\d+$/);
    expect(
      await migrator.auditLog.count({
        where: { action: 'tracking.demo-run-started', targetId: runId },
      }),
    ).toBe(1);
    // QA A54.2, L10.4: real staff never read the run's order, on the board, its cards, Find or
    // the detail; the demo admin does.
    const board = await import('@/server/modules/board/service');
    const boardActions = await import('@/server/modules/board/actions');
    const realBoard = await asBrowser(morgan.browser, () => board.getBoard(morgan.actor));
    expect(realBoard.cards.map((card) => card.id)).not.toContain(prepared!.orderId);
    const realCards = await asBrowser(morgan.browser, () =>
      boardActions.boardCardsAction({ orderIds: [prepared!.orderId] }),
    );
    expect(realCards?.data?.cards ?? []).toEqual([]);
    expect(
      await asBrowser(daniel.browser, () =>
        board.getStaffOrderDetail(daniel.actor, prepared!.orderId),
      ),
    ).toBeNull();
    const demoBoard = await asBrowser(demoAdmin.browser, () => board.getBoard(demoAdmin.actor));
    expect(demoBoard.cards.map((card) => card.id)).toContain(prepared!.orderId);
    const demoMap = await asBrowser(demoAdmin.browser, () => actions.opsMapAction());
    expect(demoMap?.data?.pool).toBe('DEMO');
    expect(demoMap?.data?.couriers.map((courier) => courier.fullName)).toEqual(['Jamie Courier']);
    for (let index = 0; index < (prepared?.points ?? 0); index += 1)
      await tracking.demoPoint(prepared!.deliveryId, index);
    expect(
      published('courier.position').every(([channel]) => channel === channels.opsMapDemo),
    ).toBe(true);
    await tracking.demoFinish(runId, prepared!.deliveryId, true);
    expect(
      (await migrator.delivery.findUniqueOrThrow({ where: { id: prepared!.deliveryId } })).status,
    ).toBe('DELIVERED');
    expect((await migrator.demoRun.findUniqueOrThrow({ where: { id: runId } })).status).toBe(
      'done',
    );
    // L10.4 (acceptance): the run's events reach demo staff only, never a real staff channel.
    const aboutRun = mocks.publish.mock.calls.filter(
      ([, , data]) => (data as { orderId?: string } | undefined)?.orderId === prepared!.orderId,
    );
    expect(aboutRun.some(([channel]) => channel === channels.opsDemo)).toBe(true);
    expect(aboutRun.filter(([channel]) => channel === channels.ops)).toEqual([]);
    expect(await canSubscribe(sub(morgan.userId, 'support'), channels.opsDemo)).toBe(false);
    expect(await canSubscribe(sub(demoAdmin.userId, 'admin', true), channels.opsDemo)).toBe(true);
    expect(await canSubscribe(sub(daniel.userId, 'admin'), channels.order(prepared!.orderId))).toBe(
      false,
    );
    expect(
      await canSubscribe(sub(demoAdmin.userId, 'admin', true), channels.order(prepared!.orderId)),
    ).toBe(true);
    vi.unstubAllEnvs();
  });
});
