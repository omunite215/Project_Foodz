import { PrismaPg } from '@prisma/adapter-pg';
import { v7 as uuid } from 'uuid';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  inject,
  it,
  vi,
} from 'vitest';
import { PrismaClient } from '@/server/db/generated/client';
import { setPaymentGatewayForTests } from '@/server/payments/stripe';
import { redis } from '@/server/redis';
import { FakeStripe, VISA } from '../support/fake-stripe';
import { seedCatalog } from '../../prisma/seeding';
import { asBrowser, type Browser, newBrowser, nextHeaders, switchBrowser } from './support/browser';
import {
  type Customer,
  customer,
  dishIds,
  openAllDay,
  press,
  restoreHours,
} from './support/checkout';
import { BACKUP_CODES, signedInAgo, type StaffMember, staffMember } from './support/staff';

/*
 * The staff order board through its Server Actions (F5 contract 2 to 8): who may call what,
 * moves with the version check and the undo window, refusing and cancelling with refunds and
 * code release, the step-up code, the manual hand-over, "86 it", what each role reads (the
 * kitchen without contact details or amounts, the demo admin masked), realtime payloads and the
 * customer's step notices.
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

const board = await import('@/server/modules/board/actions');
const boardService = await import('@/server/modules/board/service');
const orders = await import('@/server/modules/orders/actions');
const progress = await import('@/server/modules/orders/progress-actions');
const sync = await import('@/server/modules/orders/payment-sync');
const notices = await import('@/server/modules/orders/notices');

let migrator: PrismaClient;
let fake: FakeStripe;
let dish: Record<string, string> = {};
let alex: StaffMember;
let riley: StaffMember;
let morgan: StaffMember;
let daniel: StaffMember;
let demo: StaffMember;
let taylor: StaffMember;
let casey: StaffMember;
let courier: StaffMember;
let maya: Customer;
let priya: Customer;
const guest: Browser = newBrowser();
const TAG = crypto.randomUUID().slice(0, 6).toUpperCase();

interface ActionResult<T = unknown> {
  data?: T;
  serverError?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    fieldErrors?: Record<string, string[]>;
    retryAfterSeconds?: number;
  };
  validationErrors?: unknown;
}

const as = <T>(who: { browser: Browser }, work: () => Promise<T>) => asBrowser(who.browser, work);

const later = (ms: number) => new Date(Date.now() + ms);

async function cashOrder(who: Customer) {
  switchBrowser(who.browser);
  const result = await orders.placeOrderAction(press(who, dish, { allowDuplicate: true }));
  expect(result?.serverError).toBeUndefined();
  return result.data!.orderId;
}

/** A card order Stripe has taken the money for (a real PaymentIntent, here the fake one). */
async function paidCardOrder(who: Customer) {
  switchBrowser(who.browser);
  const result = await orders.placeOrderAction(
    press(who, dish, { method: 'card', card: { kind: 'new' }, allowDuplicate: true }),
  );
  expect(result?.serverError).toBeUndefined();
  const orderId = result.data!.orderId;
  fake.succeed(fake.intentFor(orderId)!.id, VISA);
  await orders.orderStatusAction({ orderId, confirmed: true });
  return orderId;
}

const row = (id: string) =>
  migrator.order.findUniqueOrThrow({
    where: { id },
    select: {
      number: true,
      status: true,
      version: true,
      statusChangedVersion: true,
      acceptedAt: true,
      preparingAt: true,
      readyAt: true,
      pickedUpAt: true,
      deliveredAt: true,
      cancelReason: true,
      cancelCode: true,
      cancelLineIds: true,
      autoRefundReason: true,
      paymentStatus: true,
      totalCents: true,
      refundedCents: true,
    },
  });

const eventsOf = (orderId: string) =>
  migrator.orderEvent.findMany({
    where: { orderId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, type: true, fromStatus: true, toStatus: true, actorId: true, data: true },
  });

const sentEvents = (name: string) =>
  mocks.send.mock.calls
    .map(([event]) => event as { name: string; id?: string; data: Record<string, unknown> })
    .filter((event) => event.name === name);

async function move(who: StaffMember, orderId: string, to: 'ACCEPTED' | 'PREPARING' | 'READY') {
  const { version } = await row(orderId);
  const result = await as(who, () =>
    board.moveOrderAction({ orderId, to, expectedVersion: version }),
  );
  expect(result?.serverError).toBeUndefined();
  return result.data!;
}

async function advance(orderId: string, to: 'ACCEPTED' | 'PREPARING' | 'READY') {
  const steps = ['ACCEPTED', 'PREPARING', 'READY'] as const;
  for (const step of steps.slice(0, steps.indexOf(to) + 1)) await move(alex, orderId, step);
}

beforeAll(async () => {
  migrator = new PrismaClient({
    adapter: new PrismaPg({ connectionString: inject('migratorUrl') }),
  });
  await migrator.$transaction((tx) => seedCatalog(tx, { now: new Date() }), { timeout: 60_000 });
  dish = await dishIds(migrator);
  await openAllDay(migrator);
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fake');
  vi.stubEnv('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', 'pk_test_fake');
  alex = await staffMember(migrator, 'kitchen', { name: 'Alex Kim', sample: true });
  riley = await staffMember(migrator, 'kitchen', { name: 'Riley Cook' });
  morgan = await staffMember(migrator, 'support', { name: 'Morgan Diaz', sample: true });
  daniel = await staffMember(migrator, 'admin', { name: 'Foodz Admin' });
  demo = await staffMember(migrator, 'admin', { name: 'Demo Admin', demo: true });
  taylor = await staffMember(migrator, 'content_editor', { name: 'Taylor Brooks' });
  casey = await staffMember(migrator, 'kitchen', { name: 'Casey Park', twoFactor: false });
  courier = await staffMember(migrator, 'partner', { name: 'Riley Courier' });
  maya = await customer(migrator, { tag: 'maya' });
  priya = await customer(migrator, { tag: 'priya' });
  await migrator.user.update({ where: { id: priya.userId }, data: { isSample: true } });
}, 180_000);

beforeEach(async () => {
  fake = new FakeStripe();
  setPaymentGatewayForTests(fake);
  mocks.send.mockClear();
  mocks.publish.mockClear();
  // The customers here place far more orders than a person may in an hour (F4 B11).
  const limits = await redis.keys('rl:order.place*');
  if (limits.length > 0) await redis.del(...limits);
  await migrator.menuItem.updateMany({
    where: { slug: { in: ['pad-thai', 'gimbap'] } },
    data: { isAvailable: true, soldOutAt: null, soldOutById: null },
  });
});

afterEach(() => {
  setPaymentGatewayForTests(undefined);
});

