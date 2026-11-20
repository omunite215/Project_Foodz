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
import { db } from '@/server/db/client';
import { type Actor, runAs, runAsSystem } from '@/server/db/context';
import { PrismaClient } from '@/server/db/generated/client';
import { setPaymentGatewayForTests } from '@/server/payments/stripe';
import { redis } from '@/server/redis';
import { FakeStripe, MASTERCARD, VISA } from '../support/fake-stripe';
import { seedCatalog } from '../../prisma/seeding';
import { nextHeaders, switchBrowser } from './support/browser';
import {
  type Customer,
  customer,
  dishIds,
  line,
  openAllDay,
  press,
  restoreHours,
} from './support/checkout';

/*
 * The customer's orders after the press (F4 S7.6, S9, S11, S12, S6.13, B7, B8, B21): the order
 * page and its poll, the Orders list, cancelling, finishing a payment, the expiry job and its
 * sweep, saved cards, the account hooks, and row-level security on orders.
 */

const mocks = vi.hoisted(() => ({
  send: vi.fn<(event: unknown) => Promise<unknown>>(async () => ({ ids: ['evt'] })),
  publish: vi.fn<() => Promise<void>>(async () => undefined),
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

const orders = await import('@/server/modules/orders/actions');
const cards = await import('@/server/modules/payments/actions');
const account = await import('@/server/modules/account/actions');
const service = await import('@/server/modules/orders/service');
const sync = await import('@/server/modules/orders/payment-sync');
const { keepSavedCard } = await import('@/server/modules/payments/service');

let migrator: PrismaClient;
let dish: Record<string, string> = {};
let fake: FakeStripe;
const addedCodes: string[] = [];
const TAG = crypto.randomUUID().slice(0, 6).toUpperCase();

type UserActor = Extract<Actor, { kind: 'user' }>;

const actorOf = (who: Customer, extra: Partial<UserActor> = {}): UserActor => ({
  kind: 'user',
  userId: who.userId,
  role: 'customer',
  isDemo: false,
  ...extra,
});

const emails = (orderId: string) =>
  mocks.send.mock.calls
    .map(([event]) => event as { name: string; data: { orderId?: string; kind?: string } })
    .filter((event) => event.name === 'order.email-requested' && event.data.orderId === orderId)
    .map((event) => event.data.kind);

async function cashOrder(who: Customer, extra: Parameters<typeof press>[2] = {}) {
  switchBrowser(who.browser);
  const result = await orders.placeOrderAction(
    press(who, dish, { allowDuplicate: true, ...extra }),
  );
  expect(result?.serverError).toBeUndefined();
  return result.data!;
}

async function cardOrder(who: Customer, extra: Parameters<typeof press>[2] = {}) {
  switchBrowser(who.browser);
  const result = await orders.placeOrderAction(
    press(who, dish, { method: 'card', card: { kind: 'new' }, allowDuplicate: true, ...extra }),
  );
  expect(result?.serverError).toBeUndefined();
  const data = result.data!;
  return { ...data, intentId: fake.intentFor(data.orderId)!.id };
}

async function paidCardOrder(who: Customer) {
  const order = await cardOrder(who);
  fake.succeed(order.intentId, VISA);
  await orders.orderStatusAction({ orderId: order.orderId, confirmed: true });
  return order;
}

const later = (minutes: number) => new Date(Date.now() + minutes * 60_000);

beforeAll(async () => {
  migrator = new PrismaClient({
    adapter: new PrismaPg({ connectionString: inject('migratorUrl') }),
  });
  await migrator.$transaction((tx) => seedCatalog(tx, { now: new Date() }), { timeout: 60_000 });
  dish = await dishIds(migrator);
  await openAllDay(migrator);
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fake');
  vi.stubEnv('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', 'pk_test_fake');
}, 120_000);

beforeEach(() => {
  fake = new FakeStripe();
  setPaymentGatewayForTests(fake);
  mocks.send.mockClear();
});

afterEach(() => {
  setPaymentGatewayForTests(undefined);
});

afterAll(async () => {
  await restoreHours(migrator);
  await migrator.couponRedemption.deleteMany({ where: { coupon: { code: { in: addedCodes } } } });
  await migrator.order.updateMany({
    where: { coupon: { code: { in: addedCodes } } },
    data: { couponId: null },
  });
  await migrator.coupon.deleteMany({ where: { code: { in: addedCodes } } });
  await migrator.$disconnect();
  await redis.quit();
  vi.unstubAllEnvs();
});

describe('the order page (S11)', () => {
  it('shows the stored order, never re-quoted, with the arrival as clock times (S11.1, S3.2)', async () => {
    const maya = await customer(migrator);
    const placed = await cashOrder(maya, {
      tip: { kind: 'percent', percent: 15 },
      expectedTotalCents: 6117,
    });
    const view = await orders.orderViewAction({ orderId: placed.orderId });
    expect(view?.data).toMatchObject({
      number: placed.number,
      status: 'PLACED',
      cancellable: true,
      payable: false,
      payment: { method: 'cash', status: 'UNPAID', card: null },
      breakdown: {
        subtotalCents: 4797,
        deliveryFeeCents: 264,
        tax: { rateBps: 700, cents: 336 },
        tipCents: 720,
        tipChoice: '15',
        totalCents: 6117,
        promo: null,
      },
      delivery: {
        label: 'Work',
        line1: '1 Faneuil Hall Square',
        line2: 'Apt 4',
        instructions: 'Buzzer 3, leave at the door',
      },
      contact: { name: 'Maya Lopez', firstName: 'Maya', phoneDisplay: '(617) 555-0123' },
      store: { phone: '(617) 555-0142', timeZone: 'America/New_York' },
    });
    const { arrival, placedAt, timeline } = view.data!;
    expect(Date.parse(arrival!.from!) - Date.parse(placedAt!)).toBe(arrival!.fromMinutes * 60_000);
    expect(timeline.map((entry) => entry.kind)).toEqual(['placed']);
    // A price change afterwards changes nothing on the page.
    await migrator.menuItem.update({ where: { slug: 'gimbap' }, data: { priceCents: 1499 } });
    try {
      expect(
        (await orders.orderViewAction({ orderId: placed.orderId }))?.data?.breakdown.subtotalCents,
      ).toBe(4797);
    } finally {
      await migrator.menuItem.update({ where: { slug: 'gimbap' }, data: { priceCents: 1299 } });
    }
  });

  it("answers not found for someone else's order, a made-up id and an order number (S11.6, S12.9)", async () => {
    const owner = await customer(migrator);
    const placed = await cashOrder(owner);
    const other = await customer(migrator);
    for (const call of [
      () => orders.orderViewAction({ orderId: placed.orderId }),
      () => orders.orderStatusAction({ orderId: placed.orderId }),
      () => orders.cancelOrderAction({ orderId: placed.orderId }),
      () => orders.resumePaymentAction({ orderId: placed.orderId }),
      () => orders.orderViewAction({ orderId: uuid() }),
    ]) {
      expect((await call())?.serverError?.code).toBe('NOT_FOUND');
    }
    expect(await service.getOrderView(actorOf(other), placed.number)).toBeNull();
    expect(
      (await orders.orderViewAction({ orderId: placed.number }))?.validationErrors,
    ).toBeDefined();
    expect((await migrator.order.findUniqueOrThrow({ where: { id: placed.orderId } })).status).toBe(
      'PLACED',
    );
  });

  it('tells what became of a press by its key, and nothing about others (S7.3, B16)', async () => {
    const maya = await customer(migrator);
    const input = press(maya, dish, { method: 'card', card: { kind: 'new' } });
    expect((await orders.attemptStatusAction({ attemptKey: input.attemptKey }))?.data).toEqual({
      kind: 'notFound',
    });
    const placed = await orders.placeOrderAction(input);
    expect(
      (await orders.attemptStatusAction({ attemptKey: input.attemptKey }))?.data,
    ).toMatchObject({
      kind: 'awaitingPayment',
      orderId: placed?.data?.orderId,
    });
    fake.succeed(fake.intentFor(placed.data!.orderId)!.id);
    // The order is 5 seconds old by the time the browser asks again; here we force the check.
    await sync.checkWithStripe(placed.data!.orderId, { confirmed: true });
    expect((await orders.attemptStatusAction({ attemptKey: input.attemptKey }))?.data).toEqual({
      kind: 'placed',
      orderId: placed?.data?.orderId,
      number: placed?.data?.number,
    });
    switchBrowser((await customer(migrator)).browser);
    expect((await orders.attemptStatusAction({ attemptKey: input.attemptKey }))?.data).toEqual({
      kind: 'notFound',
    });
  });

  it('waits for the browser or 5 seconds before asking Stripe (B7)', async () => {
    const maya = await customer(migrator);
    const order = await cardOrder(maya);
    fake.succeed(order.intentId);
    expect((await orders.orderStatusAction({ orderId: order.orderId }))?.data?.status).toBe(
      'PENDING_PAYMENT',
    );
    expect(fake.count('retrieveIntent')).toBe(0);
    expect(
      (await orders.orderStatusAction({ orderId: order.orderId, confirmed: true }))?.data?.status,
    ).toBe('PLACED');
  });
});

describe('the Orders list (S12.1 to S12.4)', () => {
  it('lists in-progress orders first, leaves failed attempts out and labels expired ones', async () => {
    const maya = await customer(migrator);
    const delivered = await cashOrder(maya);
    await migrator.order.update({
      where: { id: delivered.orderId },
      data: { status: 'DELIVERED' },
    });
    const failed = await cardOrder(maya);
    fake.decline(failed.intentId);
    await orders.orderStatusAction({ orderId: failed.orderId, confirmed: true });
    const expired = await cardOrder(maya, {
      lines: [line(dish, 'kimchi')],
      expectedTotalCents: 1012,
    });
    await sync.expireUnpaidOrder(expired.orderId, later(16));
    const placed = await cashOrder(maya, {
      lines: [line(dish, 'gimbap', 3)],
      expectedTotalCents: 4434,
    });

    const page = await orders.listOrdersAction({});
    expect(page?.data?.inProgress.map((order) => [order.number, order.statusWord])).toEqual([
      [placed.number, 'placed'],
    ]);
    expect(page?.data?.past.map((order) => [order.number, order.statusWord])).toEqual([
      [expired.number, 'expired'],
      [delivered.number, 'delivered'],
    ]);
    expect(page?.data?.past[1]).toMatchObject({
      dishes: [
        { title: 'Gimbap', quantity: 2 },
        { title: 'Pad Thai', quantity: 1 },
      ],
      moreCount: 0,
      method: 'cash',
      totalCents: 5397,
      moneyFlag: null,
    });
    expect(page?.data?.nextCursor).toBeNull();
    expect((await account.getAccountAction())?.data).toMatchObject({ orderCount: 3 });
  });

  it('pages 20 at a time with a cursor (S12.2)', async () => {
    const maya = await customer(migrator);
    const base = Date.now() - 10 * 24 * 60 * 60 * 1000;
    await migrator.order.createMany({
      data: Array.from({ length: 23 }, (_, index) => ({
        number: `T${TAG}${index}`,
        userId: maya.userId,
        status: 'DELIVERED' as const,
        paymentMethod: 'CASH' as const,
        paymentStatus: 'PAID' as const,
        contactName: 'Maya',
        contactPhone: '+16175550123',
        addressText: '1 Faneuil Hall Square',
        addressLat: 42.36,
        addressLng: -71.0548,
        distanceKm: 1.3,
        subtotalCents: 1000,
        deliveryFeeCents: 264,
        taxCents: 70,
        totalCents: 1334,
        createdAt: new Date(base + index * 60_000),
      })),
    });
    const first = await orders.listOrdersAction({});
    expect(first?.data?.past).toHaveLength(20);
    expect(first?.data?.past[0]?.number).toBe(`T${TAG}22`);
    const second = await orders.listOrdersAction({ cursor: first.data!.nextCursor! });
    expect(second?.data?.inProgress).toEqual([]);
    expect(second?.data?.past.map((order) => order.number)).toEqual([
      `T${TAG}2`,
      `T${TAG}1`,
      `T${TAG}0`,
    ]);
    expect(second?.data?.nextCursor).toBeNull();
    expect((await orders.listOrdersAction({ cursor: 'not-a-cursor' }))?.serverError?.code).toBe(
      'INVALID_INPUT',
    );
  });
});

describe('cancelling until the kitchen accepts (U6, S12.5, S12.6)', () => {
  it('cancels a cash order, gives the code back and sends one email (D45)', async () => {
    const code = `CAN${TAG}`;
    addedCodes.push(code);
    await migrator.coupon.create({ data: { code, type: 'FIXED', value: 200, usageLimit: 3 } });
    const maya = await customer(migrator);
    const placed = await cashOrder(maya, { code, expectedTotalCents: 5183 });
    mocks.send.mockClear();
    const result = await orders.cancelOrderAction({ orderId: placed.orderId });
    expect(result?.data).toEqual({
      orderId: placed.orderId,
      number: placed.number,
      status: 'CANCELLED',
      refund: null,
    });
    expect(await migrator.order.findUniqueOrThrow({ where: { id: placed.orderId } })).toMatchObject(
      {
        status: 'CANCELLED',
        cancelReason: 'customer',
      },
    );
    expect(
      (await migrator.couponRedemption.findUniqueOrThrow({ where: { orderId: placed.orderId } }))
        .status,
    ).toBe('RELEASED');
    expect((await migrator.coupon.findUniqueOrThrow({ where: { code } })).usedCount).toBe(0);
    // A double press cancels once.
    expect((await orders.cancelOrderAction({ orderId: placed.orderId }))?.data?.status).toBe(
      'CANCELLED',
    );
    expect(emails(placed.orderId)).toEqual(['cancelled']);
  });

  it('cancels an unpaid card order and its payment at Stripe (S7.6)', async () => {
    const maya = await customer(migrator);
    const order = await cardOrder(maya);
    expect((await orders.cancelOrderAction({ orderId: order.orderId }))?.data?.refund).toBeNull();
    expect(fake.intents.get(order.intentId)?.status).toBe('canceled');
    // The code can be used again and a new order placed at once (S9.6).
    expect((await cashOrder(maya)).kind).toBe('placed');
  });

  it('refunds a paid card order in full, once, with the cancellation email only (D45)', async () => {
    const maya = await customer(migrator);
    const order = await paidCardOrder(maya);
    mocks.send.mockClear();
    const result = await orders.cancelOrderAction({ orderId: order.orderId });
    expect(result?.data?.refund).toEqual({ amountCents: 5397, cardLabel: 'Visa •••• 4242' });
    expect(await sync.processAutoRefund(order.orderId)).toBe('refunded');
    expect(await sync.processAutoRefund(order.orderId)).toBe('none');
    expect(fake.refunds).toEqual([
      expect.objectContaining({ amountCents: 5397, reason: 'customer-cancel' }),
    ]);
    expect(await migrator.order.findUniqueOrThrow({ where: { id: order.orderId } })).toMatchObject({
      status: 'CANCELLED',
      paymentStatus: 'REFUNDED',
      refundedCents: 5397,
    });
    expect(emails(order.orderId)).toEqual(['cancelled']);
    const view = await orders.orderViewAction({ orderId: order.orderId });
    expect(view?.data?.timeline.map((entry) => entry.kind)).toEqual([
      'placed',
      'cancelled',
      'refunded',
    ]);
  });

  it('refuses once the kitchen has started, with the store phone (S12.6)', async () => {
    const maya = await customer(migrator);
    const placed = await cashOrder(maya);
    await migrator.order.update({ where: { id: placed.orderId }, data: { status: 'ACCEPTED' } });
    expect((await orders.cancelOrderAction({ orderId: placed.orderId }))?.serverError).toEqual({
      code: 'KITCHEN_STARTED',
      message: `The kitchen has already started on order ${placed.number}, so it can't be cancelled here. Call us on (617) 555-0142.`,
      details: { orderId: placed.orderId, number: placed.number, phone: '(617) 555-0142' },
    });
  });

  it('refuses while the bank is still confirming the payment (S7.6)', async () => {
    const maya = await customer(migrator);
    const order = await cardOrder(maya);
    fake.processing(order.intentId);
    expect((await orders.cancelOrderAction({ orderId: order.orderId }))?.serverError).toMatchObject(
      {
        code: 'PAYMENT_IN_PROGRESS',
        message: `Your bank is still confirming order ${order.number}. Give it a minute.`,
      },
    );
    expect((await migrator.order.findUniqueOrThrow({ where: { id: order.orderId } })).status).toBe(
      'PENDING_PAYMENT',
    );
  });

  it('refuses the demo account, and allows 10 cancellations an hour', async () => {
    const dana = await customer(migrator);
    const placed = await cashOrder(dana);
    await migrator.user.update({ where: { id: dana.userId }, data: { isDemo: true } });
    expect((await orders.cancelOrderAction({ orderId: placed.orderId }))?.serverError).toEqual({
      code: 'DEMO_READ_ONLY',
      message: "Demo accounts can't place orders.",
    });
    await customer(migrator);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect((await orders.cancelOrderAction({ orderId: uuid() }))?.serverError?.code).toBe(
        'NOT_FOUND',
      );
    }
    expect((await orders.cancelOrderAction({ orderId: uuid() }))?.serverError?.code).toBe(
      'RATE_LIMITED',
    );
  });
});

describe('finishing a payment (S7.6)', () => {
  it('returns the same payment for the waiting order, and can switch to a saved card', async () => {
    const maya = await customer(migrator);
    const order = await cardOrder(maya);
    const again = await orders.resumePaymentAction({ orderId: order.orderId });
    expect(again?.data).toMatchObject({ kind: 'pay', amountCents: 5397 });
    expect((again.data as { clientSecret?: string }).clientSecret).toBe(
      (order as { clientSecret?: string }).clientSecret,
    );

    const stripeCustomer = await fake.createCustomer({
      userId: maya.userId,
      instance: 'x',
      idempotencyKey: `c${maya.userId}`,
    });
    await migrator.user.update({
      where: { id: maya.userId },
      data: { stripeCustomerId: stripeCustomer },
    });
    const saved = fake.addCard(stripeCustomer, MASTERCARD);
    await orders.resumePaymentAction({
      orderId: order.orderId,
      card: { kind: 'saved', paymentMethodId: saved },
    });
    expect(fake.intents.get(order.intentId)).toMatchObject({
      customerId: stripeCustomer,
      paymentMethodId: saved,
    });
  });

  it('says paid when Stripe already has it, and refuses an expired order', async () => {
    const maya = await customer(migrator);
    const order = await cardOrder(maya);
    fake.succeed(order.intentId);
    expect((await orders.resumePaymentAction({ orderId: order.orderId }))?.data).toEqual({
      kind: 'paid',
      orderId: order.orderId,
      number: order.number,
    });
    const other = await cardOrder(maya, {
      lines: [line(dish, 'kimchi')],
      expectedTotalCents: 1012,
    });
    await sync.expireUnpaidOrder(other.orderId, later(16));
    expect((await orders.resumePaymentAction({ orderId: other.orderId }))?.serverError?.code).toBe(
      'ORDER_NOT_PAYABLE',
    );
  });
});

describe('the 15-minute expiry (B8, S9.4)', () => {
  it('does nothing early, then cancels the payment and the order and releases the code', async () => {
    const code = `EXP${TAG}`;
    addedCodes.push(code);
    await migrator.coupon.create({ data: { code, type: 'FIXED', value: 200, usageLimit: 1 } });
    const maya = await customer(migrator);
    const order = await cardOrder(maya, { code, expectedTotalCents: 5183 });
    expect(await sync.expireUnpaidOrder(order.orderId)).toBe('notYet');
    expect(await sync.expireUnpaidOrder(order.orderId, later(16))).toBe('expired');
    expect(fake.intents.get(order.intentId)?.status).toBe('canceled');
    expect(await migrator.order.findUniqueOrThrow({ where: { id: order.orderId } })).toMatchObject({
      status: 'CANCELLED',
      cancelReason: 'payment-expired',
    });
    expect((await migrator.coupon.findUniqueOrThrow({ where: { code } })).usedCount).toBe(0);
    expect(await sync.expireUnpaidOrder(order.orderId, later(16))).toBe('none');
    const view = await orders.orderViewAction({ orderId: order.orderId });
    expect(view?.data).toMatchObject({
      status: 'CANCELLED',
      cancelReason: 'payment-expired',
      cancellable: false,
      payable: false,
    });
  });

  it('places the order instead when Stripe already took the money', async () => {
    const maya = await customer(migrator);
    const order = await cardOrder(maya);
    fake.succeed(order.intentId);
    expect(await sync.expireUnpaidOrder(order.orderId, later(16))).toBe('paid');
    expect((await migrator.order.findUniqueOrThrow({ where: { id: order.orderId } })).status).toBe(
      'PLACED',
    );
  });

  it('is caught by the sweep when its own job was lost', async () => {
    const maya = await customer(migrator);
    const order = await cardOrder(maya);
    await migrator.order.update({ where: { id: order.orderId }, data: { expiresAt: later(-10) } });
    expect(await sync.sweepUnpaidOrders()).toBeGreaterThanOrEqual(1);
    expect((await migrator.order.findUniqueOrThrow({ where: { id: order.orderId } })).status).toBe(
      'CANCELLED',
    );
  });
});

async function withCustomer(who: Customer) {
  const id = await fake.createCustomer({
    userId: who.userId,
    instance: 'x',
    idempotencyKey: `c${who.userId}`,
  });
  await migrator.user.update({ where: { id: who.userId }, data: { stripeCustomerId: id } });
  return id;
}

describe('saved cards (S6.10 to S6.14, B12)', () => {
  it('lists brand, last 4 and expiry only, and removes the caller’s own card', async () => {
    const maya = await customer(migrator);
    expect((await cards.listSavedCardsAction())?.data).toEqual({ cards: [], limit: 5 });
    const stripeCustomer = await withCustomer(maya);
    const visa = fake.addCard(stripeCustomer, VISA);
    const listed = await cards.listSavedCardsAction();
    expect(listed?.data?.cards).toEqual([
      {
        id: visa,
        brand: 'visa',
        brandLabel: 'Visa',
        last4: '4242',
        expMonth: 12,
        expYear: 2034,
        expired: false,
        label: 'Visa •••• 4242',
        spoken: 'Visa ending in 4242',
        expiry: '12/34',
        lastUsedAt: null,
      },
    ]);
    expect((await cards.removeSavedCardAction({ paymentMethodId: visa }))?.data).toEqual({
      removedId: visa,
    });
    expect(fake.cards.get(visa)?.customerId).toBeNull();
    expect((await cards.listSavedCardsAction())?.data?.cards).toEqual([]);
  });

  it("answers not found for someone else's card and removes nothing", async () => {
    const owner = await customer(migrator);
    const card = fake.addCard(await withCustomer(owner));
    const other = await customer(migrator);
    await withCustomer(other);
    expect((await cards.removeSavedCardAction({ paymentMethodId: card }))?.serverError).toEqual({
      code: 'NOT_FOUND',
      message: 'That card is no longer saved.',
    });
    expect(fake.cards.get(card)?.customerId).not.toBeNull();
    expect(fake.count('detachCard')).toBe(0);
  });

  it('keeps the same card once and never a sixth (U4)', async () => {
    const maya = await customer(migrator);
    const stripeCustomer = await withCustomer(maya);
    const first = fake.addCard(stripeCustomer, VISA, new Date(Date.now() - 60_000));
    const again = fake.addCard(stripeCustomer, VISA);
    await keepSavedCard({
      customerId: stripeCustomer,
      paymentMethodId: again,
      fingerprint: VISA.fingerprint,
    });
    expect(fake.cards.get(again)?.customerId).toBeNull();
    expect(fake.cards.get(first)?.customerId).toBe(stripeCustomer);
    for (let index = 0; index < 4; index += 1) {
      fake.addCard(
        stripeCustomer,
        { ...MASTERCARD, fingerprint: `fp_${index}` },
        new Date(Date.now() - 50_000 + index),
      );
    }
    const sixth = fake.addCard(stripeCustomer, { ...MASTERCARD, fingerprint: 'fp_six' });
    await keepSavedCard({
      customerId: stripeCustomer,
      paymentMethodId: sixth,
      fingerprint: 'fp_six',
    });
    expect(fake.cards.get(sixth)?.customerId).toBeNull();
    expect((await cards.listSavedCardsAction())?.data?.cards).toHaveLength(5);
    expect((await account.getAccountAction())?.data?.savedCardCount).toBe(5);
  });

  it('refuses the demo account and a machine without Stripe keys (S1.4, S6.2)', async () => {
    const dana = await customer(migrator);
    await migrator.user.update({ where: { id: dana.userId }, data: { isDemo: true } });
    expect((await cards.listSavedCardsAction())?.serverError?.code).toBe('DEMO_READ_ONLY');
    expect(
      (await cards.removeSavedCardAction({ paymentMethodId: 'pm_abcdef' }))?.serverError?.code,
    ).toBe('DEMO_READ_ONLY');
    await customer(migrator);
    setPaymentGatewayForTests(null);
    expect((await cards.listSavedCardsAction())?.serverError?.code).toBe('STRIPE_NOT_CONFIGURED');
  });

  it('refuses a malformed card id, and allows 20 changes per 10 minutes', async () => {
    await customer(migrator);
    expect(
      (await cards.removeSavedCardAction({ paymentMethodId: 'card_1' }))?.validationErrors,
    ).toBeDefined();
    for (let attempt = 0; attempt < 19; attempt += 1) {
      expect(
        (await cards.removeSavedCardAction({ paymentMethodId: 'pm_nothere' }))?.serverError?.code,
      ).toBe('NOT_FOUND');
    }
    expect(
      (await cards.removeSavedCardAction({ paymentMethodId: 'pm_nothere' }))?.serverError?.code,
    ).toBe('RATE_LIMITED');
  });
});

describe('the checkout page (design "[BE] needs")', () => {
  it('says who may order', async () => {
    expect(await service.getCheckoutPage({ kind: 'anonymous' })).toEqual({ eligibility: 'guest' });
    const maya = await customer(migrator);
    expect((await service.getCheckoutPage(actorOf(maya, { role: 'kitchen' }))).eligibility).toBe(
      'staff',
    );
    expect((await service.getCheckoutPage(actorOf(maya, { role: 'partner' }))).eligibility).toBe(
      'courier',
    );
    const jordan = await customer(migrator, { confirmed: false });
    expect(await service.getCheckoutPage(actorOf(jordan))).toMatchObject({
      eligibility: 'unconfirmed',
      email: jordan.email,
    });
    expect(await service.getCheckoutPage(actorOf(maya, { isDemo: true }))).toMatchObject({
      eligibility: 'demo',
      savedCards: [],
    });
  });

  it('fills in the addresses with fee and distance, the profile, and the unpaid order', async () => {
    const maya = await customer(migrator);
    await migrator.address.create({
      data: {
        userId: maya.userId,
        kind: 'OTHER',
        label: 'Quincy',
        line1: '1 Quincy Center',
        city: 'Quincy, MA 02169',
        lat: 42.2513,
        lng: -71.0042,
      },
    });
    await migrator.user.update({ where: { id: maya.userId }, data: { phone: '+16175550123' } });
    const order = await cardOrder(maya);
    const page = await service.getCheckoutPage(actorOf(maya));
    if (page.eligibility !== 'ok') throw new Error('expected the page');
    expect(page.addresses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'Work',
          distanceKm: 1.3,
          feeCents: 264,
          outsideNow: false,
          isDefault: true,
        }),
        expect.objectContaining({ label: 'Quincy', outsideNow: true, feeCents: null }),
      ]),
    );
    expect(page).toMatchObject({
      profile: { phone: '+16175550123', phoneDisplay: '(617) 555-0123', phoneCountry: 'US' },
      addressLimit: 10,
      savedCardLimit: 5,
      cashLimitCents: 10000,
      paymentTtlMinutes: 15,
      storePhone: '(617) 555-0142',
      stripe: { configured: true, testMode: true, publishableKey: 'pk_test_fake' },
      cardPausedUntil: null,
      lastPaymentMethod: 'card',
      unpaidOrder: {
        id: order.orderId,
        number: order.number,
        totalCents: 5397,
        paymentInProgress: false,
      },
    });
  });
});

