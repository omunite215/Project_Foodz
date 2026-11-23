import { describe, expect, it } from 'vitest';
import {
  type CouponFacts,
  type CustomerFacts,
  deliveryFee,
  type DeliveryPoint,
  evaluatePromo,
  type PricedLine,
  type PricingSettings,
  quote,
  type QuoteCalcInput,
  roundHalfUp,
  arrivalWindow,
  cashAllowed,
  tipFor,
  tipOptions,
} from './pricing';
import type { TipChoice } from './schema';

// Store settings and prices as seeded (F3 U1: tax 7 %).
const SETTINGS: PricingSettings = {
  taxRateBps: 700,
  baseDeliveryFeeCents: 199,
  perKmFeeCents: 50,
  deliveryRadiusKm: 8,
};

const NOW = new Date('2026-11-20T23:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

const DISHES = {
  gimbap: { cuisine: 'KOREAN', price: 1299 },
  kimchi: { cuisine: 'KOREAN', price: 699 },
  bibimbap: { cuisine: 'KOREAN', price: 1699 },
  samgyeopsal: { cuisine: 'KOREAN', price: 2499 },
  padThai: { cuisine: 'THAI', price: 2199 },
  friedThaiRice: { cuisine: 'THAI', price: 1599 },
  chaGio: { cuisine: 'VIETNAMESE', price: 999 },
} as const;

type DishName = keyof typeof DISHES;

let keys = 0;
const line = (dish: DishName, quantity = 1, status: PricedLine['status'] = 'ok'): PricedLine => ({
  key: `line-${(keys += 1)}`,
  status,
  cuisine: DISHES[dish].cuisine,
  unitPriceCents: DISHES[dish].price,
  quantity,
});

/** Cart A: 2 × Gimbap + 1 × Pad Thai, $47.97 (Korean part $25.98). */
const cartA = () => [line('gimbap', 2), line('padThai')];

const GUEST: DeliveryPoint = { status: 'unknown' };
const DANA_HOME: DeliveryPoint = { status: 'inside', distanceMeters: 4300 };
const PRIYA_WORK: DeliveryPoint = { status: 'inside', distanceMeters: 1300 };

const DANA = 'b3f1c3c2-9a0e-4c8e-9f0a-1d2e3f4a5b6c';
const PRIYA = 'c4a2d4d3-0b1f-4d9f-8a1b-2e3f4a5b6c7d';

const customer = (userId: string | null, extra: Partial<CustomerFacts> = {}): CustomerFacts => ({
  userId,
  redeemed: 0,
  heldBy: [],
  ...extra,
});

const coupon = (code: string, extra: Partial<CouponFacts>): CouponFacts => ({
  code,
  description: null,
  type: 'PERCENT',
  value: 10,
  minSubtotalCents: 0,
  maxDiscountCents: null,
  usageLimit: null,
  usedCount: 0,
  perUserLimit: null,
  cuisines: [],
  ownerUserId: null,
  isStoreCredit: false,
  isActive: true,
  startsAt: new Date(NOW.getTime() - DAY),
  endsAt: null,
  ...extra,
});

// The seeded codes (prisma/seeding/content.ts).
const WELCOME10 = coupon('WELCOME10', {
  description: '10% off one order, once per customer (up to $10)',
  type: 'PERCENT',
  value: 10,
  minSubtotalCents: 1500,
  maxDiscountCents: 1000,
  perUserLimit: 1,
});
const FREEDELIVERY = coupon('FREEDELIVERY', {
  description: 'Free delivery on orders over $30',
  type: 'FREE_DELIVERY',
  value: 0,
  minSubtotalCents: 3000,
});
const KBBQ5 = coupon('KBBQ5', {
  description: '$5 off Korean dishes over $25',
  type: 'FIXED',
  value: 500,
  minSubtotalCents: 2500,
  cuisines: ['KOREAN'],
  endsAt: new Date(NOW.getTime() + 30 * DAY),
});

const withCode = (facts: CouponFacts | null, who: CustomerFacts, code = facts?.code ?? 'NOPE') =>
  ({ kind: 'lookup', code, coupon: facts, customer: who }) as const;

function run(input: Partial<QuoteCalcInput> & Pick<QuoteCalcInput, 'lines'>) {
  return quote({ promo: null, delivery: GUEST, settings: SETTINGS, now: NOW, ...input });
}

describe('rounding', () => {
  it('rounds half up, once, on integers only', () => {
    expect(roundHalfUp(3495 * 10, 100)).toBe(350); // 349.5¢
    expect(roundHalfUp(49950 * 700, 10000)).toBe(3497); // 3,496.5¢
    expect(roundHalfUp(4797 * 700, 10000)).toBe(336); // 335.79¢
    expect(roundHalfUp(4797 * 10, 100)).toBe(480); // 479.7¢
    expect(roundHalfUp(2898 * 700, 10000)).toBe(203); // 202.86¢
    expect(roundHalfUp(0, 100)).toBe(0);
    expect(() => roundHalfUp(-1, 100)).toThrow('numerator must be a whole, non-negative number');
    expect(() => roundHalfUp(1.5, 100)).toThrow('numerator must be a whole, non-negative number');
    expect(() => roundHalfUp(1, 0)).toThrow('denominator must be a whole, positive number');
  });

  it('works out the delivery fee from the distance rounded to 0.1 km (B3)', () => {
    const fee = (km: number) => deliveryFee(Math.round(km * 10), SETTINGS);
    expect(fee(4.3)).toBe(414); // $1.99 + 4.3 × $0.50
    expect(fee(1.3)).toBe(264);
    expect(fee(6.6)).toBe(529);
    expect(fee(7.9)).toBe(594);
    expect(fee(8)).toBe(599);
    expect(fee(0)).toBe(199);
    // An odd per-km fee rounds the half cent up: 45 × 4.3 = 193.5¢.
    expect(deliveryFee(43, { ...SETTINGS, perKmFeeCents: 45 })).toBe(199 + 194);
  });
});

describe('worked quotes Q1 to Q11 at 7 % (design.md "Story changes" 1 and 2)', () => {
  it('Q1: cart A, guest, no code: $51.33 before delivery', () => {
    const q = run({ lines: cartA() });
    expect(q.subtotalCents).toBe(4797);
    expect(q.promo).toBeNull();
    expect(q.delivery).toMatchObject({
      status: 'unknown',
      feeCents: null,
      distanceKm: null,
      feeRange: { minCents: 199, maxCents: 599 },
    });
    expect(q.tax).toEqual({ rateBps: 700, cents: 336 });
    expect(q.tipCents).toBe(0);
    expect(q.totalCents).toBe(5133);
    expect(q.totalKind).toBe('beforeDelivery');
  });

  it('Q2: cart A, Dana, no code: $55.47', () => {
    const q = run({ lines: cartA(), delivery: DANA_HOME });
    expect(q.delivery).toMatchObject({ status: 'inside', distanceKm: 4.3, feeCents: 414 });
    expect(q.tax.cents).toBe(336);
    expect(q.totalCents).toBe(5547);
    expect(q.totalKind).toBe('final');
  });

  it('Q3: cart A, Dana, WELCOME10: −$4.80, tax $3.02, $50.33', () => {
    const q = run({
      lines: cartA(),
      delivery: DANA_HOME,
      promo: withCode(WELCOME10, customer(DANA)),
    });
    expect(q.promo).toMatchObject({
      status: 'applied',
      foodDiscountCents: 480,
      deliveryDiscountCents: 0,
      amountCents: 480,
      kind: 'percent',
    });
    expect(q.tax.cents).toBe(302);
    expect(q.totalCents).toBe(5033);
  });

  it('Q4: cart A, Dana, KBBQ5: −$5.00, tax $3.01, $50.12', () => {
    const q = run({ lines: cartA(), delivery: DANA_HOME, promo: withCode(KBBQ5, customer(DANA)) });
    expect(q.promo).toMatchObject({ status: 'applied', foodDiscountCents: 500, kind: 'fixed' });
    expect(q.tax.cents).toBe(301);
    expect(q.totalCents).toBe(5012);
  });

  it('Q5: cart A, Dana, FREEDELIVERY: free (was $4.14), tax on the food only, $51.33', () => {
    const q = run({
      lines: cartA(),
      delivery: DANA_HOME,
      promo: withCode(FREEDELIVERY, customer(DANA)),
    });
    // The real fee stays on the quote; free delivery is a discount the store pays (B4).
    expect(q.delivery.feeCents).toBe(414);
    expect(q.promo).toMatchObject({
      status: 'applied',
      freeDelivery: true,
      foodDiscountCents: 0,
      deliveryDiscountCents: 414,
      amountCents: 414,
      kind: 'freeDelivery',
    });
    expect(q.tax.cents).toBe(336);
    expect(q.totalCents).toBe(5133);
  });

  it('Q6: cart A, Priya, no code: $2.64 delivery, $53.97', () => {
    const q = run({ lines: cartA(), delivery: PRIYA_WORK });
    expect(q.delivery).toMatchObject({ distanceKm: 1.3, feeCents: 264 });
    expect(q.totalCents).toBe(5397);
  });

  it('Q7: Kimchi + Pad Thai, Dana, KBBQ5: not applied (Korean part $6.99), $35.15', () => {
    const q = run({
      lines: [line('kimchi'), line('padThai')],
      delivery: DANA_HOME,
      promo: withCode(KBBQ5, customer(DANA)),
    });
    expect(q.subtotalCents).toBe(2898);
    expect(q.promo).toMatchObject({
      status: 'notApplied',
      amountCents: 0,
      reason: {
        code: 'minimumNotReached',
        rule: 'R9',
        minSubtotalCents: 2500,
        eligibleCents: 699,
        shortfallCents: 1801,
        cuisines: ['KOREAN'],
      },
    });
    expect(q.tax.cents).toBe(203);
    expect(q.totalCents).toBe(3515);
  });

  it('Q8: Kimchi, Dana, WELCOME10: not applied (under $15), $11.62', () => {
    const q = run({
      lines: [line('kimchi')],
      delivery: DANA_HOME,
      promo: withCode(WELCOME10, customer(DANA)),
    });
    expect(q.promo).toMatchObject({
      status: 'notApplied',
      reason: { code: 'minimumNotReached', eligibleCents: 699, shortfallCents: 801, cuisines: [] },
    });
    expect(q.tax.cents).toBe(49);
    expect(q.totalCents).toBe(1162);
  });

  it('Q9: 10 × Samgyeopsal, Dana, WELCOME10: capped at −$10.00, $260.83', () => {
    const q = run({
      lines: [line('samgyeopsal', 10)],
      delivery: DANA_HOME,
      promo: withCode(WELCOME10, customer(DANA)),
    });
    expect(q.subtotalCents).toBe(24990);
    expect(q.promo?.foodDiscountCents).toBe(1000);
    expect(q.tax.cents).toBe(1679);
    expect(q.totalCents).toBe(26083);
  });

  it('Q10: 5 × Kimchi, Dana, WELCOME10: 349.5¢ rounds up to −$3.50, $37.79', () => {
    const q = run({
      lines: [line('kimchi', 5)],
      delivery: DANA_HOME,
      promo: withCode(WELCOME10, customer(DANA)),
    });
    expect(q.subtotalCents).toBe(3495);
    expect(q.promo?.foodDiscountCents).toBe(350);
    expect(q.tax.cents).toBe(220);
    expect(q.totalCents).toBe(3779);
  });

  it('Q11 (old cart): 3 × Bibimbap + Fried Thai Rice, Dana: tax $4.69, $75.79', () => {
    const q = run({ lines: [line('bibimbap', 3), line('friedThaiRice')], delivery: DANA_HOME });
    expect(q.subtotalCents).toBe(6696);
    expect(q.tax.cents).toBe(469);
    expect(q.totalCents).toBe(7579);
  });

  it('Q11: 20 Kimchi + 20 Gimbap + 10 Chả Giò (50 items), Dana: 3,496.5¢ tax rounds up, $538.61', () => {
    const q = run({
      lines: [line('kimchi', 20), line('gimbap', 20), line('chaGio', 10)],
      delivery: DANA_HOME,
    });
    expect(q.itemCount).toBe(50);
    expect(q.subtotalCents).toBe(49950);
    expect(q.tax.cents).toBe(3497);
    expect(q.totalCents).toBe(53861);
  });

  it('adds up to the cent: total = subtotal − promo + delivery + tax + tip (S2.3)', () => {
    for (const promo of [
      null,
      withCode(WELCOME10, customer(DANA)),
      withCode(FREEDELIVERY, customer(DANA)),
    ]) {
      const q = run({ lines: cartA(), delivery: DANA_HOME, promo });
      const lines = q.lines.reduce((sum, l) => sum + (l.inSubtotal ? l.lineTotalCents : 0), 0);
      expect(lines).toBe(q.subtotalCents);
      expect(q.totalCents).toBe(
        q.subtotalCents -
          (q.promo?.amountCents ?? 0) +
          (q.delivery.feeCents ?? 0) +
          q.tax.cents +
          q.tipCents,
      );
    }
  });
});

describe('lines', () => {
  it('leaves sold-out and removed dishes out of the subtotal but keeps their place (S3.1, S3.2)', () => {
    const lines = [
      line('gimbap', 2),
      line('kimchi', 1, 'soldOut'),
      {
        key: 'gone',
        status: 'removed' as const,
        cuisine: null,
        unitPriceCents: null,
        quantity: 3,
      },
    ];
    const q = run({ lines, delivery: DANA_HOME });
    expect(q.lines.map((l) => [l.lineTotalCents, l.inSubtotal])).toEqual([
      [2598, true],
      [699, false],
      [0, false],
    ]);
    expect(q.subtotalCents).toBe(2598);
    expect(q.itemCount).toBe(2);
  });

  it('takes a tip into the total, untaxed (F4)', () => {
    const q = run({ lines: cartA(), delivery: DANA_HOME, tipCents: 500 });
    expect(q.tax.cents).toBe(336);
    expect(q.totalCents).toBe(5547 + 500);
  });

  it('quotes an empty cart as zero', () => {
    const q = run({ lines: [], delivery: DANA_HOME });
    expect(q).toMatchObject({ subtotalCents: 0, itemCount: 0, tax: { cents: 0 } });
    expect(q.totalCents).toBe(414);
  });
});

describe('delivery', () => {
  it('says "just over" when outside but the distance rounds to the radius (B3)', () => {
    const q = run({ lines: cartA(), delivery: { status: 'outside', distanceMeters: 8040 } });
    expect(q.delivery).toMatchObject({
      status: 'outside',
      distanceKm: 8,
      edge: 'justOver',
      feeCents: null,
    });
    expect(q.totalKind).toBe('beforeDelivery');
    expect(q.totalCents).toBe(5133);
  });

  it('marks the 7.9 km pin as inside with $5.94, and 8.1 km as outside', () => {
    expect(
      run({ lines: cartA(), delivery: { status: 'inside', distanceMeters: 7900 } }).delivery,
    ).toMatchObject({ feeCents: 594, edge: null });
    expect(
      run({ lines: cartA(), delivery: { status: 'outside', distanceMeters: 8100 } }).delivery,
    ).toMatchObject({ feeCents: null, edge: null, distanceKm: 8.1 });
    expect(
      run({ lines: cartA(), delivery: { status: 'inside', distanceMeters: 7980 } }).delivery,
    ).toMatchObject({ feeCents: 599, edge: 'justUnder', distanceKm: 8 });
  });

  it('keeps free delivery attached before the address is known, worth nothing yet', () => {
    const q = run({ lines: cartA(), promo: withCode(FREEDELIVERY, customer(null)) });
    expect(q.promo).toMatchObject({ status: 'applied', freeDelivery: true, amountCents: 0 });
    expect(q.totalCents).toBe(5133);
    // Delivery will cost nothing wherever it goes, so the total needs no "before delivery".
    expect(q.totalKind).toBe('final');
  });

  it('still says "before delivery" when free delivery is attached but not applied yet', () => {
    const q = run({ lines: [line('kimchi', 1)], promo: withCode(FREEDELIVERY, customer(null)) });
    expect(q.promo).toMatchObject({ status: 'notApplied', freeDelivery: false });
    expect(q.totalKind).toBe('beforeDelivery');
  });

  it('has no final total outside the area, even with free delivery', () => {
    const q = run({
      lines: cartA(),
      promo: withCode(FREEDELIVERY, customer(null)),
      delivery: { status: 'outside', distanceMeters: 11_400 },
    });
    expect(q.totalKind).toBe('beforeDelivery');
  });
});

const promoContext = (lines: PricedLine[]) => ({ lines, deliveryFeeCents: 414, now: NOW });

const evaluate = (facts: CouponFacts | null, who = customer(DANA), lines = cartA()) =>
  evaluatePromo(withCode(facts, who), promoContext(lines));

describe('promo rules, in the order they are checked (B6)', () => {
  it('R1: an unknown code, a switched-off code, and someone else’s personal code look the same', () => {
    const credit = coupon('CREDIT-PRIYA-7Q2XK9', {
      type: 'FIXED',
      value: 800,
      ownerUserId: PRIYA,
      isStoreCredit: true,
      usageLimit: 1,
    });
    for (const outcome of [
      evaluate(null),
      evaluate(coupon('PAUSED20', { isActive: false, value: 20 })),
      evaluate(credit, customer(DANA)),
      evaluate(credit, customer(null)),
      // A store-credit code without an owner is never usable.
      evaluate(coupon('ORPHAN', { isStoreCredit: true })),
    ]) {
      expect(outcome).toMatchObject({
        status: 'refused',
        reason: { code: 'notFound', rule: 'R1' },
        description: null,
        kind: null,
        amountCents: 0,
      });
    }
    // Its owner gets it like a fixed amount (S4.16).
    expect(evaluate(credit, customer(PRIYA))).toMatchObject({
      status: 'applied',
      foodDiscountCents: 800,
    });
  });

  it('R2 to R4: not started, ended, used up', () => {
    const startsAt = new Date(NOW.getTime() + 7 * DAY);
    expect(evaluate(coupon('NEXTWEEK', { value: 15, startsAt })).reason).toEqual({
      code: 'notStarted',
      rule: 'R2',
      startsAt: startsAt.toISOString(),
    });
    const endedAt = new Date(NOW.getTime() - 30 * DAY);
    expect(
      evaluate(coupon('SUMMER25', { value: 25, startsAt: new Date(0), endsAt: endedAt })).reason,
    ).toEqual({ code: 'ended', rule: 'R3', endedAt: endedAt.toISOString() });
    // Ends exactly now: ended.
    expect(evaluate(coupon('NOW', { endsAt: NOW })).reason?.code).toBe('ended');
    expect(
      evaluate(coupon('FIRST100', { type: 'FIXED', value: 300, usageLimit: 100, usedCount: 100 }))
        .reason,
    ).toEqual({ code: 'usedUp', rule: 'R4' });
  });

  it('R5 to R7: one per customer needs sign-in, is used once, and may be on hold', () => {
    expect(evaluate(WELCOME10, customer(null)).reason).toEqual({
      code: 'signInRequired',
      rule: 'R5',
      perCustomer: 1,
    });
    expect(evaluate(WELCOME10, customer(PRIYA, { redeemed: 1 })).reason).toEqual({
      code: 'alreadyUsed',
      rule: 'R6',
      perCustomer: 1,
    });
    expect(evaluate(WELCOME10, customer(DANA, { heldBy: ['1042'] })).reason).toEqual({
      code: 'onHold',
      rule: 'R7',
      orderNumber: '1042',
    });
    // Used is checked before held.
    expect(
      evaluate(WELCOME10, customer(DANA, { redeemed: 1, heldBy: ['1042'] })).reason?.code,
    ).toBe('alreadyUsed');
  });

  it('R8 and R9: cuisine codes count only that cuisine, for the minimum and the discount (U3)', () => {
    expect(evaluate(KBBQ5, customer(DANA), [line('padThai')]).reason).toEqual({
      code: 'notForTheseDishes',
      rule: 'R8',
      cuisines: ['KOREAN'],
    });
    // A sold-out Korean dish doesn't count.
    expect(
      evaluate(KBBQ5, customer(DANA), [line('padThai'), line('kimchi', 1, 'soldOut')]).reason?.code,
    ).toBe('notForTheseDishes');
    // A percent cuisine code discounts only the matching dishes.
    const thai10 = coupon('THAI10', { cuisines: ['THAI'], value: 10 });
    expect(evaluate(thai10, customer(DANA), cartA()).foodDiscountCents).toBe(220); // 10 % of $21.99
  });

  it('never gives more than the eligible food, and never a negative total (B3)', () => {
    const big = coupon('BIG', { type: 'FIXED', value: 10_000 });
    const q = run({
      lines: [line('kimchi')],
      delivery: DANA_HOME,
      promo: withCode(big, customer(DANA)),
    });
    expect(q.promo?.foodDiscountCents).toBe(699);
    expect(q.tax.cents).toBe(0);
    expect(q.totalCents).toBe(414);

    const korean = coupon('K20', { type: 'FIXED', value: 2000, cuisines: ['KOREAN'] });
    expect(
      evaluate(korean, customer(DANA), [line('kimchi'), line('padThai')]).foodDiscountCents,
    ).toBe(699);
    const percent = coupon('P150', { value: 150 });
    expect(evaluate(percent, customer(DANA), [line('kimchi')]).foodDiscountCents).toBe(699);
  });

  it('carries a code that could not be checked without any discount (S4.13, S4.14)', () => {
    const q = run({
      lines: cartA(),
      delivery: DANA_HOME,
      promo: { kind: 'unchecked', code: 'KBBQ5', reason: 'rateLimited', retryAfterSeconds: 600 },
    });
    expect(q.promo).toEqual({
      code: 'KBBQ5',
      status: 'unchecked',
      reason: { code: 'rateLimited', rule: null },
      description: null,
      kind: null,
      foodDiscountCents: 0,
      deliveryDiscountCents: 0,
      amountCents: 0,
      freeDelivery: false,
      retryAfterSeconds: 600,
    });
    expect(q.totalCents).toBe(5547);
  });
});

// ------------------------------------------------------------------ checkout (F4)

describe('the tip (F4 U1, S4.2, B14)', () => {
  it('works a percentage out on the food before the promo, rounded half up once (T2 to T4, T8, T9)', () => {
    expect(tipFor({ kind: 'percent', percent: 10 }, 4797)).toBe(480); // 479.7¢ up
    expect(tipFor({ kind: 'percent', percent: 15 }, 4797)).toBe(720); // 719.55¢ up
    expect(tipFor({ kind: 'percent', percent: 20 }, 4797)).toBe(959); // 959.4¢ down
    expect(tipFor({ kind: 'percent', percent: 10 }, 3495)).toBe(350); // 349.5¢ up
    expect(tipFor({ kind: 'percent', percent: 15 }, 6990)).toBe(1049); // 1,048.5¢ up
  });

  it('takes a typed amount as it is, and none as zero (T5)', () => {
    expect(tipFor({ kind: 'amount', cents: 500 }, 4797)).toBe(500);
    expect(tipFor({ kind: 'amount', cents: 0 }, 4797)).toBe(0);
    expect(tipFor({ kind: 'none' }, 4797)).toBe(0);
  });

  it('offers each percentage with its amount for this cart (S4.1)', () => {
    expect(tipOptions(4797)).toEqual([
      { percent: 10, cents: 480 },
      { percent: 15, cents: 720 },
      { percent: 20, cents: 959 },
    ]);
  });

  it('caps a percentage at the $100.00 tip limit, as the orders table does (security S4)', () => {
    expect(tipFor({ kind: 'percent', percent: 20 }, 60_000)).toBe(10_000); // $120.00 capped
    expect(tipFor({ kind: 'percent', percent: 10 }, 100_000)).toBe(10_000);
    expect(tipFor({ kind: 'percent', percent: 20 }, 50_000)).toBe(10_000); // exactly the limit
    expect(tipOptions(60_000)).toEqual([
      { percent: 10, cents: 6000 },
      { percent: 15, cents: 9000 },
      { percent: 20, cents: 10_000 },
    ]);
  });

  it('refuses a tip the browser could only have made up', () => {
    expect(() => tipFor({ kind: 'percent', percent: 12 as 10 }, 4797)).toThrow(RangeError);
    expect(() => tipFor({ kind: 'amount', cents: -1 }, 4797)).toThrow(RangeError);
    expect(() => tipFor({ kind: 'amount', cents: 10_001 }, 4797)).toThrow(RangeError);
    expect(() => tipFor({ kind: 'amount', cents: 5.5 }, 4797)).toThrow(RangeError);
  });
});

const total = (lines: PricedLine[], tip: TipChoice, extra: Partial<QuoteCalcInput> = {}) => {
  const subtotal = lines.reduce(
    (sum, l) => sum + (l.status === 'ok' ? (l.unitPriceCents ?? 0) * l.quantity : 0),
    0,
  );
  return quote({
    lines,
    promo: null,
    delivery: PRIYA_WORK,
    settings: SETTINGS,
    tipCents: tipFor(tip, subtotal),
    now: NOW,
    ...extra,
  });
};
const kbbq5 = coupon('KBBQ5', {
  type: 'FIXED',
  value: 500,
  minSubtotalCents: 2500,
  cuisines: ['KOREAN'],
});
const freeDelivery = coupon('FREEDELIVERY', { type: 'FREE_DELIVERY', value: 0 });
const lookup = (c: CouponFacts) => ({
  kind: 'lookup' as const,
  code: c.code,
  coupon: c,
  customer: customer(PRIYA),
});

const TIPPED: [string, TipChoice, number, number][] = [
  ['T1', { kind: 'none' }, 0, 5397],
  ['T2', { kind: 'percent', percent: 10 }, 480, 5877],
  ['T3', { kind: 'percent', percent: 15 }, 720, 6117],
  ['T4', { kind: 'percent', percent: 20 }, 959, 6356],
  ['T5', { kind: 'amount', cents: 500 }, 500, 5897],
];

describe('worked checkout totals T1 to T11 (Priya at 1.3 km unless named)', () => {
  it.each(TIPPED)('%s: cart A with that tip', (_name, tip, tipCents, totalCents) => {
    const q = total(cartA(), tip);
    expect(q).toMatchObject({ subtotalCents: 4797, tax: { cents: 336 }, tipCents, totalCents });
    expect(q.delivery.feeCents).toBe(264);
  });

  it('T6: KBBQ5 never makes the 15 % tip smaller: $55.82', () => {
    const q = total(cartA(), { kind: 'percent', percent: 15 }, { promo: lookup(kbbq5) });
    expect(q).toMatchObject({ tax: { cents: 301 }, tipCents: 720, totalCents: 5582 });
  });

  it('T7: FREEDELIVERY with 20 %: delivery free (was $2.64), $60.92', () => {
    const q = total(cartA(), { kind: 'percent', percent: 20 }, { promo: lookup(freeDelivery) });
    expect(q.promo).toMatchObject({ deliveryDiscountCents: 264, freeDelivery: true });
    expect(q).toMatchObject({ tax: { cents: 336 }, tipCents: 959, totalCents: 6092 });
  });

  it('T8 and T9: Kimchi carts with 10 % and 15 %', () => {
    expect(total([line('kimchi', 5)], { kind: 'percent', percent: 10 })).toMatchObject({
      subtotalCents: 3495,
      tax: { cents: 245 },
      tipCents: 350,
      totalCents: 4354,
    });
    const t9 = total([line('kimchi', 10)], { kind: 'percent', percent: 15 });
    expect(t9).toMatchObject({ tax: { cents: 489 }, tipCents: 1049, totalCents: 8792 });
    expect(cashAllowed(t9.totalCents)).toBe(true);
  });

  it('T10: 10 × Samgyeopsal is $270.03, over the cash limit (S5.2)', () => {
    const q = total([line('samgyeopsal', 10)], { kind: 'none' });
    expect(q).toMatchObject({ tax: { cents: 1749 }, totalCents: 27003 });
    expect(cashAllowed(q.totalCents)).toBe(false);
    expect(cashAllowed(10_000)).toBe(true);
    expect(cashAllowed(10_001)).toBe(false);
  });

  it('T11: Maya at Harvard Square, 6.6 km: delivery $5.29, $56.62', () => {
    const q = total(
      cartA(),
      { kind: 'none' },
      {
        delivery: { status: 'inside', distanceMeters: 6600 },
      },
    );
    expect(q).toMatchObject({ delivery: { feeCents: 529 }, totalCents: 5662 });
  });
});

describe('the arrival window (S3.1, B15)', () => {
  it('is the longest prep + 10 + 3 per km rounded up, started on the next 5 minutes, 10 wide', () => {
    // Pad Thai at 20 minutes to Priya (1.3 km): 20 + 10 + 4 = 34, so 35–45.
    expect(arrivalWindow([20, 12], 13)).toEqual({ fromMinutes: 35, toMinutes: 45 });
  });

  it('keeps a start that already falls on 5 minutes', () => {
    // 15 + 10 + ⌈3 × 3.3⌉ = 15 + 10 + 10 = 35.
    expect(arrivalWindow([15], 33)).toEqual({ fromMinutes: 35, toMinutes: 45 });
  });

  it('rounds the kilometre part up, never down', () => {
    // 3 × 4.3 = 12.9 → 13; 24 + 10 + 13 = 47 → 50–60.
    expect(arrivalWindow([24], 43)).toEqual({ fromMinutes: 50, toMinutes: 60 });
    // 3 × 0.1 = 0.3 → 1.
    expect(arrivalWindow([12], 1)).toEqual({ fromMinutes: 25, toMinutes: 35 });
    expect(arrivalWindow([12], 0)).toEqual({ fromMinutes: 25, toMinutes: 35 });
  });

  it('has no window without dishes', () => {
    expect(arrivalWindow([], 13)).toBeNull();
  });
});
