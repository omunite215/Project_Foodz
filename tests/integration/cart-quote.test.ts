import { PrismaPg } from '@prisma/adapter-pg';
import { RateLimiterRedis } from 'rate-limiter-flexible';
import { v7 as uuid } from 'uuid';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { PrismaClient } from '@/server/db/generated/client';
import { redis } from '@/server/redis';
import { seedCatalog } from '../../prisma/seeding';
import { type Browser, nextHeaders, newBrowser, switchBrowser } from './support/browser';

/*
 * The cart's price breakdown through its Server Action, as a browser would call it: the worked
 * quotes on the seeded menu and settings, tampered carts, delivery targets, every promo refusal
 * (R1 to R9) and the code-guessing limits (B5).
 */

const mocks = vi.hoisted(() => ({
  send: vi.fn<(event: unknown) => Promise<unknown>>(async () => ({ ids: ['evt'] })),
}));
vi.mock('next/headers', () => nextHeaders);
vi.mock('next/headers.js', () => nextHeaders);
vi.mock('@/server/jobs/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/jobs/client')>()),
  inngest: { send: mocks.send },
}));
vi.mock('@/server/security/breached-passwords', () => ({
  checkPasswordBreach: async () => 'clean',
}));
vi.mock('@/server/security/turnstile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/security/turnstile')>()),
  checkTurnstile: async () => 'passed',
}));

const authActions = await import('@/server/modules/auth/actions');
const addresses = await import('@/server/modules/addresses/actions');
const { quoteCartAction } = await import('@/server/modules/cart/actions');
const { quoteCart } = await import('@/server/modules/cart/service');

const PASSWORD = 'correct horse battery';
const TAG = crypto.randomUUID().slice(0, 6).toUpperCase();

const PLACES = {
  peterborough: {
    kind: 'HOME' as const,
    line1: '12 Peterborough Street',
    city: 'Boston, MA 02215',
    lat: 42.3467,
    lng: -71.0972,
  },
  faneuil: {
    kind: 'WORK' as const,
    line1: '1 Faneuil Hall Square',
    city: 'Boston, MA 02109',
    lat: 42.36,
    lng: -71.0548,
  },
  edgeInside: { lat: 42.4216, lng: -71.045 },
  edgeOutside: { lat: 42.4234, lng: -71.045 },
};

let migrator: PrismaClient;
const dish: Record<string, string> = {};
const addedCodes: string[] = [];

async function signUp(tag = 'cart', browser = newBrowser()) {
  switchBrowser(browser);
  const email = `${tag}-${uuid()}@example.com`;
  const result = await authActions.signUpAction({
    name: 'Maya Lopez',
    email,
    password: PASSWORD,
    captchaToken: 'ok',
  });
  expect(result?.data?.signedIn).toBe(true);
  const { id } = await migrator.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  return { browser, userId: id };
}

/** A customer with Dana's Home address (4.3 km) as their default. */
async function dana() {
  const who = await signUp('dana');
  const saved = await addresses.createAddressAction(PLACES.peterborough);
  expect(saved?.data?.isDefault).toBe(true);
  return { ...who, homeId: saved.data!.id };
}

const guest = () => switchBrowser(newBrowser());

let keys = 0;
const line = (slug: string, quantity = 1, extra: Record<string, unknown> = {}) => ({
  key: `k${(keys += 1)}`,
  menuItemId: dish[slug]!,
  quantity,
  ...extra,
});

/** Cart A: 2 × Gimbap + 1 × Pad Thai. */
const cartA = () => [line('gimbap', 2), line('pad-thai')];

async function quote(input: Parameters<typeof quoteCartAction>[0]) {
  const result = await quoteCartAction(input);
  expect(result?.serverError).toBeUndefined();
  expect(result?.validationErrors).toBeUndefined();
  return result.data!;
}

async function addCoupon(code: string, data: Record<string, unknown>) {
  addedCodes.push(code);
  return migrator.coupon.create({
    data: { code, type: 'PERCENT', value: 10, ...data },
    select: { id: true },
  });
}