describe('the account (F2 hooks, B21, S12.7, S12.8)', () => {
  it('exports orders with every amount and saved cards', async () => {
    const maya = await customer(migrator);
    const order = await paidCardOrder(maya);
    const stripeCustomer = await fake.createCustomer({
      userId: maya.userId,
      instance: 'x',
      idempotencyKey: `c${maya.userId}`,
    });
    await migrator.user.update({
      where: { id: maya.userId },
      data: { stripeCustomerId: stripeCustomer },
    });
    fake.addCard(stripeCustomer, MASTERCARD);
    const exported = await account.exportMyDataAction();
    expect(exported?.data?.data.orders).toEqual([
      expect.objectContaining({
        number: order.number,
        status: 'PLACED',
        totalCents: 5397,
        paymentMethod: 'card',
        card: 'Visa •••• 4242',
        deliveredTo: '1 Faneuil Hall Square, Apt 4, Boston, MA 02109',
        lines: expect.arrayContaining([
          expect.objectContaining({ dish: 'Gimbap', quantity: 2, unitPriceCents: 1299 }),
        ]),
      }),
    ]);
    expect(exported?.data?.data.savedCards).toEqual([
      { brand: 'Mastercard', last4: '4444', expires: '08/31' },
    ]);
  });

  it('waits for a placed order to be cancelled, then deletes: unpaid orders and the Stripe customer go', async () => {
    const maya = await customer(migrator);
    const placed = await cashOrder(maya);
    const unpaid = await cardOrder(maya, {
      lines: [line(dish, 'kimchi')],
      expectedTotalCents: 1012,
    });
    const stripeCustomer = await fake.createCustomer({
      userId: maya.userId,
      instance: 'x',
      idempotencyKey: `c${maya.userId}`,
    });
    await migrator.user.update({
      where: { id: maya.userId },
      data: { stripeCustomerId: stripeCustomer },
    });

    expect((await account.deleteAccountAction({}))?.serverError).toEqual({
      code: 'CONFLICT',
      message: `Order ${placed.number} is waiting for the kitchen. Cancel it from its page, then you can delete your account.`,
      details: { orderId: placed.orderId, number: placed.number },
    });
    // The unpaid one is already cancelled, with its payment (B21).
    expect(await migrator.order.findUniqueOrThrow({ where: { id: unpaid.orderId } })).toMatchObject(
      {
        status: 'CANCELLED',
        cancelReason: 'account-deleted',
      },
    );
    expect(fake.intents.get(unpaid.intentId)?.status).toBe('canceled');

    expect((await orders.cancelOrderAction({ orderId: placed.orderId }))?.data?.status).toBe(
      'CANCELLED',
    );
    expect((await account.deleteAccountAction({}))?.data).toEqual({ deleted: true });
    expect(fake.deletedCustomers).toEqual([stripeCustomer]);
    const kept = await migrator.order.findUniqueOrThrow({ where: { id: placed.orderId } });
    expect(kept).toMatchObject({
      contactName: 'Deleted customer',
      contactPhone: '',
      addressText: 'Address removed',
      addressLine1: null,
      addressLine2: null,
      courierInstructions: null,
      attemptKey: null,
      totalCents: 5397,
      addressLat: 42.36,
    });
    expect(
      (await migrator.user.findUniqueOrThrow({ where: { id: maya.userId } })).stripeCustomerId,
    ).toBeNull();
  });

  it('keeps the account when Stripe can’t remove the cards', async () => {
    const maya = await customer(migrator);
    const stripeCustomer = await fake.createCustomer({
      userId: maya.userId,
      instance: 'x',
      idempotencyKey: `c${maya.userId}`,
    });
    await migrator.user.update({
      where: { id: maya.userId },
      data: { stripeCustomerId: stripeCustomer },
    });
    fake.down.add('deleteCustomer');
    expect((await account.deleteAccountAction({}))?.serverError?.code).toBe('UNAVAILABLE');
    expect(
      (await migrator.user.findUniqueOrThrow({ where: { id: maya.userId } })).deletedAt,
    ).toBeNull();
  });
});