afterAll(async () => {
  await restoreHours(migrator);
  await migrator.menuItem.updateMany({
    where: { slug: { in: ['pad-thai', 'gimbap'] } },
    data: { isAvailable: true, soldOutAt: null, soldOutById: null },
  });
  await migrator.$disconnect();
  await redis.quit();
  vi.unstubAllEnvs();
});

// ------------------------------------------------------------------ who may call what (A13.3)

describe('who may call each action (A13.3, T1 to T4)', () => {
  type Outcome =
    | 'ok'
    | 'NOT_FOUND'
    | 'FORBIDDEN'
    | 'DEMO_READ_ONLY'
    | 'TWO_FACTOR_REQUIRED'
    | 'UNAUTHENTICATED';
  const ok = 'ok';
  const NF = 'NOT_FOUND';
  const F = 'FORBIDDEN';
  const D = 'DEMO_READ_ONLY';
  const T = 'TWO_FACTOR_REQUIRED';
  const U = 'UNAUTHENTICATED';

  const ACTIONS = [
    'snapshot',
    'cards',
    'detail',
    'preview',
    'find',
    'dishes',
    'move',
    'undo',
    'moveBack',
    'refuse',
    'cancel',
    'pickedUp',
    'delivered',
    'dish',
  ] as const;
  type Name = (typeof ACTIONS)[number];
  const reads = (outcome: Outcome) => [outcome, outcome, outcome, outcome, outcome, outcome];

  // prettier-ignore
  const MATRIX: Record<string, Outcome[]> = {
    kitchen:  [...reads(ok), NF, NF, F, NF, F, F, F, NF],
    support:  [...reads(ok), F, F, F, F, NF, F, F, F],
    admin:    [...reads(ok), NF, NF, NF, F, NF, NF, NF, NF],
    demo:     [...reads(ok), D, D, D, F, D, D, D, D],
    customer: [...reads(F), F, F, F, F, F, F, F, F],
    courier:  [...reads(F), F, F, F, F, F, F, F, F],
    editor:   [...reads(F), F, F, F, F, F, F, F, F],
    noFactor: [...reads(T), T, T, F, T, F, F, F, T],
    guest:    [...reads(U), U, U, U, U, U, U, U, U],
  };

  function call(
    name: Name,
    orderId: string,
    number: string,
    version: number,
  ): Promise<ActionResult | undefined> {
    switch (name) {
      case 'snapshot':
        return board.boardSnapshotAction({});
      case 'cards':
        return board.boardCardsAction({ orderIds: [orderId] });
      case 'detail':
        return board.staffOrderDetailAction({ orderId });
      case 'preview':
        return board.cancelPreviewAction({ orderId });
      case 'find':
        return board.findOrderAction({ query: number });
      case 'dishes':
        return board.boardDishesAction({});
      case 'move':
        return board.moveOrderAction({ orderId, to: 'ACCEPTED', expectedVersion: version });
      case 'undo':
        return board.undoMoveAction({ orderId, eventId: uuid() });
      case 'moveBack':
        return board.moveBackAction({ orderId, expectedVersion: version, reason: 'wrong-ticket' });
      case 'refuse':
        return board.refuseOrderAction({ orderId, expectedVersion: version, reason: 'too-busy' });
      case 'cancel':
        return board.staffCancelOrderAction({
          orderId,
          expectedVersion: version,
          reason: 'too-busy',
        });
      case 'pickedUp':
        return board.markPickedUpAction({
          orderId,
          expectedVersion: version,
          reason: 'own-driver',
        });
      case 'delivered':
        return board.markDeliveredAction({
          orderId,
          expectedVersion: version,
          reason: 'own-driver',
        });
      case 'dish':
      default:
        return board.setDishAvailabilityAction({ dishId: orderId, available: false });
    }
  }

  it('answers each role as the role table says, and a refusal changes nothing', async () => {
    const orderId = await cashOrder(maya);
    const { number, version } = await row(orderId);
    const before = (await eventsOf(orderId)).length;
    const who: Record<string, { browser: Browser }> = {
      kitchen: alex,
      support: morgan,
      admin: daniel,
      demo,
      customer: maya,
      courier,
      editor: taylor,
      noFactor: casey,
      guest: { browser: guest },
    };
    const seen: Record<string, Outcome[]> = {};
    const demoMessages = new Set<string>();
    for (const [role, expected] of Object.entries(MATRIX)) {
      seen[role] = [];
      for (const [index, name] of ACTIONS.entries()) {
        // Allowed changes run against an unknown id, so the matrix itself changes nothing.
        const target = expected[index] === NF ? uuid() : orderId;
        const result = await as(who[role]!, () => call(name, target, number, version));
        seen[role].push((result?.serverError?.code as Outcome | undefined) ?? ok);
        if (result?.serverError?.code === 'DEMO_READ_ONLY') {
          demoMessages.add(result.serverError.message);
        }
      }
    }
    expect(seen).toEqual(MATRIX);
    expect([...demoMessages]).toEqual(['The demo admin can look but not change anything.']);
    expect(await row(orderId)).toMatchObject({ status: 'PLACED', version });
    expect(await eventsOf(orderId)).toHaveLength(before);
  });
});

// ------------------------------------------------------------------ moving (A4, A5)