async function addOrder(userId: string, status: 'DELIVERED' | 'PENDING_PAYMENT', number: string) {
  return migrator.order.create({
    data: {
      number,
      userId,
      status,
      paymentMethod: 'CARD',
      contactName: 'Maya Lopez',
      contactPhone: '+16175550142',
      addressText: '12 Peterborough Street',
      addressLat: 42.3467,
      addressLng: -71.0972,
      distanceKm: 4.3,
      subtotalCents: 2000,
      deliveryFeeCents: 414,
      taxCents: 140,
      totalCents: 2554,
    },
    select: { id: true },
  });
}

const isPromoLimiter = (limiter: RateLimiterRedis) =>
  limiter.keyPrefix.startsWith('rl:coupon.miss');

/** The limiters behind the guessing policies stop answering, as if Redis had gone away. */
function promoLimiterDown() {
  const prototype = RateLimiterRedis.prototype;
  const consume: RateLimiterRedis['consume'] = Reflect.get(prototype, 'consume');
  const get: RateLimiterRedis['get'] = Reflect.get(prototype, 'get');
  const down = isPromoLimiter;
  vi.spyOn(prototype, 'consume').mockImplementation(function (
    this: RateLimiterRedis,
    ...args: Parameters<RateLimiterRedis['consume']>
  ) {
    return down(this) ? Promise.reject(new Error('connection lost')) : consume.apply(this, args);
  });
  vi.spyOn(prototype, 'get').mockImplementation(function (
    this: RateLimiterRedis,
    ...args: Parameters<RateLimiterRedis['get']>
  ) {
    return down(this) ? Promise.reject(new Error('connection lost')) : get.apply(this, args);
  });
}

beforeAll(async () => {
  migrator = new PrismaClient({
    adapter: new PrismaPg({ connectionString: inject('migratorUrl') }),
  });
  await migrator.$transaction((tx) => seedCatalog(tx, { now: new Date() }), { timeout: 60_000 });
  for (const row of await migrator.menuItem.findMany({ select: { id: true, slug: true } })) {
    dish[row.slug] = row.id;
  }
}, 120_000);

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await migrator.couponRedemption.deleteMany({ where: { coupon: { code: { in: addedCodes } } } });
  await migrator.coupon.deleteMany({ where: { code: { in: addedCodes } } });
  await migrator.$disconnect();
  await redis.quit();
});

