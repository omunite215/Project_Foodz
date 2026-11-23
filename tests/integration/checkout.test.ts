import { PrismaPg } from '@prisma/adapter-pg';
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
import { nextHeaders, newBrowser, switchBrowser } from './support/browser';
import {
  attemptKey,
  cartA,
  closeAllWeek,
  customer,
  dishIds,
  line,
  openAllDay,
  press,
  restoreHours,
} from './support/checkout';

/*
 * Placing orders through the Server Action, as a browser would (F4 S1, S4, S5, S6, S7, S8, S9):
 * the worked totals, every refusal and its details, one press one order, code reservation under
 * concurrency, the F3 security review's conditions (S8) and the abuse limits. Stripe is a fake.
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

const { placeOrderAction, orderStatusAction } = await import('@/server/modules/orders/actions');
const { quoteCartAction } = await import('@/server/modules/cart/actions');
const { getCheckoutPage, placeOrder } = await import('@/server/modules/orders/service');

let migrator: PrismaClient;
let dish: Record<string, string> = {};
let fake: FakeStripe;
const addedCodes: string[] = [];
const TAG = crypto.randomUUID().slice(0, 6).toUpperCase();

const ordersOf = (userId: string) =>
  migrator.order.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });

const sentEvents = (name: string) =>
  mocks.send.mock.calls
    .map(([event]) => event as { name: string; data: Record<string, unknown>; id?: string })
    .filter((event) => event.name === name);

async function addCoupon(code: string, data: Record<string, unknown>) {
  addedCodes.push(code);
  return migrator.coupon.create({
    data: { code, type: 'FIXED', value: 200, ...data },
    select: { id: true },
  });
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

describe('the quote at checkout (B14, B15, S3, S4.1, S5.2)', () => {
  it('T3: adds the tip options, the arrival window and the cash flag; the cart is unchanged', async () => {
    const priya = await customer(migrator);
    const before = Date.now();
    const result = await quoteCartAction({
      lines: cartA(dish),
      delivery: { kind: 'saved', addressId: priya.addressId },
      tip: { kind: 'percent', percent: 15 },
      method: 'cash',
    });
    expect(result?.data).toMatchObject({
      tipCents: 720,
      totalCents: 6117,
      tipOptions: [
        { percent: 10, cents: 480 },
        { percent: 15, cents: 720 },
        { percent: 20, cents: 959 },
      ],
      cashAllowed: true,
      cashLimitCents: 10000,
      store: { isOpen: true, closingSoon: false },
    });
    const arrival = result.data!.arrival;
    if (arrival.status !== 'ok') throw new Error('expected an arrival window');
    expect(arrival.toMinutes - arrival.fromMinutes).toBe(10);
    expect(arrival.fromMinutes % 5).toBe(0);
    expect(Date.parse(arrival.by) - before).toBeGreaterThanOrEqual(
      arrival.toMinutes * 60_000 - 1000,
    );
    // The cart sends no tip and sees the F3 figures.
    expect((await quoteCartAction({ lines: cartA(dish) }))?.data?.tipCents).toBe(0);
  });

  it('T10: over $100.00 cash is not allowed; with no address the arrival waits for one', async () => {
    const result = await quoteCartAction({
      lines: [line(dish, 'samgyeopsal', 10)],
      delivery: { kind: 'none' },
    });
    expect(result?.data).toMatchObject({ cashAllowed: false, arrival: { status: 'noAddress' } });
  });

  it('says the store is closed instead of an arrival time (S3.4)', async () => {
    await closeAllWeek(migrator);
    try {
      const maya = await customer(migrator);
      const result = await quoteCartAction({
        lines: cartA(dish),
        delivery: { kind: 'saved', addressId: maya.addressId },
      });
      expect(result?.data?.arrival).toEqual({ status: 'closed' });
    } finally {
      await openAllDay(migrator);
    }
  });
});

describe('cash on delivery (S5)', () => {
  it('T1: places cart A at once for $53.97, with the address, contact and arrival kept (S2.10, S3.2)', async () => {
    const maya = await customer(migrator);
    const result = await placeOrderAction(
      press(maya, dish, { kitchenNote: 'More spicy\u0000 please' }),
    );
    expect(result?.serverError).toBeUndefined();
    expect(result?.data).toMatchObject({
      kind: 'placed',
      method: 'cash',
      totalCents: 5397,
      replayed: false,
    });
    expect(result?.data?.number).toMatch(/^\d{4,}$/);

    const [order] = await ordersOf(maya.userId);
    expect(order).toMatchObject({
      status: 'PLACED',
      paymentMethod: 'CASH',
      paymentStatus: 'UNPAID',
      subtotalCents: 4797,
      deliveryFeeCents: 264,
      deliveryDiscountCents: 0,
      taxCents: 336,
      taxRateBps: 700,
      tipCents: 0,
      tipChoice: 'none',
      totalCents: 5397,
      contactName: 'Maya Lopez',
      contactPhone: '+16175550123',
      addressLabel: 'Work',
      addressLine1: '1 Faneuil Hall Square',
      addressLine2: 'Apt 4',
      addressCity: 'Boston, MA 02109',
      courierInstructions: 'Buzzer 3, leave at the door',
      distanceKm: 1.3,
      note: 'More spicy  please',
      arrivalToMinutes: (order?.arrivalFromMinutes ?? 0) + 10,
    });
    expect(order?.placedAt).toBeInstanceOf(Date);
    expect(order?.arrivalFromMinutes).toBeGreaterThanOrEqual(25);
    const items = await migrator.orderItem.findMany({ where: { orderId: order!.id } });
    expect(items.map((item) => [item.title, item.quantity, item.unitPriceCents])).toEqual(
      expect.arrayContaining([
        ['Gimbap', 2, 1299],
        ['Pad Thai', 1, 2199],
      ]),
    );
    const events = await migrator.orderEvent.findMany({ where: { orderId: order!.id } });
    expect(events.map((event) => event.type).toSorted()).toEqual(['created', 'placed']);
    // One receipt, keyed on the order and the change.
    expect(sentEvents('order.email-requested')).toEqual([
      expect.objectContaining({
        data: { orderId: order!.id, kind: 'receipt' },
        id: `order-email-${order!.id}-placed`,
      }),
    ]);
  });

  it('T5 and T9: a typed tip and a percentage, worked out on the server (S4.2)', async () => {
    const maya = await customer(migrator);
    const typed = await placeOrderAction(
      press(maya, dish, { tip: { kind: 'amount', cents: 500 }, expectedTotalCents: 5897 }),
    );
    expect(typed?.data?.totalCents).toBe(5897);
    const priya = await customer(migrator);
    const tenKimchi = await placeOrderAction(
      press(priya, dish, {
        lines: [line(dish, 'kimchi', 10)],
        tip: { kind: 'percent', percent: 15 },
        expectedTotalCents: 8792,
      }),
    );
    expect(tenKimchi?.data?.totalCents).toBe(8792);
    const [order] = await ordersOf(priya.userId);
    expect(order).toMatchObject({ tipCents: 1049, tipChoice: '15' });
  });

  it('caps a 20 % tip on a big office order at $100.00, quote and order alike (security S4)', async () => {
    const office = await customer(migrator);
    const lines = [line(dish, 'samgyeopsal', 20), line(dish, 'gimbap', 10)];
    const quoted = await quoteCartAction({
      lines,
      delivery: { kind: 'saved', addressId: office.addressId },
      tip: { kind: 'percent', percent: 20 },
      method: 'card',
    });
    expect(quoted?.data?.subtotalCents).toBeGreaterThan(50_000);
    expect(quoted?.data?.tipCents).toBe(10_000);
    expect(quoted?.data?.tipOptions.at(-1)).toEqual({ percent: 20, cents: 10_000 });

    const result = await placeOrderAction(
      press(office, dish, {
        lines,
        method: 'card',
        card: { kind: 'new' },
        tip: { kind: 'percent', percent: 20 },
        expectedTotalCents: quoted.data!.totalCents,
      }),
    );
    expect(result?.serverError).toBeUndefined();
    expect(result?.data).toMatchObject({ kind: 'pay', totalCents: quoted.data!.totalCents });
    const [order] = await ordersOf(office.userId);
    expect(order).toMatchObject({ tipCents: 10_000, tipChoice: '20' });
  });

  it('refuses cash over $100.00 with the total in the sentence (T10, S5.2)', async () => {
    const maya = await customer(migrator);
    const result = await placeOrderAction(
      press(maya, dish, { lines: [line(dish, 'samgyeopsal', 10)], expectedTotalCents: 27003 }),
    );
    expect(result?.serverError).toEqual({
      code: 'CASH_LIMIT',
      message:
        'Cash is available for orders up to $100.00. This one is $270.03, so please pay by card.',
      details: { totalCents: 27003, limitCents: 10000 },
    });
    expect(await ordersOf(maya.userId)).toHaveLength(0);
  });

  it('saves the number to the profile when asked (S2.7)', async () => {
    const maya = await customer(migrator);
    await placeOrderAction(press(maya, dish, { phone: '617 555 0199', savePhone: true }));
    const user = await migrator.user.findUniqueOrThrow({ where: { id: maya.userId } });
    expect(user.phone).toBe('+16175550199');
  });
});

describe('card payments (S6, B5)', () => {
  it('T6: makes the order wait for a PaymentIntent of exactly $55.82, tagged with this database', async () => {
    await addCoupon(`KB${TAG}`, {
      type: 'FIXED',
      value: 500,
      minSubtotalCents: 2500,
      cuisines: ['KOREAN'],
    });
    const maya = await customer(migrator);
    const before = Date.now();
    const result = await placeOrderAction(
      press(maya, dish, {
        method: 'card',
        card: { kind: 'new' },
        code: `kb${TAG}`,
        tip: { kind: 'percent', percent: 15 },
        expectedTotalCents: 5582,
      }),
    );
    expect(result?.serverError).toBeUndefined();
    expect(result?.data).toMatchObject({ kind: 'pay', totalCents: 5582, replayed: false });
    const data = result.data!;
    if (data.kind !== 'pay') throw new Error('expected a payment');

    const [order] = await ordersOf(maya.userId);
    expect(order).toMatchObject({
      status: 'PENDING_PAYMENT',
      paymentMethod: 'CARD',
      discountCents: 500,
      taxCents: 301,
      tipCents: 720,
      totalCents: 5582,
      promoCode: `KB${TAG}`,
    });
    expect(order!.expiresAt!.getTime()).toBeGreaterThanOrEqual(before + 15 * 60_000 - 1000);
    const intent = fake.intentFor(order!.id)!;
    const { tag } = await migrator.appInstance.findUniqueOrThrow({ where: { id: 1 } });
    expect(intent).toMatchObject({
      amountCents: 5582,
      currency: 'usd',
      metadata: { orderId: order!.id, orderNumber: order!.number, instance: tag },
      saveCard: false,
      customerId: null,
    });
    expect(data.clientSecret).toBe(intent.clientSecret);
    expect(order!.stripePaymentIntentId).toBe(intent.id);
    // The code is held, not used, while the payment waits (S9.1).
    const redemption = await migrator.couponRedemption.findUniqueOrThrow({
      where: { orderId: order!.id },
    });
    expect(redemption).toMatchObject({ status: 'RESERVED', discountCents: 500 });
    expect(
      (await migrator.coupon.findUniqueOrThrow({ where: { code: `KB${TAG}` } })).usedCount,
    ).toBe(1);
    // The expiry job is scheduled for this order (B8).
    expect(sentEvents('order.payment-started')).toEqual([
      expect.objectContaining({
        data: { orderId: order!.id, expiresAt: order!.expiresAt!.toISOString() },
      }),
    ]);
    expect(sentEvents('order.email-requested')).toHaveLength(0);
  });

  it('saves a card only when asked, under a Stripe customer made once (U4, B12)', async () => {
    const maya = await customer(migrator);
    const result = await placeOrderAction(
      press(maya, dish, { method: 'card', card: { kind: 'new', save: true } }),
    );
    const [order] = await ordersOf(maya.userId);
    const intent = fake.intentFor(order!.id)!;
    expect(intent.saveCard).toBe(true);
    const user = await migrator.user.findUniqueOrThrow({ where: { id: maya.userId } });
    expect(user.stripeCustomerId).toBe(intent.customerId);
    expect(fake.count('createCustomer')).toBe(1);

    fake.succeed(intent.id, VISA);
    const status = await orderStatusAction({ orderId: result.data!.orderId, confirmed: true });
    expect(status?.data).toMatchObject({
      status: 'PLACED',
      payment: { status: 'PAID', card: { label: 'Visa •••• 4242' } },
    });
    const page = await getCheckoutPage({
      kind: 'user',
      userId: maya.userId,
      role: 'customer',
      isDemo: false,
    });
    if (page.eligibility !== 'ok') throw new Error('expected the checkout page');
    expect(page.savedCards.map((card) => card.label)).toEqual(['Visa •••• 4242']);
    expect(page.savedCards[0]!.lastUsedAt).not.toBeNull();
    expect(page.lastPaymentMethod).toBe('card');
  });

  it("pays with a saved card only when it is the caller's own (S6.14)", async () => {
    const owner = await customer(migrator);
    const ownerCustomer = await fake.createCustomer({
      userId: owner.userId,
      instance: 'x',
      idempotencyKey: `c-${owner.userId}`,
    });
    await migrator.user.update({
      where: { id: owner.userId },
      data: { stripeCustomerId: ownerCustomer },
    });
    const card = fake.addCard(ownerCustomer);

    const thief = await customer(migrator);
    const stolen = await placeOrderAction(
      press(thief, dish, { method: 'card', card: { kind: 'saved', paymentMethodId: card } }),
    );
    expect(stolen?.serverError).toMatchObject({ code: 'NOT_FOUND' });
    expect(await ordersOf(thief.userId)).toHaveLength(0);
    expect(fake.count('createIntent')).toBe(0);

    switchBrowser(owner.browser);
    const mine = await placeOrderAction(
      press(owner, dish, { method: 'card', card: { kind: 'saved', paymentMethodId: card } }),
    );
    expect(mine?.data?.kind).toBe('pay');
    const [order] = await ordersOf(owner.userId);
    expect(fake.intentFor(order!.id)).toMatchObject({
      customerId: ownerCustomer,
      paymentMethodId: card,
    });
  });

  it('refuses card payments when Stripe is not set up, and cash still works (S6.2)', async () => {
    setPaymentGatewayForTests(null);
    const maya = await customer(migrator);
    const card = await placeOrderAction(
      press(maya, dish, { method: 'card', card: { kind: 'new' } }),
    );
    expect(card?.serverError).toEqual({
      code: 'STRIPE_NOT_CONFIGURED',
      message: "Card payments aren't set up on this computer.",
    });
    expect((await placeOrderAction(press(maya, dish)))?.data?.kind).toBe('placed');
  });

  it('gives the code back and charges nothing when Stripe is down at the press', async () => {
    const code = `DOWN${TAG}`;
    await addCoupon(code, { usageLimit: 5 });
    fake.down.add('createIntent');
    const maya = await customer(migrator);
    const result = await placeOrderAction(
      press(maya, dish, { method: 'card', card: { kind: 'new' }, code, expectedTotalCents: 5183 }),
    );
    expect(result?.serverError).toMatchObject({ code: 'UNAVAILABLE' });
    const [order] = await ordersOf(maya.userId);
    expect(order?.status).toBe('FAILED');
    expect(
      (await migrator.couponRedemption.findUniqueOrThrow({ where: { orderId: order!.id } })).status,
    ).toBe('RELEASED');
    expect((await migrator.coupon.findUniqueOrThrow({ where: { code } })).usedCount).toBe(0);
  });

  it('pauses card payment after 5 declines in an hour; cash keeps working (S6.9, B11)', async () => {
    const maya = await customer(migrator);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const result = await placeOrderAction(
        press(maya, dish, { method: 'card', card: { kind: 'new' }, allowDuplicate: true }),
      );
      expect(result?.data?.kind).toBe('pay');
      const orderId = result.data!.orderId;
      const intent = fake.intentFor(orderId)!;
      fake.decline(intent.id, 'card_declined', 'insufficient_funds');
      const status = await orderStatusAction({ orderId, confirmed: true });
      expect(status?.data).toMatchObject({
        status: 'FAILED',
        payment: { decline: { code: 'card_declined', declineCode: 'insufficient_funds' } },
      });
    }
    const paused = await placeOrderAction(
      press(maya, dish, { method: 'card', card: { kind: 'new' }, allowDuplicate: true }),
    );
    expect(paused?.serverError?.code).toBe('CARD_PAUSED');
    expect(paused?.serverError?.message).toMatch(
      /^Too many declined payments\. You can try a card again at \d{1,2}(:\d\d)? (am|pm), or pay with cash\.$/,
    );
    const until = Date.parse(String(paused?.serverError?.details?.until));
    expect(until - Date.now()).toBeGreaterThan(55 * 60_000);
    expect((await placeOrderAction(press(maya, dish, { allowDuplicate: true })))?.data?.kind).toBe(
      'placed',
    );
    // Failed attempts gave their payments up at Stripe (U2).
    expect(fake.count('cancelIntent')).toBe(5);
  });
});

describe('one press, one order (S7)', () => {
  it('returns the same order and payment for the same attempt key (S7.2)', async () => {
    const maya = await customer(migrator);
    const input = press(maya, dish, { method: 'card', card: { kind: 'new' } });
    const first = await placeOrderAction(input);
    const again = await placeOrderAction(input);
    expect(again?.data).toMatchObject({
      orderId: first?.data?.orderId,
      kind: 'pay',
      replayed: true,
    });
    expect((again.data as { clientSecret?: string }).clientSecret).toBe(
      (first.data as { clientSecret?: string }).clientSecret,
    );
    expect(await ordersOf(maya.userId)).toHaveLength(1);
    expect(fake.count('createIntent')).toBe(1);
  });

  it('makes exactly one order and one payment from a triple tap (S7.1)', async () => {
    const maya = await customer(migrator);
    const input = press(maya, dish, { method: 'card', card: { kind: 'new' } });
    const results = await Promise.all([
      placeOrderAction(input),
      placeOrderAction(input),
      placeOrderAction(input),
    ]);
    expect(results.every((result) => result?.data?.kind === 'pay')).toBe(true);
    expect(new Set(results.map((result) => result?.data?.orderId)).size).toBe(1);
    expect(await ordersOf(maya.userId)).toHaveLength(1);
    expect(fake.intents.size).toBe(1);
  });

  it('starts a new attempt with the key of a failed order (S7.2)', async () => {
    const maya = await customer(migrator);
    const input = press(maya, dish, { method: 'card', card: { kind: 'new' } });
    const first = await placeOrderAction(input);
    fake.decline(fake.intentFor(first.data!.orderId)!.id);
    await orderStatusAction({ orderId: first.data!.orderId, confirmed: true });
    const second = await placeOrderAction({ ...input, allowDuplicate: true });
    expect(second?.data?.orderId).not.toBe(first?.data?.orderId);
    expect(second?.data?.replayed).toBe(false);
    const orders = await ordersOf(maya.userId);
    expect(orders.map((order) => [order.status, order.attemptKey])).toEqual([
      ['FAILED', null],
      ['PENDING_PAYMENT', input.attemptKey],
    ]);
  });

  it('refuses a second order while one is unpaid (U11, S7.6)', async () => {
    const maya = await customer(migrator);
    const unpaid = await placeOrderAction(
      press(maya, dish, { method: 'card', card: { kind: 'new' } }),
    );
    const second = await placeOrderAction(
      press(maya, dish, { lines: [line(dish, 'kimchi')], expectedTotalCents: 1012 }),
    );
    expect(second?.serverError).toMatchObject({
      code: 'UNPAID_ORDER',
      details: { orderId: unpaid?.data?.orderId, number: unpaid?.data?.number, totalCents: 5397 },
    });
    expect(second?.serverError?.message).toMatch(
      new RegExp(
        `^Order ${unpaid?.data?.number} is waiting for payment \\(\\$53\\.97\\)\\. It expires at .+\\.$`,
      ),
    );
  });

  it('asks before placing the same dishes to the same address within 2 minutes (S7.5)', async () => {
    const maya = await customer(migrator);
    const first = await placeOrderAction(press(maya, dish));
    const second = await placeOrderAction(press(maya, dish));
    expect(second?.serverError).toEqual({
      code: 'LIKELY_DUPLICATE',
      message: `You placed this same order a moment ago (order ${first?.data?.number}). Place it again?`,
      details: { orderId: first?.data?.orderId, number: first?.data?.number },
    });
    const again = await placeOrderAction(press(maya, dish, { allowDuplicate: true }));
    expect(again?.data?.kind).toBe('placed');
    expect(await ordersOf(maya.userId)).toHaveLength(2);
  });
});

describe('the price I confirm is the price I pay (S8, F3 security S8)', () => {
  it('refuses any change up or down, says why, and creates nothing (S8.2, U12)', async () => {
    const maya = await customer(migrator);
    const shown = { lines: [] as { key: string; unitPriceCents: number }[], deliveryFeeCents: 264 };
    const lines = cartA(dish);
    shown.lines = [
      { key: lines[0]!.key, unitPriceCents: 1199 },
      { key: lines[1]!.key, unitPriceCents: 2199 },
    ];
    const result = await placeOrderAction(
      press(maya, dish, { lines, expectedTotalCents: 5183, shown }),
    );
    expect(result?.serverError).toMatchObject({
      code: 'PRICE_CHANGED',
      message:
        'Your total changed from $51.83 to $53.97 because Gimbap is now $12.99 (was $11.99). Check the summary, then press Place order · $53.97 to continue.',
      details: {
        oldTotalCents: 5183,
        newTotalCents: 5397,
        changes: [
          { kind: 'price', key: lines[0]!.key, dish: 'Gimbap', wasCents: 1199, nowCents: 1299 },
        ],
        quote: { totalCents: 5397 },
      },
    });
    const lower = await placeOrderAction(press(maya, dish, { expectedTotalCents: 5398 }));
    expect(lower?.serverError?.code).toBe('PRICE_CHANGED');
    expect(await ordersOf(maya.userId)).toHaveLength(0);
  });

  it('prices delivery from the saved address only: a map point near the kitchen is refused (condition 1)', async () => {
    const far = await customer(migrator, { place: 'quincy' });
    const quoted = await quoteCartAction({
      lines: cartA(dish),
      delivery: { kind: 'point', lat: 42.3506, lng: -71.0451 },
    });
    // The guest preview still works for a point; checkout never takes one.
    expect(quoted?.data?.delivery).toMatchObject({ status: 'inside', feeCents: 199 });
    const sneaky = await placeOrderAction({
      ...press(far, dish, { expectedTotalCents: 5332 }),
      delivery: { kind: 'point', lat: 42.3506, lng: -71.0451 },
    } as never);
    expect(sneaky?.validationErrors).toBeDefined();
    const honest = await placeOrderAction(press(far, dish, { expectedTotalCents: 5332 }));
    expect(honest?.serverError).toMatchObject({ code: 'OUTSIDE_AREA', details: { radiusKm: 8 } });
    expect(honest?.serverError?.message).toMatch(
      /^We don't deliver to Quincy yet\. It's about 1\d\.\d km away, and we deliver within 8 km\.$/,
    );
    expect(await ordersOf(far.userId)).toHaveLength(0);
  });

  it("refuses another customer's address id, as if it weren't there", async () => {
    const owner = await customer(migrator);
    const other = await customer(migrator);
    const result = await placeOrderAction(press(other, dish, { addressId: owner.addressId }));
    expect(result?.serverError).toMatchObject({
      code: 'INVALID_INPUT',
      fieldErrors: { addressId: ['Choose an address we deliver to.'] },
    });
    expect(await ordersOf(other.userId)).toHaveLength(0);
  });

  it('refuses a sold-out dish by name (S8.3)', async () => {
    const maya = await customer(migrator);
    const result = await placeOrderAction(
      press(maya, dish, { lines: [...cartA(dish), line(dish, 'naengmyeon')] }),
    );
    expect(result?.serverError?.code).toBe('SOLD_OUT');
    expect(result?.serverError?.message).toBe(
      'Naengmyeon sold out while you were checking out. Remove it to continue, or go back to your cart.',
    );
    expect(result?.serverError?.details).toMatchObject({
      soldOut: [{ dish: 'Naengmyeon' }],
      removed: [],
    });
  });

  it('notices a price changed between the quote and the write, and refuses with the new total', async () => {
    const maya = await customer(migrator);
    const gimbap = await migrator.menuItem.findUniqueOrThrow({ where: { slug: 'gimbap' } });
    await migrator.menuItem.update({ where: { slug: 'gimbap' }, data: { priceCents: 1399 } });
    try {
      const result = await placeOrderAction(press(maya, dish));
      expect(result?.serverError).toMatchObject({
        code: 'PRICE_CHANGED',
        details: { oldTotalCents: 5397, newTotalCents: 5611 },
      });
    } finally {
      await migrator.menuItem.update({
        where: { slug: 'gimbap' },
        data: { priceCents: gimbap.priceCents },
      });
    }
  });

  it('refuses when the store closed while she was checking out (S3.5)', async () => {
    const maya = await customer(migrator);
    await closeAllWeek(migrator);
    try {
      const result = await placeOrderAction(press(maya, dish));
      expect(result?.serverError).toMatchObject({
        code: 'STORE_CLOSED',
        message: "We're closed right now. Your cart is saved.",
        details: { closedAt: null, opensAt: null },
      });
    } finally {
      await openAllDay(migrator);
    }
    expect(await ordersOf(maya.userId)).toHaveLength(0);
  });

  it('gives a code with one use left to exactly one of two customers pressing at once (S8.4, condition 2)', async () => {
    const code = `LAST${TAG}`;
    await addCoupon(code, { usageLimit: 1 });
    const first = await customer(migrator);
    const second = await customer(migrator);
    // Straight to the service, each as themselves: the test browser is one at a time.
    const results = await Promise.all(
      [first, second].map((who) =>
        placeOrder(
          { kind: 'user', userId: who.userId, role: 'customer', isDemo: false },
          press(who, dish, { code, expectedTotalCents: 5183 }),
          { ip: who.browser.ip },
        ).then(
          (data) => ({ data, serverError: undefined }),
          (error: { toJSON?: () => Record<string, unknown> }) => ({
            data: undefined,
            serverError: error.toJSON?.(),
          }),
        ),
      ),
    );
    const placed = results.filter((result) => result?.data?.kind === 'placed');
    const refused = results.filter((result) => result?.serverError);
    expect(placed).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0]?.serverError).toMatchObject({
      code: 'PROMO_REFUSED',
      message: `Sorry, ${code} has run out.`,
      details: { code, reason: { code: 'usedUp', rule: 'R4' } },
    });
    expect((await migrator.coupon.findUniqueOrThrow({ where: { code } })).usedCount).toBe(1);
    expect(await migrator.couponRedemption.count({ where: { coupon: { code } } })).toBe(1);
  });

  it('holds a one-per-customer code once, even for two presses at once (condition 2)', async () => {
    const code = `ONCE${TAG}`;
    await addCoupon(code, { perUserLimit: 1 });
    const maya = await customer(migrator);
    const results = await Promise.all([
      placeOrderAction(press(maya, dish, { code, expectedTotalCents: 5183 })),
      placeOrderAction(
        press(maya, dish, {
          code,
          lines: [line(dish, 'samgyeopsal', 2)],
          expectedTotalCents: 5398,
        }),
      ),
    ]);
    expect(results.filter((result) => result?.data?.kind === 'placed')).toHaveLength(1);
    const refusal = results.find((result) => result?.serverError)?.serverError;
    expect(refusal?.code).toBe('PROMO_REFUSED');
    expect(await migrator.couponRedemption.count({ where: { coupon: { code } } })).toBe(1);
  });

  it('refuses a code that ran out, without dropping it silently (S8.4)', async () => {
    const code = `GONE${TAG}`;
    await addCoupon(code, { usageLimit: 1, usedCount: 1 });
    const maya = await customer(migrator);
    const result = await placeOrderAction(press(maya, dish, { code, expectedTotalCents: 5183 }));
    expect(result?.serverError).toMatchObject({
      code: 'PROMO_REFUSED',
      message: `Sorry, ${code} has run out.`,
      details: { code, reason: { code: 'usedUp' } },
    });
  });
});

const tryOrder = async (who: Parameters<typeof press>[0]) => placeOrderAction(press(who, dish));

describe('who can order (S1, B13)', () => {
  it('asks guests to sign in', async () => {
    const maya = await customer(migrator);
    switchBrowser(newBrowser());
    expect((await tryOrder(maya))?.serverError?.code).toBe('UNAUTHENTICATED');
    expect(await ordersOf(maya.userId)).toHaveLength(0);
  });

  it('refuses an unconfirmed email with the gate sentence (S1.3)', async () => {
    const jordan = await customer(migrator, { confirmed: false });
    expect((await tryOrder(jordan))?.serverError).toEqual({
      code: 'EMAIL_NOT_CONFIRMED',
      message: `Confirm your email to place your order. We sent a link to ${jordan.email}.`,
      details: { email: jordan.email },
    });
    expect(await ordersOf(jordan.userId)).toHaveLength(0);
  });

  it('refuses the demo account, staff and couriers (S1.4, S1.5)', async () => {
    const dana = await customer(migrator);
    await migrator.user.update({ where: { id: dana.userId }, data: { isDemo: true } });
    expect((await tryOrder(dana))?.serverError).toEqual({
      code: 'DEMO_READ_ONLY',
      message: "Demo accounts can't place orders.",
    });
    for (const role of ['kitchen', 'admin', 'partner']) {
      const staff = await customer(migrator);
      await migrator.user.update({ where: { id: staff.userId }, data: { role } });
      expect((await tryOrder(staff))?.serverError).toEqual({
        code: 'NOT_A_CUSTOMER',
        message: 'Checkout is for customer accounts. Sign in with a customer account to order.',
      });
      expect(await ordersOf(staff.userId)).toHaveLength(0);
    }
    expect(await ordersOf(dana.userId)).toHaveLength(0);
    expect(fake.count('createCustomer')).toBe(0);
  });

  it('treats a customer suspended on the page as signed out (S1.8)', async () => {
    const sam = await customer(migrator);
    await migrator.user.update({ where: { id: sam.userId }, data: { banned: true } });
    expect((await tryOrder(sam))?.serverError?.code).toBe('UNAUTHENTICATED');
    expect(await ordersOf(sam.userId)).toHaveLength(0);
  });
});

describe('what the action accepts (S4.7, S8.7)', () => {
  it.each([
    ['a 12 % tip', { tip: { kind: 'percent', percent: 12 } }],
    ['a negative tip', { tip: { kind: 'amount', cents: -100 } }],
    ['a tip over $100.00 (condition 4)', { tip: { kind: 'amount', cents: 10_001 } }],
    ['fractions of a cent', { tip: { kind: 'amount', cents: 500.5 } }],
    ['a made-up total field', { totalCents: 1 }],
    [
      'a price on a line',
      {
        lines: [
          {
            key: 'a',
            menuItemId: '01933b2e-7c4a-7d10-9b1a-2c3d4e5f6a7b',
            quantity: 1,
            priceCents: 1,
          },
        ],
      },
    ],
    [
      '21 of one dish',
      { lines: [{ key: 'a', menuItemId: '01933b2e-7c4a-7d10-9b1a-2c3d4e5f6a7b', quantity: 21 }] },
    ],
    ['a card on a cash order', { card: { kind: 'new' } }],
    ['a card order without a card', { method: 'card' }],
    ['a bad attempt key', { attemptKey: 'short' }],
    ['no phone', { phone: '' }],
  ])('refuses %s and creates nothing', async (_label, extra) => {
    const maya = await customer(migrator);
    const result = await placeOrderAction({ ...press(maya, dish), ...extra } as never);
    expect(result?.validationErrors ?? result?.serverError).toBeDefined();
    expect(result?.data).toBeUndefined();
    expect(await ordersOf(maya.userId)).toHaveLength(0);
  });

  it('caps the tip in the pricing itself, not only in validation (condition 4)', async () => {
    const { tipFor } = await import('@/server/modules/cart/pricing');
    expect(() => tipFor({ kind: 'amount', cents: 10_001 }, 4797)).toThrow(RangeError);
  });

  it('refuses a 51-item cart as too big', async () => {
    const maya = await customer(migrator);
    const lines = ['gimbap', 'kimchi', 'pad-thai'].map((slug) => line(dish, slug, 17));
    const result = await placeOrderAction(press(maya, dish, { lines }));
    expect(result?.serverError?.code).toBe('CART_TOO_BIG');
  });
});

describe('abuse limits (B11)', () => {
  it('allows 10 presses an hour per account, then gives the real wait', async () => {
    const maya = await customer(migrator);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const result = await placeOrderAction(press(maya, dish, { expectedTotalCents: 1 }));
      expect(result?.serverError?.code).toBe('PRICE_CHANGED');
    }
    const eleventh = await placeOrderAction(press(maya, dish));
    expect(eleventh?.serverError?.code).toBe('RATE_LIMITED');
    expect(eleventh?.serverError?.message).toMatch(
      /^You've tried to order several times in a short while\. You can try again in (\d+ minutes?|1 hour)\.$/,
    );
    expect(await ordersOf(maya.userId)).toHaveLength(0);
  });

  it('limits a network to 30 presses an hour, across accounts', async () => {
    const shared = newBrowser();
    const people = [];
    for (let index = 0; index < 4; index += 1) {
      const who = await customer(migrator);
      who.browser.ip = shared.ip;
      people.push(who);
    }
    let refused = 0;
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const who = people[attempt % people.length]!;
      switchBrowser(who.browser);
      const result = await placeOrderAction(
        press(who, dish, { expectedTotalCents: 1, attemptKey: attemptKey() }),
      );
      if (result?.serverError?.code === 'RATE_LIMITED') refused += 1;
    }
    expect(refused).toBeGreaterThanOrEqual(2);
  });
});