describe('moving an order (A4, A5)', () => {
  it('accepts with one event, the step time, a server undo deadline and an id-only realtime message', async () => {
    const orderId = await cashOrder(maya);
    const result = await move(alex, orderId, 'ACCEPTED');
    expect(result).toMatchObject({ status: 'ACCEPTED', replayed: false });
    expect(Date.parse(result.undoUntil) - Date.parse(result.at)).toBe(10_000);
    const stored = await row(orderId);
    expect(stored).toMatchObject({ status: 'ACCEPTED', version: result.version });
    expect(stored.acceptedAt?.toISOString()).toBe(result.at);
    const accepted = (await eventsOf(orderId)).filter((event) => event.type === 'accepted');
    expect(accepted).toEqual([
      expect.objectContaining({
        id: result.eventId,
        fromStatus: 'PLACED',
        toStatus: 'ACCEPTED',
        actorId: alex.userId,
        data: { by: { name: 'Alex Kim', role: 'kitchen' }, versionAfter: result.version },
      }),
    ]);

    const payload = { orderId, status: 'ACCEPTED', version: result.version, at: result.at };
    expect(mocks.publish).toHaveBeenCalledWith(
      `private-order-${orderId}`,
      'order.status-changed',
      payload,
    );
    expect(mocks.publish).toHaveBeenCalledWith(
      `private-user-${maya.userId}`,
      'order.status-changed',
      payload,
    );
    expect(mocks.publish).toHaveBeenCalledWith('private-ops', 'order.board-changed', payload);
    // The order notice (notification.created) is the customer's own; order events carry ids only.
    const orderEvents = mocks.publish.mock.calls.filter(([, event]) => event.startsWith('order.'));
    expect(
      orderEvents.filter(([, , data]) => (data as { status: string }).status === 'ACCEPTED'),
    ).toHaveLength(3);
    for (const [, , data] of orderEvents) {
      expect(Object.keys(data as object).toSorted()).toEqual([
        'at',
        'orderId',
        'status',
        'version',
      ]);
    }

    const [notice] = sentEvents('order.step-notice-requested');
    expect(notice).toMatchObject({
      id: `order-step-notice-${result.eventId}`,
      data: { orderId, step: 'accepted', eventId: result.eventId },
    });
    expect(Date.parse(String(notice?.data.dueAt)) - Date.parse(result.at)).toBe(12_000);
    expect(sentEvents('order.accepted')).toHaveLength(1);

    // The customer can no longer cancel (A4.4).
    const cancel = await as(maya, () => orders.cancelOrderAction({ orderId }));
    expect(cancel?.serverError?.code).toBe('KITCHEN_STARTED');
  });

  it('makes a double tap one move (A4.6)', async () => {
    const orderId = await cashOrder(maya);
    const { version } = await row(orderId);
    const [first, second] = await as(alex, () =>
      Promise.all([
        board.moveOrderAction({ orderId, to: 'ACCEPTED', expectedVersion: version }),
        board.moveOrderAction({ orderId, to: 'ACCEPTED', expectedVersion: version }),
      ]),
    );
    expect([first?.data?.replayed, second?.data?.replayed].filter(Boolean)).toEqual([true]);
    expect(first?.data?.eventId).toBe(second?.data?.eventId);
    expect((await eventsOf(orderId)).filter((event) => event.type === 'accepted')).toHaveLength(1);
  });

  it('refuses a second person with who moved it and when (A5.1, A5.2)', async () => {
    const orderId = await cashOrder(maya);
    await move(alex, orderId, 'ACCEPTED');
    const { version } = await row(orderId);
    await move(daniel, orderId, 'PREPARING');
    const late = await as(alex, () =>
      board.moveOrderAction({ orderId, to: 'PREPARING', expectedVersion: version }),
    );
    expect(late?.serverError).toMatchObject({
      code: 'ORDER_CHANGED',
      message: expect.stringMatching(
        /^Already cooking · moved by Foodz Admin at \d{1,2}:\d{2} [ap]m$/,
      ),
      details: {
        orderId,
        current: { status: 'PREPARING', version: version + 1 },
        lastChange: { how: 'moved', by: { kind: 'staff', name: 'Foodz Admin', role: 'admin' } },
      },
    });
    expect((await eventsOf(orderId)).filter((event) => event.type === 'preparing')).toHaveLength(1);
  });

  it('lets a money change through but never a future or stale version (A5.3, T15)', async () => {
    const orderId = await cashOrder(maya);
    await move(alex, orderId, 'ACCEPTED');
    const { version } = await row(orderId);
    await migrator.order.update({ where: { id: orderId }, data: { version: { increment: 1 } } });
    const after = await as(alex, () =>
      board.moveOrderAction({ orderId, to: 'PREPARING', expectedVersion: version }),
    );
    expect(after?.serverError).toBeUndefined();
    const moved = (await row(orderId)).version;
    const future = await as(alex, () =>
      board.moveOrderAction({ orderId, to: 'READY', expectedVersion: moved + 5 }),
    );
    expect(future?.serverError?.code).toBe('ORDER_CHANGED');
    const wrongStep = await as(alex, () =>
      board.moveOrderAction({ orderId, to: 'ACCEPTED', expectedVersion: moved }),
    );
    expect(wrongStep?.serverError?.code).toBe('INVALID_STATE');
  });

  it("says the customer cancelled first when the kitchen's Accept lands after (A5.4)", async () => {
    const orderId = await cashOrder(maya);
    const { version } = await row(orderId);
    expect(
      (await as(maya, () => orders.cancelOrderAction({ orderId })))?.serverError,
    ).toBeUndefined();
    const accept = await as(alex, () =>
      board.moveOrderAction({ orderId, to: 'ACCEPTED', expectedVersion: version }),
    );
    expect(accept?.serverError?.message).toMatch(/^Order \d+ was cancelled by the customer at /);
  });
});

describe('undo and move back (A8)', () => {
  it('lets only the mover undo within the window, clearing the step time (A8.1, A8.2)', async () => {
    const orderId = await cashOrder(maya);
    const moved = await move(alex, orderId, 'ACCEPTED');

    const stranger = await as(riley, () =>
      board.undoMoveAction({ orderId, eventId: moved.eventId }),
    );
    expect(stranger?.serverError).toMatchObject({
      code: 'UNDO_NOT_ALLOWED',
      message: 'Only Alex Kim can undo this, within 10 seconds. Ask an admin to move it back.',
      details: { why: 'notYours' },
    });
    const tooLate = await as(alex, () =>
      boardService
        .undoMove(alex.actor, { orderId, eventId: moved.eventId }, later(13_000))
        .catch((error: { code?: string; details?: unknown }) => error),
    );
    expect(tooLate).toMatchObject({ code: 'UNDO_NOT_ALLOWED', details: { why: 'expired' } });

    const undone = await as(alex, () => board.undoMoveAction({ orderId, eventId: moved.eventId }));
    expect(undone?.data).toMatchObject({ status: 'PLACED', replayed: false });
    expect(await row(orderId)).toMatchObject({ status: 'PLACED', acceptedAt: null });
    const again = await as(alex, () => board.undoMoveAction({ orderId, eventId: moved.eventId }));
    expect(again?.data).toMatchObject({ replayed: true, eventId: undone?.data?.eventId });
    expect(sentEvents('order.status-reverted')).toHaveLength(1);
    // Back in New, the customer may cancel again (U15).
    expect((await as(maya, () => orders.orderViewAction({ orderId })))?.data?.cancellable).toBe(
      true,
    );

    // A move made since makes the old undo stale.
    const redo = await move(alex, orderId, 'ACCEPTED');
    await move(alex, orderId, 'PREPARING');
    const stale = await as(alex, () => board.undoMoveAction({ orderId, eventId: redo.eventId }));
    expect(stale?.serverError?.details).toMatchObject({ why: 'changed' });
  });

  it('lets an admin move back one step with a reason, audited (A8.3)', async () => {
    const orderId = await cashOrder(maya);
    await advance(orderId, 'READY');
    const { version } = await row(orderId);
    const wrongReason = await as(daniel, () =>
      board.moveBackAction({ orderId, expectedVersion: version, reason: 'not-picked-up' }),
    );
    expect(wrongReason?.serverError?.fieldErrors).toEqual({
      reason: ['Use this reason only for an order that is out for delivery.'],
    });
    const back = await as(daniel, () =>
      board.moveBackAction({
        orderId,
        expectedVersion: version,
        reason: 'other',
        note: 'Bag was missing a drink',
      }),
    );
    expect(back?.data).toMatchObject({ status: 'PREPARING' });
    expect(await row(orderId)).toMatchObject({ status: 'PREPARING', readyAt: null });
    const audit = await migrator.auditLog.findFirstOrThrow({
      where: { action: 'order.moved-back', targetId: orderId },
      select: { actorId: true, data: true },
    });
    expect(audit).toEqual({
      actorId: daniel.userId,
      data: expect.objectContaining({
        from: 'READY',
        to: 'PREPARING',
        reason: 'other',
        hasNote: true,
      }),
    });
    expect(JSON.stringify(audit.data)).not.toContain('drink');
  });
});