describe('worked quotes on the seeded menu and settings (Q1 to Q11 at 7 %)', () => {
  it('Q1: a guest sees $51.33 before delivery, with the fee range', async () => {
    guest();
    const q = await quote({ lines: cartA() });
    expect(q).toMatchObject({
      subtotalCents: 4797,
      promo: null,
      tax: { rateBps: 700, cents: 336 },
      tipCents: 0,
      totalCents: 5133,
      totalKind: 'beforeDelivery',
      delivery: {
        kind: 'none',
        status: 'unknown',
        feeCents: null,
        feeRange: { minCents: 199, maxCents: 599 },
        missingAddress: false,
      },
    });
  });

  it('Q2 to Q5: Dana’s Home address, with no code, WELCOME10, KBBQ5 and FREEDELIVERY', async () => {
    const { homeId } = await dana();
    const q2 = await quote({ lines: cartA() });
    expect(q2.delivery).toMatchObject({
      kind: 'saved',
      address: { id: homeId, label: 'Home', line1: '12 Peterborough Street' },
      status: 'inside',
      distanceKm: 4.3,
      feeCents: 414,
    });
    expect(q2.totalCents).toBe(5547);
    expect(q2.totalKind).toBe('final');

    const q3 = await quote({ lines: cartA(), code: 'WELCOME10' });
    expect(q3.promo).toMatchObject({
      code: 'WELCOME10',
      status: 'applied',
      description: '10% off one order, once per customer (up to $10)',
      amountCents: 480,
      message: null,
    });
    expect([q3.tax.cents, q3.totalCents]).toEqual([302, 5033]);

    const q4 = await quote({ lines: cartA(), code: 'kbbq5' });
    expect(q4.promo).toMatchObject({ code: 'KBBQ5', status: 'applied', foodDiscountCents: 500 });
    expect([q4.tax.cents, q4.totalCents]).toEqual([301, 5012]);

    const q5 = await quote({ lines: cartA(), code: 'FREEDELIVERY' });
    expect(q5.delivery.feeCents).toBe(414);
    expect(q5.promo).toMatchObject({
      status: 'applied',
      freeDelivery: true,
      deliveryDiscountCents: 414,
      foodDiscountCents: 0,
    });
    expect([q5.tax.cents, q5.totalCents]).toEqual([336, 5133]);
  });

  it('Q6: Priya’s Work address, picked by id: $2.64 and $53.97', async () => {
    await signUp('priya');
    await addresses.createAddressAction(PLACES.peterborough);
    const work = await addresses.createAddressAction(PLACES.faneuil);
    const q = await quote({
      lines: cartA(),
      delivery: { kind: 'saved', addressId: work.data!.id },
    });
    expect(q.delivery).toMatchObject({
      distanceKm: 1.3,
      feeCents: 264,
      address: { label: 'Work' },
    });
    expect(q.totalCents).toBe(5397);
  });

  it('Q7 to Q10: minimums, the cap and the half cent', async () => {
    await dana();
    const q7 = await quote({ lines: [line('kimchi'), line('pad-thai')], code: 'KBBQ5' });
    expect(q7.promo).toMatchObject({
      status: 'notApplied',
      reason: { code: 'minimumNotReached', rule: 'R9', shortfallCents: 1801 },
      message: 'KBBQ5 needs $25.00 of Korean dishes. You have $6.99, so add $18.01 more.',
    });
    expect(q7.totalCents).toBe(3515);

    const q8 = await quote({ lines: [line('kimchi')], code: 'WELCOME10' });
    expect(q8.promo?.message).toBe(
      'WELCOME10 needs a subtotal of $15.00. Add $8.01 more to use it.',
    );
    expect(q8.totalCents).toBe(1162);

    const q9 = await quote({ lines: [line('samgyeopsal', 10)], code: 'WELCOME10' });
    expect([q9.promo?.amountCents, q9.totalCents]).toEqual([1000, 26083]);

    const q10 = await quote({ lines: [line('kimchi', 5)], code: 'WELCOME10' });
    expect([q10.promo?.amountCents, q10.tax.cents, q10.totalCents]).toEqual([350, 220, 3779]);
  });

  it('Q11: 50 items, the most a cart holds: $538.61', async () => {
    await dana();
    const q = await quote({
      lines: [line('kimchi', 20), line('gimbap', 20), line('cha-gio', 10)],
    });
    expect([q.itemCount, q.subtotalCents, q.tax.cents, q.totalCents]).toEqual([
      50, 49950, 3497, 53861,
    ]);
  });

  it('follows a change to the tax rate in the database at once (S2.13)', async () => {
    await dana();
    await migrator.siteSettings.update({ where: { id: 1 }, data: { taxRateBps: 625 } });
    try {
      const q = await quote({ lines: cartA() });
      expect([q.tax.rateBps, q.tax.cents, q.totalCents]).toEqual([625, 300, 5511]);
    } finally {
      await migrator.siteSettings.update({ where: { id: 1 }, data: { taxRateBps: 700 } });
    }
  });
});