describe('row-level security on orders (F4 migration)', () => {
  it('lets customers read only their own orders, lines, timeline and code uses', async () => {
    const owner = await customer(migrator);
    const placed = await cashOrder(owner);
    const other = await customer(migrator);
    const seen = await runAs(actorOf(other), async (ctx) => ({
      orders: await db(ctx).order.count({ where: { id: placed.orderId } }),
      items: await db(ctx).orderItem.count({ where: { orderId: placed.orderId } }),
      events: await db(ctx).orderEvent.count({ where: { orderId: placed.orderId } }),
      view: await db(ctx).$queryRaw<
        { id: string }[]
      >`SELECT id FROM order_directory WHERE id = ${placed.orderId}::uuid`,
    }));
    expect(seen).toEqual({ orders: 0, items: 0, events: 0, view: [] });
    const mine = await runAs(actorOf(owner), async (ctx) => ({
      orders: await db(ctx).order.count({ where: { id: placed.orderId } }),
      items: await db(ctx).orderItem.count({ where: { orderId: placed.orderId } }),
    }));
    expect(mine).toEqual({ orders: 1, items: 2 });
  });

  it('lets no customer write lines, timeline entries or code uses, even on their own order', async () => {
    const owner = await customer(migrator);
    const placed = await cashOrder(owner);
    const actor = actorOf(owner);
    await expect(
      runAs(actor, (ctx) =>
        db(ctx).orderItem.create({
          data: {
            orderId: placed.orderId,
            menuItemId: dish.kimchi!,
            title: 'Free kimchi',
            unitPriceCents: 0,
            quantity: 9,
          },
        }),
      ),
    ).rejects.toThrow(/row-level security/i);
    await expect(
      runAs(actor, (ctx) =>
        db(ctx).orderEvent.create({ data: { orderId: placed.orderId, type: 'placed' } }),
      ),
    ).rejects.toThrow(/row-level security/i);
    const code = await migrator.coupon.findUniqueOrThrow({ where: { code: 'WELCOME10' } });
    await expect(
      runAs(actor, (ctx) =>
        db(ctx).couponRedemption.create({
          data: {
            couponId: code.id,
            userId: owner.userId,
            orderId: placed.orderId,
            discountCents: 1,
          },
        }),
      ),
    ).rejects.toThrow(/row-level security/i);
    const updated = await runAs(actor, (ctx) =>
      db(ctx).orderItem.updateMany({
        where: { orderId: placed.orderId },
        data: { unitPriceCents: 0 },
      }),
    );
    expect(updated.count).toBe(0);
  });

  it('shows staff orders by role, and real people’s only masked to demo staff (F2 U4)', async () => {
    const owner = await customer(migrator);
    const placed = await cashOrder(owner);
    const kitchen: Actor = { kind: 'user', userId: uuid(), role: 'kitchen', isDemo: false };
    const editor: Actor = { kind: 'user', userId: uuid(), role: 'content_editor', isDemo: false };
    const demoAdmin: Actor = { kind: 'user', userId: uuid(), role: 'admin', isDemo: true };
    expect(
      await runAs(kitchen, (ctx) => db(ctx).order.count({ where: { id: placed.orderId } })),
    ).toBe(1);
    expect(
      await runAs(editor, (ctx) => db(ctx).order.count({ where: { id: placed.orderId } })),
    ).toBe(0);
    const demo = await runAs(demoAdmin, async (ctx) => ({
      base: await db(ctx).order.count({ where: { id: placed.orderId } }),
      items: await db(ctx).orderItem.count({ where: { orderId: placed.orderId } }),
      view: await db(ctx).$queryRaw<
        {
          contact_name: string;
          contact_phone: string;
          address_line1: string;
          courier_instructions: string;
          masked: boolean;
          total_cents: number;
        }[]
      >`SELECT contact_name, contact_phone, address_line1, courier_instructions, masked, total_cents
        FROM order_directory WHERE id = ${placed.orderId}::uuid`,
      updated: (
        await db(ctx).order.updateMany({
          where: { id: placed.orderId },
          data: { status: 'ACCEPTED' },
        })
      ).count,
    }));
    expect(demo).toEqual({
      base: 0,
      items: 0,
      view: [
        {
          contact_name: 'M•••',
          contact_phone: '•••23',
          address_line1: '•••',
          courier_instructions: '•••',
          masked: true,
          total_cents: 5397,
        },
      ],
      updated: 0,
    });
  });

  it('anonymises only the caller’s own orders through the deletion function', async () => {
    const owner = await customer(migrator);
    const placed = await cashOrder(owner);
    const other = await customer(migrator);
    await runAs(actorOf(other), (ctx) => db(ctx).$queryRaw`SELECT app_anonymize_own_orders()`);
    expect(
      (await migrator.order.findUniqueOrThrow({ where: { id: placed.orderId } })).contactName,
    ).toBe('Maya Lopez');
    const count = await runAsSystem('check', (ctx) =>
      db(ctx).order.count({ where: { userId: owner.userId } }),
    );
    expect(count).toBe(1);
  });
});