// ------------------------------------------------------------------ refusing and cancelling (A6, A7)

/** Gives an order a code use, as checkout does, so a cancellation has one to release. */
async function withCode(orderId: string) {
  const code = `F5${TAG}${uuid().slice(-4).toUpperCase()}`;
  const coupon = await migrator.coupon.create({
    data: { code, type: 'FIXED', value: 200, usageLimit: 1, usedCount: 1 },
    select: { id: true },
  });
  await migrator.order.update({
    where: { id: orderId },
    data: { couponId: coupon.id, promoCode: code, discountCents: 200 },
  });
  await migrator.couponRedemption.create({
    data: {
      couponId: coupon.id,
      userId: maya.userId,
      orderId,
      status: 'REDEEMED',
      discountCents: 200,
    },
  });
  return code;
}

describe('refusing a New order (A6)', () => {
  it('cancels as kitchen-refused, releases the code, marks the dish sold out and tells the customer only her line', async () => {
    const orderId = await cashOrder(maya);
    const code = await withCode(orderId);
    const padThai = await migrator.orderItem.findFirstOrThrow({
      where: { orderId, title: 'Pad Thai' },
      select: { id: true, menuItemId: true },
    });
    const { version } = await row(orderId);
    const refused = await as(alex, () =>
      board.refuseOrderAction({
        orderId,
        expectedVersion: version,
        reason: 'dish-unavailable',
        lineIds: [padThai.id],
        markSoldOut: true,
        note: 'Fryer broke, ask Alex',
      }),
    );
    expect(refused?.data).toMatchObject({
      status: 'CANCELLED',
      refund: { kind: 'none' },
      codeReleased: null,
      soldOut: [{ dishId: padThai.menuItemId, title: 'Pad Thai' }],
      replayed: false,
    });
    expect(await row(orderId)).toMatchObject({
      status: 'CANCELLED',
      cancelReason: 'kitchen-refused',
      cancelCode: 'dish-unavailable',
      cancelLineIds: [padThai.id],
      autoRefundReason: null,
    });
    expect((await migrator.coupon.findUniqueOrThrow({ where: { code } })).usedCount).toBe(0);
    expect((await migrator.couponRedemption.findUniqueOrThrow({ where: { orderId } })).status).toBe(
      'RELEASED',
    );
    expect(
      await migrator.menuItem.findUniqueOrThrow({
        where: { id: padThai.menuItemId },
        select: { isAvailable: true, soldOutById: true },
      }),
    ).toEqual({ isAvailable: false, soldOutById: alex.userId });
    expect((await eventsOf(orderId)).map((event) => event.type).slice(-2)).toEqual([
      'refused',
      'sold-out',
    ]);
    expect(
      await migrator.auditLog.count({ where: { action: 'order.refused', targetId: orderId } }),
    ).toBe(1);
    expect(mocks.publish).toHaveBeenCalledWith(
      'private-ops',
      'menu.availability-changed',
      expect.objectContaining({ dishId: padThai.menuItemId, available: false }),
    );
    expect(
      sentEvents('order.email-requested').filter((event) => event.data.kind !== 'receipt'),
    ).toEqual([
      expect.objectContaining({
        id: `order-email-${orderId}-cancelled`,
        data: expect.objectContaining({ kind: 'cancelled' }),
      }),
    ]);
    expect(sentEvents('order.refund-requested')).toHaveLength(0);

    const view = await as(maya, () => orders.orderViewAction({ orderId }));
    expect(view?.data).toMatchObject({
      cancelReason: 'store',
      progress: {
        cancellation: {
          by: 'store',
          opener: 'sorry',
          reasonLine: 'ranOut',
          dishes: ['Pad Thai'],
          moneyLine: 'nothing',
          codeReleased: code,
        },
      },
    });
    const notification = await migrator.notification.findFirstOrThrow({
      where: { userId: maya.userId, type: 'order.cancelled', link: `/orders/${orderId}` },
      select: { title: true, body: true },
    });
    expect(notification.body).toContain(
      "The kitchen ran out of Pad Thai, so we couldn't make your order.",
    );
    for (const text of [JSON.stringify(view?.data), JSON.stringify(notification)]) {
      expect(text).not.toMatch(/Alex|Fryer|kitchen-refused|dish-unavailable|refused/);
    }

    const replay = await as(alex, () =>
      board.refuseOrderAction({
        orderId,
        expectedVersion: version,
        reason: 'dish-unavailable',
        lineIds: [padThai.id],
      }),
    );
    expect(replay?.data).toMatchObject({ replayed: true, eventId: refused?.data?.eventId });
    expect((await eventsOf(orderId)).filter((event) => event.type === 'refused')).toHaveLength(1);
    await migrator.menuItem.update({
      where: { id: padThai.menuItemId },
      data: { isAvailable: true, soldOutAt: null, soldOutById: null },
    });
  });

  it('is refused once the order is accepted (A6.5), and needs dishes from this order', async () => {
    const orderId = await cashOrder(maya);
    const { version } = await row(orderId);
    const foreign = await as(alex, () =>
      board.refuseOrderAction({
        orderId,
        expectedVersion: version,
        reason: 'dish-unavailable',
        lineIds: [uuid()],
      }),
    );
    expect(foreign?.serverError?.fieldErrors).toEqual({
      lineIds: ["Check the dishes you can't make."],
    });
    await move(alex, orderId, 'ACCEPTED');
    const late = await as(alex, () =>
      board.refuseOrderAction({ orderId, expectedVersion: version + 1, reason: 'too-busy' }),
    );
    expect(late?.serverError).toMatchObject({
      code: 'INVALID_STATE',
      message: `Order ${(await row(orderId)).number} has already been accepted. Ask support or the shift lead to cancel it.`,
    });
  });
});