describe('lines the server checks (S1.16, S3.1 to S3.4)', () => {
  it('flags sold-out dishes, drops gone ones and extras the dish doesn’t offer', async () => {
    guest();
    const gone = uuid();
    const gimbap = await migrator.menuItem.findUniqueOrThrow({
      where: { slug: 'gimbap' },
      select: { flavors: true },
    });
    const offered = gimbap.flavors[0]!;
    const q = await quote({
      lines: [
        { key: 'a', menuItemId: dish.gimbap!, quantity: 2, flavors: [offered, 'Strawberry jam'] },
        { key: 'b', menuItemId: dish.naengmyeon!, quantity: 1 },
        { key: 'c', menuItemId: gone, quantity: 3 },
      ],
    });
    expect(q.lines).toEqual([
      expect.objectContaining({
        key: 'a',
        status: 'ok',
        unitPriceCents: 1299,
        lineTotalCents: 2598,
        inSubtotal: true,
        flavors: [offered],
        droppedFlavors: ['Strawberry jam'],
        flavorsOffered: gimbap.flavors,
        dish: expect.objectContaining({ title: 'Gimbap', slug: 'gimbap', cuisine: 'KOREAN' }),
      }),
      expect.objectContaining({
        key: 'b',
        status: 'soldOut',
        lineTotalCents: 1599,
        inSubtotal: false,
      }),
      expect.objectContaining({
        key: 'c',
        menuItemId: gone,
        status: 'removed',
        dish: null,
        unitPriceCents: null,
        inSubtotal: false,
      }),
    ]);
    expect(q.subtotalCents).toBe(2598);
    expect(q.checkoutBlockers).toContain('soldOut');
  });

  it('keeps notes as typed but without control characters, and never runs markup', async () => {
    guest();
    const q = await quote({
      lines: [
        line('gimbap', 1, { note: 'No cucumber\u0000\r\nplease' }),
        line('kimchi', 1, { note: '<script>alert(1)</script>' }),
        line('bulgogi', 1, { note: '   ' }),
      ],
    });
    expect(q.lines.map((l) => l.note)).toEqual([
      'No cucumber please',
      '<script>alert(1)</script>',
      null,
    ]);
  });

  it('refuses a tampered cart with a plain error and prices nothing', async () => {
    guest();
    const refused = [
      { lines: [line('gimbap', 999)] },
      { lines: [line('gimbap', 1, { note: 'x'.repeat(500) })] },
      { lines: [line('gimbap', 1, { flavors: ['a', 'b', 'c', 'd', 'e', 'f'] })] },
      { lines: [line('gimbap', 1, { unitPriceCents: 1 })] },
      { lines: [line('gimbap')], discountCents: 4797 },
    ];
    for (const input of refused) {
      const result = await quoteCartAction(input);
      expect(result?.data).toBeUndefined();
      expect(result?.validationErrors).toBeDefined();
    }
  });

  it('refuses more than 25 lines or 50 items with the phone number (S1.12)', async () => {
    guest();
    const lines = Array.from({ length: 26 }, (_, i) =>
      line(i % 2 ? 'gimbap' : 'kimchi', 1, { note: `n${i}` }),
    );
    const tooMany = (await quoteCartAction({ lines }))?.serverError;
    expect(tooMany).toMatchObject({
      code: 'CART_TOO_BIG',
      message: 'Your cart is full (50 items). For a bigger order, call us on (617) 555-0142.',
      details: { maxItems: 50, maxLines: 25, phone: '(617) 555-0142' },
    });
    const items = [line('kimchi', 20), line('gimbap', 20), line('cha-gio', 11)];
    expect((await quoteCartAction({ lines: items }))?.serverError?.code).toBe('CART_TOO_BIG');
  });
});

describe('where it goes (S2.6 to S2.8, U2)', () => {
  it('prices an address checked without saving it, and the edge pins', async () => {
    guest();
    const inside = await quote({
      lines: cartA(),
      delivery: { kind: 'point', ...PLACES.edgeInside },
    });
    expect(inside.delivery).toMatchObject({
      kind: 'point',
      status: 'inside',
      distanceKm: 7.9,
      feeCents: 594,
    });
    expect(inside.totalCents).toBe(5133 + 594);

    const outside = await quote({
      lines: cartA(),
      delivery: { kind: 'point', ...PLACES.edgeOutside },
    });
    expect(outside.delivery).toMatchObject({
      status: 'outside',
      distanceKm: 8.1,
      feeCents: null,
      edge: null,
    });
    expect(outside.totalKind).toBe('beforeDelivery');
    expect(outside.checkoutBlockers).toContain('outside');
  });

  it('never uses another customer’s saved address, nor a saved address for a guest', async () => {
    const { homeId } = await dana();
    await signUp('other');
    const other = await quote({ lines: cartA(), delivery: { kind: 'saved', addressId: homeId } });
    expect(other.delivery).toMatchObject({
      kind: 'none',
      status: 'unknown',
      address: null,
      missingAddress: true,
    });

    guest();
    const anonymous = await quote({
      lines: cartA(),
      delivery: { kind: 'saved', addressId: homeId },
    });
    expect(anonymous.delivery).toMatchObject({ kind: 'none', missingAddress: true });
    // A signed-in customer with nothing saved quotes like a guest.
    const empty = await quote({ lines: cartA(), delivery: { kind: 'default' } });
    expect(empty.delivery).toMatchObject({ kind: 'none', missingAddress: false });
  });
});