describe('staff cancellations and their money (A7, T7, T8)', () => {
  it('refunds a paid card order once through the refund job, with no second email (A7.3)', async () => {
    const orderId = await paidCardOrder(maya);
    mocks.send.mockClear();
    const { version, totalCents } = await row(orderId);
    const result = await as(morgan, () =>
      board.staffCancelOrderAction({ orderId, expectedVersion: version, reason: 'customer-asked' }),
    );
    expect(result?.data).toMatchObject({ refund: { kind: 'card', amountCents: totalCents } });
    expect(await row(orderId)).toMatchObject({
      cancelReason: 'staff',
      autoRefundReason: 'staff-cancel',
    });
    expect(sentEvents('order.refund-requested')).toEqual([
      expect.objectContaining({ id: `order-refund-${orderId}` }),
    ]);
    expect(await sync.processAutoRefund(orderId)).toBe('refunded');
    expect(await sync.processAutoRefund(orderId)).toBe('none');
    expect(fake.refunds).toEqual([
      expect.objectContaining({ amountCents: totalCents, reason: 'staff-cancel' }),
    ]);
    expect((await row(orderId)).paymentStatus).toBe('REFUNDED');
    expect(sentEvents('order.email-requested').map((event) => event.data.kind)).toEqual([
      'cancelled',
    ]);
    const view = await as(maya, () => orders.orderViewAction({ orderId }));
    expect(view?.data?.progress.cancellation).toMatchObject({
      opener: 'plain',
      reasonLine: 'atYourRequest',
      moneyLine: 'refunded',
    });
  });

  it('asks a support member signed in over 10 minutes ago for a code before refunding after Accept (A7.10)', async () => {
    const orderId = await paidCardOrder(maya);
    await move(alex, orderId, 'ACCEPTED');
    const intent = fake.intentFor(orderId)!;
    const { totalCents } = await row(orderId);
    await sync.applyRefund({
      paymentIntentId: intent.id,
      refundedCents: 500,
      chargedCents: totalCents,
    });
    await signedInAgo(migrator, morgan.userId, 11);
    const { version } = await row(orderId);
    const cancel = (stepUp?: { method: 'totp' | 'backup'; code: string }) =>
      as(morgan, () =>
        board.staffCancelOrderAction({
          orderId,
          expectedVersion: version,
          reason: 'cant-deliver',
          ...(stepUp && { stepUp }),
        }),
      );

    const preview = await as(morgan, () => board.cancelPreviewAction({ orderId }));
    expect(preview?.data).toMatchObject({
      view: 'full',
      kitchenStarted: true,
      stepUpRequired: true,
      refund: { kind: 'card', amountCents: totalCents - 500, cardLabel: 'Visa •••• 4242' },
    });
    expect((await cancel())?.serverError).toMatchObject({
      code: 'STEP_UP_REQUIRED',
      details: { action: 'refund', windowMinutes: 10 },
    });
    expect((await cancel({ method: 'totp', code: '000000' }))?.serverError).toMatchObject({
      code: 'STEP_UP_INVALID',
      fieldErrors: { stepUp: ["That code didn't work. Check your app and try again."] },
    });
    expect((await row(orderId)).status).toBe('ACCEPTED');

    const done = await cancel({ method: 'totp', code: await morgan.code() });
    expect(done?.data).toMatchObject({ refund: { kind: 'card', amountCents: totalCents - 500 } });
    expect(
      await migrator.auditLog.findFirstOrThrow({
        where: { action: 'order.cancelled-by-staff', targetId: orderId },
        select: { data: true },
      }),
    ).toMatchObject({
      data: expect.objectContaining({ stepUp: true, refundCents: totalCents - 500 }),
    });
    expect(
      (
        await migrator.auditLog.findMany({
          where: { action: 'staff.step-up', actorId: morgan.userId },
          select: { data: true },
        })
      ).map((entry) => (entry.data as { outcome: string }).outcome),
    ).toEqual(['wrong', 'passed']);

    // The code covers the next 10 minutes (A7.10).
    const next = await paidCardOrder(maya);
    await move(alex, next, 'ACCEPTED');
    const covered = await as(morgan, async () =>
      board.staffCancelOrderAction({
        orderId: next,
        expectedVersion: (await row(next)).version,
        reason: 'too-busy',
      }),
    );
    expect(covered?.serverError).toBeUndefined();
  });

  it('locks the code after 5 wrong ones, and takes a backup code once (F2 lockout)', async () => {
    const pat = await staffMember(migrator, 'support', { name: 'Pat Support' });
    await signedInAgo(migrator, pat.userId, 11);
    const orderId = await paidCardOrder(maya);
    await move(alex, orderId, 'ACCEPTED');
    const version = (await row(orderId)).version;
    const attempt = (stepUp: { method: 'totp' | 'backup'; code: string }) =>
      as(pat, () =>
        board.staffCancelOrderAction({
          orderId,
          expectedVersion: version,
          reason: 'too-busy',
          stepUp,
        }),
      );

    const used = await attempt({ method: 'backup', code: BACKUP_CODES[0]! });
    expect(used?.serverError).toBeUndefined();

    const other = await paidCardOrder(maya);
    await move(alex, other, 'ACCEPTED');
    await signedInAgo(migrator, pat.userId, 11);
    await migrator.session.updateMany({ where: { userId: pat.userId }, data: { stepUpAt: null } });
    const otherVersion = (await row(other)).version;
    const again = (stepUp: { method: 'totp' | 'backup'; code: string }) =>
      as(pat, () =>
        board.staffCancelOrderAction({
          orderId: other,
          expectedVersion: otherVersion,
          reason: 'too-busy',
          stepUp,
        }),
      );
    expect((await again({ method: 'backup', code: BACKUP_CODES[0]! }))?.serverError).toMatchObject({
      code: 'STEP_UP_INVALID',
      fieldErrors: { stepUp: ["That backup code didn't work. Each code works once."] },
    });
    for (let i = 0; i < 3; i++) {
      expect((await again({ method: 'totp', code: '000000' }))?.serverError?.code).toBe(
        'STEP_UP_INVALID',
      );
    }
    const locked = await again({ method: 'totp', code: '000000' });
    expect(locked?.serverError).toMatchObject({
      code: 'STEP_UP_LOCKED',
      // A lockout ending on the hour reads "6 am", as the app writes times (F5 clock style).
      message: expect.stringMatching(
        /^Too many wrong codes\. Try again at \d{1,2}(:\d{2})? [ap]m\.$/,
      ),
      details: { retryAt: expect.any(String) },
    });
    expect(locked?.serverError?.retryAfterSeconds).toBeGreaterThan(14 * 60);
    expect((await again({ method: 'totp', code: await pat.code() }))?.serverError?.code).toBe(
      'STEP_UP_LOCKED',
    );
    expect((await row(other)).status).toBe('ACCEPTED');
  });

  it('checks no more than 5 codes when wrong guesses arrive all at once (S19)', async () => {
    const sam = await staffMember(migrator, 'support', { name: 'Sam Support' });
    await signedInAgo(migrator, sam.userId, 11);
    const orderId = await paidCardOrder(maya);
    await move(alex, orderId, 'ACCEPTED');
    const version = (await row(orderId)).version;
    const guesses = await as(sam, () =>
      Promise.all(
        Array.from({ length: 8 }, () =>
          board.staffCancelOrderAction({
            orderId,
            expectedVersion: version,
            reason: 'too-busy',
            stepUp: { method: 'totp', code: '000000' },
          }),
        ),
      ),
    );
    const codes = guesses.map((result) => result?.serverError?.code);
    expect(codes.every((code) => code === 'STEP_UP_INVALID' || code === 'STEP_UP_LOCKED')).toBe(
      true,
    );
    // Five tries at most are checked; the fifth wrong one locks, and the rest never reach the check.
    expect(codes.filter((code) => code === 'STEP_UP_INVALID').length).toBeLessThanOrEqual(4);
    expect(codes.filter((code) => code === 'STEP_UP_LOCKED').length).toBeGreaterThanOrEqual(4);
    const outcomes = (
      await migrator.auditLog.findMany({
        where: { action: 'staff.step-up', actorId: sam.userId },
        select: { data: true },
      })
    ).map((entry) => (entry.data as { outcome: string }).outcome);
    expect(outcomes).toHaveLength(8);
    expect(outcomes.filter((outcome) => outcome === 'wrong').length).toBeLessThanOrEqual(4);
    expect(
      (await migrator.twoFactor.findFirstOrThrow({ where: { userId: sam.userId } })).lockedUntil,
    ).not.toBeNull();
    const good = await as(sam, async () =>
      board.staffCancelOrderAction({
        orderId,
        expectedVersion: version,
        reason: 'too-busy',
        stepUp: { method: 'totp', code: await sam.code() },
      }),
    );
    expect(good?.serverError?.code).toBe('STEP_UP_LOCKED');
    expect((await row(orderId)).status).toBe('ACCEPTED');
  });

  it('never asks for a code or refunds for a sample card, cash or New order', async () => {
    const sample = await cashOrder(priya);
    await migrator.order.update({
      where: { id: sample },
      data: { paymentMethod: 'CARD', paymentStatus: 'PAID', cardBrand: 'visa', cardLast4: '4242' },
    });
    await move(alex, sample, 'ACCEPTED');
    await signedInAgo(migrator, daniel.userId, 30);
    await migrator.session.updateMany({
      where: { userId: daniel.userId },
      data: { stepUpAt: null },
    });
    const result = await as(daniel, async () =>
      board.staffCancelOrderAction({
        orderId: sample,
        expectedVersion: (await row(sample)).version,
        reason: 'closing',
      }),
    );
    expect(result?.data).toMatchObject({ refund: { kind: 'sample' } });
    expect(fake.count('refund')).toBe(0);
    expect(
      (await as(priya, () => orders.orderViewAction({ orderId: sample })))?.data?.progress
        .cancellation,
    ).toMatchObject({
      moneyLine: 'sample',
      reasonLine: 'closedEarly',
    });

    const cash = await cashOrder(maya);
    await move(alex, cash, 'ACCEPTED');
    const cashResult = await as(daniel, async () =>
      board.staffCancelOrderAction({
        orderId: cash,
        expectedVersion: (await row(cash)).version,
        reason: 'too-busy',
      }),
    );
    expect(cashResult?.data).toMatchObject({ refund: { kind: 'none' } });
  });

  it('refuses a stale cancel with who changed it, takes it with the new version, and never out for delivery (A5.5, A7.1)', async () => {
    const orderId = await cashOrder(maya);
    await move(alex, orderId, 'ACCEPTED');
    const seen = (await row(orderId)).version;
    await move(alex, orderId, 'PREPARING');
    const stale = await as(morgan, () =>
      board.staffCancelOrderAction({ orderId, expectedVersion: seen, reason: 'too-busy' }),
    );
    expect(stale?.serverError).toMatchObject({
      code: 'ORDER_CHANGED',
      details: { current: { status: 'PREPARING' } },
    });
    // "Cancel it anyway?" sends the version the refusal named (A5.5).
    const { current } = (stale?.serverError?.details ?? {}) as { current?: { version: number } };
    expect(current?.version).toBe((await row(orderId)).version);
    expect(
      (
        await as(morgan, () =>
          board.staffCancelOrderAction({
            orderId,
            expectedVersion: current?.version ?? -1,
            reason: 'too-busy',
          }),
        )
      )?.data?.status,
    ).toBe('CANCELLED');

    const out = await cashOrder(maya);
    await advance(out, 'READY');
    await as(daniel, async () =>
      board.markPickedUpAction({
        orderId: out,
        expectedVersion: (await row(out)).version,
        reason: 'own-driver',
      }),
    );
    const refused = await as(morgan, async () =>
      board.staffCancelOrderAction({
        orderId: out,
        expectedVersion: (await row(out)).version,
        reason: 'too-busy',
      }),
    );
    expect(refused?.serverError?.code).toBe('INVALID_STATE');
  });
});

// ------------------------------------------------------------------ handing over (A9)

describe('handing over by hand (A9, U23)', () => {
  it('marks picked up and delivered, collects the cash and tells the customer once each', async () => {
    const orderId = await cashOrder(maya);
    await advance(orderId, 'READY');
    const picked = await as(daniel, async () =>
      board.markPickedUpAction({
        orderId,
        expectedVersion: (await row(orderId)).version,
        reason: 'own-driver',
      }),
    );
    expect(picked?.data).toMatchObject({ status: 'PICKED_UP' });
    const version = (await row(orderId)).version;
    const noCash = await as(daniel, () =>
      board.markDeliveredAction({ orderId, expectedVersion: version, reason: 'own-driver' }),
    );
    expect(noCash?.serverError?.fieldErrors).toEqual({
      cashCollected: ['Check this box once you have the cash.'],
    });
    const delivered = await as(daniel, () =>
      board.markDeliveredAction({
        orderId,
        expectedVersion: version,
        reason: 'own-driver',
        cashCollected: true,
      }),
    );
    expect(delivered?.data).toMatchObject({ status: 'DELIVERED' });
    const stored = await row(orderId);
    expect(stored).toMatchObject({ status: 'DELIVERED', paymentStatus: 'PAID' });
    expect((await eventsOf(orderId)).at(-1)?.data).toMatchObject({
      cashCollectedCents: stored.totalCents,
    });
    expect(
      await migrator.auditLog.findFirst({
        where: { action: 'order.marked-delivered', targetId: orderId },
        select: { data: true },
      }),
    ).toMatchObject({ data: expect.objectContaining({ cashCollectedCents: stored.totalCents }) });
    const titles = (
      await migrator.notification.findMany({
        where: { link: `/orders/${orderId}` },
        select: { title: true, body: true },
      })
    ).map((notice) => notice.title);
    expect(titles).toEqual(
      expect.arrayContaining([
        `Order ${stored.number} is on its way`,
        `Order ${stored.number} was delivered`,
      ]),
    );
    const view = await as(maya, () => orders.orderViewAction({ orderId }));
    expect(view?.data?.progress).toMatchObject({ cashCollected: true, live: false });
  });

  it('sends no "On its way" when the customer collected it, and the step reads Collected', async () => {
    const orderId = await cashOrder(maya);
    await advance(orderId, 'READY');
    await as(daniel, async () =>
      board.markPickedUpAction({
        orderId,
        expectedVersion: (await row(orderId)).version,
        reason: 'customer-collected',
      }),
    );
    expect(
      await migrator.notification.count({
        where: { link: `/orders/${orderId}`, type: 'order.picked-up' },
      }),
    ).toBe(0);
    const view = await as(maya, () => orders.orderViewAction({ orderId }));
    expect(view?.data?.progress.steps?.find((step) => step.key === 'pickedUp')).toMatchObject({
      collected: true,
    });
  });
});