describe('promo refusals, R1 to R9 (S4 table)', () => {
  it('R1: unknown, switched off and someone else’s personal code look exactly alike (S4.16)', async () => {
    const owner = await signUp('credit-owner');
    const credit = `CREDIT-${TAG}-7Q2XK9`;
    await addCoupon(credit, {
      type: 'FIXED',
      value: 800,
      ownerUserId: owner.userId,
      isStoreCredit: true,
      usageLimit: 1,
      perUserLimit: 1,
      description: 'Store credit',
    });
    await addCoupon(`PAUSED-${TAG}`, { isActive: false, value: 20 });

    // The owner gets it like a fixed amount.
    const own = await quote({ lines: cartA(), code: credit });
    expect(own.promo).toMatchObject({
      status: 'applied',
      foodDiscountCents: 800,
      description: 'Store credit',
    });

    const shapes = [];
    for (const who of ['other', 'guest'] as const) {
      if (who === 'other') await signUp('not-owner');
      else guest();
      for (const code of [credit, `PAUSED-${TAG}`, `NOPE-${TAG}`]) {
        const { promo } = await quote({ lines: cartA(), code });
        expect(promo).toMatchObject({
          status: 'refused',
          reason: { code: 'notFound', rule: 'R1' },
          message: `We couldn't find the code ${code}. Check the spelling, or try another code.`,
        });
        shapes.push({ ...promo, code: '', message: '' });
      }
    }
    // Nothing about the personal code (owner, amount, kind) leaks: every R1 is the same object.
    for (const shape of shapes) expect(shape).toEqual(shapes[0]);
  });

  it('R2 to R4 and R8, with the story’s sentences', async () => {
    await dana();
    const starts = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await addCoupon(`NEXT-${TAG}`, { value: 15, startsAt: starts });
    await addCoupon(`FULL-${TAG}`, { type: 'FIXED', value: 300, usageLimit: 100, usedCount: 100 });

    const r2 = (await quote({ lines: cartA(), code: `NEXT-${TAG}` })).promo;
    expect(r2).toMatchObject({
      status: 'refused',
      reason: { code: 'notStarted', startsAt: starts.toISOString() },
    });
    expect(r2?.message).toMatch(
      new RegExp(`^NEXT-${TAG} starts on \\w+day, \\w+ \\d+\\. You can use it from then\\.$`),
    );

    const r3 = (await quote({ lines: cartA(), code: 'SUMMER25' })).promo;
    expect(r3).toMatchObject({
      reason: { code: 'ended', rule: 'R3' },
      description: 'Expired summer offer',
    });
    expect(r3?.message).toMatch(/^SUMMER25 ended on \w+ \d+, so it can't be used any more\.$/);

    expect((await quote({ lines: cartA(), code: `FULL-${TAG}` })).promo?.message).toBe(
      `Sorry, FULL-${TAG} has run out.`,
    );
    expect((await quote({ lines: [line('pad-thai')], code: 'KBBQ5' })).promo?.message).toBe(
      'KBBQ5 is for Korean dishes. Add a Korean dish to use it.',
    );
  });

  it('R5 to R7: one per customer needs sign-in, then counts uses and unpaid orders', async () => {
    guest();
    expect((await quote({ lines: cartA(), code: 'WELCOME10' })).promo).toMatchObject({
      status: 'refused',
      reason: { code: 'signInRequired', rule: 'R5', perCustomer: 1 },
      message: "Sign in to use WELCOME10. It's one per customer, so we need to know it's you.",
    });

    const used = await signUp('used');
    const welcome = await migrator.coupon.findUniqueOrThrow({
      where: { code: 'WELCOME10' },
      select: { id: true },
    });
    const past = await addOrder(used.userId, 'DELIVERED', `T-${uuid().slice(-8)}`);
    await migrator.couponRedemption.create({
      data: {
        couponId: welcome.id,
        userId: used.userId,
        orderId: past.id,
        status: 'REDEEMED',
        discountCents: 480,
      },
    });
    expect((await quote({ lines: cartA(), code: 'WELCOME10' })).promo).toMatchObject({
      reason: { code: 'alreadyUsed', rule: 'R6' },
      message: "You've already used WELCOME10. It's one per customer.",
    });

    const held = await signUp('held');
    const number = `${Math.floor(Math.random() * 9000) + 1000}`;
    const unpaid = await addOrder(held.userId, 'PENDING_PAYMENT', number);
    await migrator.couponRedemption.create({
      data: {
        couponId: welcome.id,
        userId: held.userId,
        orderId: unpaid.id,
        status: 'RESERVED',
        discountCents: 480,
      },
    });
    expect((await quote({ lines: cartA(), code: 'WELCOME10' })).promo).toMatchObject({
      reason: { code: 'onHold', rule: 'R7', orderNumber: number },
      message: `WELCOME10 is on hold for your unpaid order ${number}. It frees up if that order isn't paid within 15 minutes.`,
    });
    await migrator.couponRedemption.deleteMany({
      where: { userId: { in: [used.userId, held.userId] } },
    });
  });

  it('checks the code again in every quote (S4.15): a code switched off since gives R1', async () => {
    await dana();
    const code = `LIVE-${TAG}`;
    await addCoupon(code, { type: 'FIXED', value: 200 });
    expect((await quote({ lines: cartA(), code })).promo?.status).toBe('applied');
    await migrator.coupon.update({ where: { code }, data: { isActive: false } });
    expect((await quote({ lines: cartA(), code })).promo?.reason?.code).toBe('notFound');
  });
});

describe('code guessing (B5, S4.13, S4.14)', () => {
  it('counts only unknown codes, 10 per account, then refuses every new code with the wait', async () => {
    await dana();
    // Real codes never count, however often they are checked.
    for (let i = 0; i < 15; i++) {
      expect((await quote({ lines: cartA(), code: 'KBBQ5' })).promo?.status).toBe('applied');
    }
    for (let i = 0; i < 10; i++) {
      expect((await quote({ lines: cartA(), code: `GUESS${i}-${TAG}` })).promo?.status).toBe(
        'refused',
      );
    }
    const blocked = await quote({ lines: cartA(), code: `GUESS10-${TAG}` });
    expect(blocked.promo).toMatchObject({
      status: 'unchecked',
      reason: { code: 'rateLimited', rule: null },
      message: 'Too many codes tried. You can try again in 10 minutes.',
      amountCents: 0,
    });
    expect(blocked.promo?.retryAfterSeconds).toBeGreaterThan(9 * 60);
    // The cart keeps working.
    expect(blocked.totalCents).toBe(5547);

    // While blocked, a real code not checked before is refused exactly like a made-up one...
    const fresh = await quote({ lines: cartA(), code: 'FREEDELIVERY' });
    expect(fresh.promo).toMatchObject({ status: 'unchecked', reason: { code: 'rateLimited' } });
    // ...but the code already in the cart keeps working.
    expect((await quote({ lines: cartA(), code: 'KBBQ5' })).promo?.status).toBe('applied');
  });

  it('follows the account to another network, and blocks a network after 30 unknown codes', async () => {
    const { browser } = await dana();
    for (let i = 0; i < 11; i++) await quote({ lines: cartA(), code: `ROAM${i}-${TAG}` });
    // Same session, another network: still blocked.
    browser.ip = `roaming-${uuid()}`;
    expect((await quote({ lines: cartA(), code: `ROAM-X-${TAG}` })).promo?.status).toBe(
      'unchecked',
    );

    // One network, three guests' worth of guesses.
    const network = `shared-${uuid()}`;
    const onNetwork = (): Browser => switchBrowser({ ...newBrowser(), ip: network });
    onNetwork();
    for (let i = 0; i < 30; i++) {
      expect((await quote({ lines: cartA(), code: `NET${i}-${TAG}` })).promo?.status).toBe(
        'refused',
      );
    }
    expect((await quote({ lines: cartA(), code: `NET30-${TAG}` })).promo?.status).toBe('unchecked');
    // Signing in on that network doesn't reset it.
    await signUp('same-network', { ...newBrowser(), ip: network });
    expect((await quote({ lines: cartA(), code: `NET31-${TAG}` })).promo?.status).toBe('unchecked');
    // Another network is unaffected.
    guest();
    expect((await quote({ lines: cartA(), code: `NET32-${TAG}` })).promo?.status).toBe('refused');
  });

  it('quotes without the code while the checker is down (fails closed)', async () => {
    await dana();
    promoLimiterDown();
    for (const code of ['KBBQ5', `DOWN-${TAG}`]) {
      const q = await quote({ lines: cartA(), code });
      expect(q.promo).toMatchObject({
        status: 'unchecked',
        reason: { code: 'unavailable' },
        message:
          "We can't check promo codes right now. Your cart is fine. Try the code again in a minute.",
        amountCents: 0,
      });
      expect(q.totalCents).toBe(5547);
    }
    vi.restoreAllMocks();
    // Quotes without a code never touch those limiters.
    expect((await quote({ lines: cartA() })).totalCents).toBe(5547);
  });
});

describe('offers and the store (S4.10, S3.5)', () => {
  it('lists running campaigns’ codes, tried on this cart, never personal ones', async () => {
    await dana();
    const kbbq = await migrator.coupon.findUniqueOrThrow({
      where: { code: 'KBBQ5' },
      select: { endsAt: true },
    });
    const offers = (await quote({ lines: [line('kimchi'), line('pad-thai')] })).offers;
    const byCode = Object.fromEntries(offers.map((offer) => [offer.code, offer]));
    expect(byCode.KBBQ5).toMatchObject({
      campaignTitle: 'Korean BBQ weekend',
      kind: 'fixed',
      status: 'notApplied',
      reason: { code: 'minimumNotReached', shortfallCents: 1801 },
    });
    expect(Date.parse(byCode.KBBQ5!.endsAt)).toBeLessThanOrEqual(kbbq.endsAt!.getTime());
    // $28.98 is under FREEDELIVERY's $30: it stays offered, "not applied yet".
    expect(byCode.FREEDELIVERY).toMatchObject({
      status: 'notApplied',
      kind: 'freeDelivery',
      reason: { code: 'minimumNotReached', shortfallCents: 102 },
    });
    for (const offer of offers) expect(offer.code).not.toMatch(/^CREDIT-/);

    const full = (await quote({ lines: cartA() })).offers;
    expect(full.find((offer) => offer.code === 'FREEDELIVERY')).toMatchObject({
      status: 'applied',
      amountCents: 414,
    });
  });

  it('says when the store is closed and when it opens', async () => {
    // Sunday 22:30 in Boston (closes at 21:00; Monday opens 11:00).
    const now = new Date('2026-11-23T03:30:00Z');
    const q = await quoteCart(
      { kind: 'anonymous' },
      { lines: cartA() },
      { ip: `closed-${uuid()}` },
      now,
    );
    expect(q.store).toMatchObject({ isOpen: false, timeZone: 'America/New_York' });
    expect(q.store.opensAt).toMatchObject({ weekday: 'mon', time: '11:00', day: 'tomorrow' });
    expect(q.checkoutBlockers).toContain('closed');
  });

  it('is limited to 120 quotes a minute per network', async () => {
    const browser = guest();
    browser.ip = `quote-${uuid()}`;
    for (let i = 0; i < 120; i++) {
      expect((await quoteCartAction({ lines: [] }))?.serverError).toBeUndefined();
    }
    expect((await quoteCartAction({ lines: [] }))?.serverError).toMatchObject({
      code: 'RATE_LIMITED',
    });
  });
});