// ------------------------------------------------------------------ "86 it"

describe('"86 it" (lead decision, T19)', () => {
  it('marks a dish sold out once, audited and announced, with who and since', async () => {
    const gimbap = dish.gimbap!;
    const first = await as(alex, () =>
      board.setDishAvailabilityAction({ dishId: gimbap, available: false }),
    );
    expect(first?.data).toEqual({
      dishId: gimbap,
      title: 'Gimbap',
      available: false,
      changed: true,
    });
    const repeat = await as(alex, () =>
      board.setDishAvailabilityAction({ dishId: gimbap, available: false }),
    );
    expect(repeat?.data?.changed).toBe(false);
    expect(
      await migrator.auditLog.count({ where: { action: 'menu.dish-sold-out', targetId: gimbap } }),
    ).toBe(1);
    expect(mocks.publish).toHaveBeenCalledWith(
      'private-ops',
      'menu.availability-changed',
      expect.objectContaining({ dishId: gimbap, available: false }),
    );

    const sheet = await as(daniel, () => board.boardDishesAction({}));
    expect(sheet?.data?.dishes.find((entry) => entry.dishId === gimbap)).toMatchObject({
      available: false,
      soldOutByName: 'Alex Kim',
    });
    const strip = await as(demo, () => board.boardSnapshotAction({}));
    // Alex is a sample account, so the demo admin may read the name.
    expect(strip?.data?.soldOut).toContainEqual(
      expect.objectContaining({ dishId: gimbap, byName: 'Alex Kim' }),
    );

    await as(riley, () => board.setDishAvailabilityAction({ dishId: gimbap, available: true }));
    await as(riley, () => board.setDishAvailabilityAction({ dishId: gimbap, available: false }));
    const masked = await as(demo, () => board.boardSnapshotAction({}));
    expect(masked?.data?.soldOut).toContainEqual(
      expect.objectContaining({ dishId: gimbap, byName: null }),
    );
    const back = await as(riley, () =>
      board.setDishAvailabilityAction({ dishId: gimbap, available: true }),
    );
    expect(back?.data).toMatchObject({ available: true, changed: true });
    expect(
      await migrator.auditLog.count({ where: { action: 'menu.dish-back-on', targetId: gimbap } }),
    ).toBe(2);
  });
});

// ------------------------------------------------------------------ what each role reads (A13.1, A14)

describe('what each role reads (A13.1, A14.2, T10, T11)', () => {
  it('gives the kitchen no contact details, last name or amount, in the board, the cards and the detail', async () => {
    const orderId = await cashOrder(maya);
    const snapshot = await as(alex, () => board.boardSnapshotAction({}));
    expect(snapshot?.data).toMatchObject({
      view: 'kitchen',
      columns: ['new', 'accepted', 'preparing', 'ready'],
    });
    const card = snapshot?.data?.cards.find((entry) => entry.id === orderId);
    expect(card).toMatchObject({
      view: 'kitchen',
      firstName: 'Maya',
      payment: { method: 'cash', paid: false },
    });
    const detail = await as(alex, () => board.staffOrderDetailAction({ orderId }));
    const cards = await as(alex, () => board.boardCardsAction({ orderIds: [orderId] }));
    const preview = await as(alex, () => board.cancelPreviewAction({ orderId }));
    for (const data of [card, detail?.data, cards?.data, preview?.data]) {
      const text = JSON.stringify(data);
      expect(text).not.toMatch(
        /Lopez|555-?0123|Faneuil|Buzzer|@example|Cents"|phone|address|instructions/i,
      );
    }
  });

  it('gives support and admin the money and the customer, and the Out for delivery column', async () => {
    const orderId = await cashOrder(maya);
    const snapshot = await as(morgan, () => board.boardSnapshotAction({}));
    expect(snapshot?.data?.columns).toContain('outForDelivery');
    expect(snapshot?.data?.cards.find((entry) => entry.id === orderId)).toMatchObject({
      view: 'full',
      payment: {
        method: 'cash',
        status: 'UNPAID',
        totalCents: (await row(orderId)).totalCents,
        flags: [],
      },
    });
    const detail = await as(daniel, () => board.staffOrderDetailAction({ orderId }));
    expect(detail?.data).toMatchObject({
      view: 'full',
      masked: { customer: false },
      customer: { name: 'Maya Lopez', phone: '+16175550123', phoneDisplay: '(617) 555-0123' },
    });
  });

  it("masks a real customer's details and code for the demo admin, and shows sample customers in full", async () => {
    const real = await paidCardOrder(maya);
    const code = await withCode(real);
    await migrator.coupon.update({
      where: { code },
      data: { ownerUserId: maya.userId, isStoreCredit: true },
    });
    await move(riley, real, 'ACCEPTED');
    const detail = await as(demo, () => board.staffOrderDetailAction({ orderId: real }));
    expect(detail?.data).toMatchObject({
      view: 'full',
      masked: { customer: true },
      customer: { firstName: 'M•••', phone: null },
      money: { promo: { code: null }, cardLabel: 'Visa' },
      actions: { readOnly: true },
    });
    const timeline = (detail?.data?.timeline ?? []).find((entry) => entry.type === 'accepted');
    expect(timeline?.by).toEqual({ kind: 'staff', name: null, role: 'kitchen' });
    expect(JSON.stringify(detail?.data)).not.toMatch(/Maya|Lopez|0123|Faneuil|4242/);

    const sample = await cashOrder(priya);
    const full = await as(demo, () => board.staffOrderDetailAction({ orderId: sample }));
    expect(full?.data).toMatchObject({
      masked: { customer: false },
      customer: { name: 'Maya Lopez' },
    });
  });

  it('finds an order by number on or off the board, and answers no order', async () => {
    const orderId = await cashOrder(maya);
    const { number } = await row(orderId);
    expect(
      (await as(morgan, () => board.findOrderAction({ query: ` #${number} ` })))?.data,
    ).toEqual({
      kind: 'onBoard',
      orderId,
      number,
      status: 'PLACED',
    });
    expect((await as(morgan, () => board.findOrderAction({ query: '987654321' })))?.data).toEqual({
      kind: 'none',
      number: '987654321',
    });
    expect(
      (await as(morgan, () => board.findOrderAction({ query: 'pad thai' })))?.validationErrors,
    ).toBeDefined();
    expect(
      (await as(morgan, () => board.staffOrderDetailAction({ orderId: uuid() })))?.serverError
        ?.code,
    ).toBe('NOT_FOUND');
  });

  it('says who made a card leave the board, never over the WebSocket (A3.7)', async () => {
    const orderId = await cashOrder(maya);
    await as(morgan, async () =>
      board.staffCancelOrderAction({
        orderId,
        expectedVersion: (await row(orderId)).version,
        reason: 'too-busy',
      }),
    );
    const cards = await as(alex, () => board.boardCardsAction({ orderIds: [orderId] }));
    expect(cards?.data).toMatchObject({
      cards: [],
      gone: [
        {
          id: orderId,
          left: 'cancelled',
          by: { kind: 'staff', name: 'Morgan Diaz', role: 'support' },
        },
      ],
    });
  });
});

// ------------------------------------------------------------------ the customer's notices (S6, T18)

describe("the customer's step notices (S6.1 to S6.3)", () => {
  it('sends Accepted once, after the undo window, and never for an undone step', async () => {
    const orderId = await cashOrder(maya);
    const first = await move(alex, orderId, 'ACCEPTED');
    await as(alex, () => board.undoMoveAction({ orderId, eventId: first.eventId }));
    expect(
      await notices.sendOrderStepNotice({ orderId, step: 'accepted', eventId: first.eventId }),
    ).toBe('undone');
    const second = await move(alex, orderId, 'ACCEPTED');
    expect(
      await notices.sendOrderStepNotice({ orderId, step: 'accepted', eventId: second.eventId }),
    ).toBe('send');
    expect(
      await notices.sendOrderStepNotice({ orderId, step: 'accepted', eventId: second.eventId }),
    ).toBe('already-sent');
    const sent = await migrator.notification.findMany({
      where: { link: `/orders/${orderId}`, type: 'order.accepted' },
      select: { title: true, body: true },
    });
    expect(sent).toEqual([
      {
        title: `Order ${(await row(orderId)).number} accepted`,
        body: 'The kitchen has your order and will start cooking soon.',
      },
    ]);
    // Redone after a move back: still once.
    const { version } = await row(orderId);
    await as(daniel, () =>
      board.moveBackAction({ orderId, expectedVersion: version, reason: 'wrong-ticket' }),
    );
    const third = await move(alex, orderId, 'ACCEPTED');
    expect(
      await notices.sendOrderStepNotice({ orderId, step: 'accepted', eventId: third.eventId }),
    ).toBe('already-sent');
  });

  it('drops Accepted when Ready overtakes it, and any notice once cancelled', async () => {
    const orderId = await cashOrder(maya);
    const accepted = await move(alex, orderId, 'ACCEPTED');
    await move(alex, orderId, 'PREPARING');
    expect(
      await notices.sendOrderStepNotice({ orderId, step: 'accepted', eventId: accepted.eventId }),
    ).toBe('send');
    const other = await cashOrder(maya);
    const acceptedOther = await move(alex, other, 'ACCEPTED');
    await move(alex, other, 'PREPARING');
    const ready = await move(alex, other, 'READY');
    expect(
      await notices.sendOrderStepNotice({
        orderId: other,
        step: 'accepted',
        eventId: acceptedOther.eventId,
      }),
    ).toBe('overtaken');
    expect(
      await notices.sendOrderStepNotice({ orderId: other, step: 'ready', eventId: ready.eventId }),
    ).toBe('send');
    const cancelled = await cashOrder(maya);
    const acceptedCancelled = await move(alex, cancelled, 'ACCEPTED');
    await as(morgan, async () =>
      board.staffCancelOrderAction({
        orderId: cancelled,
        expectedVersion: (await row(cancelled)).version,
        reason: 'too-busy',
      }),
    );
    expect(
      await notices.sendOrderStepNotice({
        orderId: cancelled,
        step: 'accepted',
        eventId: acceptedCancelled.eventId,
      }),
    ).toBe('cancelled');
  });
});

describe('the customer side (S1, S7.5, T16)', () => {
  it('shows each step with its time and the kitchen, never a staff name', async () => {
    const orderId = await cashOrder(maya);
    await move(alex, orderId, 'ACCEPTED');
    const view = await as(maya, () => orders.orderViewAction({ orderId }));
    expect(view?.data?.progress.steps?.map((step) => step.state)).toEqual([
      'done',
      'current',
      'upcoming',
      'upcoming',
      'upcoming',
      'upcoming',
    ]);
    expect(view?.data?.timeline.map((entry) => entry.kind)).toEqual(['placed', 'accepted']);
    expect(JSON.stringify(view?.data)).not.toContain('Alex');
    const list = await as(maya, () => orders.listOrdersAction({}));
    expect(list?.data?.inProgress.find((entry) => entry.id === orderId)).toMatchObject({
      status: 'ACCEPTED',
      arrival: expect.objectContaining({ kind: 'promised' }),
      reorderable: false,
    });
  });

  it("orders again only from the caller's own finished order", async () => {
    const orderId = await cashOrder(maya);
    await as(morgan, async () =>
      board.staffCancelOrderAction({
        orderId,
        expectedVersion: (await row(orderId)).version,
        reason: 'too-busy',
      }),
    );
    const again = await as(maya, () => progress.reorderAction({ orderId }));
    expect(again?.data).toMatchObject({ addedQuantity: 3, leftOut: [] });
    expect((await as(priya, () => progress.reorderAction({ orderId })))?.serverError).toMatchObject(
      {
        code: 'NOT_FOUND',
        message: 'Order not found.',
      },
    );
    const live = await cashOrder(maya);
    expect(
      (await as(maya, () => progress.reorderAction({ orderId: live })))?.serverError?.code,
    ).toBe('NOT_FOUND');
  });
});
