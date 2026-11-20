import type { Cuisine } from '@/server/db/enums';
import type { PromoKind, PromoReason } from './schema';

/*
 * quote(): every figure in the cart and at checkout, worked out in one pure function.
 *
 *   subtotal → promo → delivery fee by distance → tax → tip → total
 *
 * Money is integer cents throughout. Each figure is rounded half up exactly once, on the whole
 * order, never line by line (B3). The caller supplies database prices and settings; nothing
 * here trusts the browser. No server imports, so checkout (F4), the seed and tests share it.
 */

export interface PricingSettings {
  taxRateBps: number;
  baseDeliveryFeeCents: number;
  perKmFeeCents: number;
  deliveryRadiusKm: number;
}

export interface PricedLine {
  key: string;
  status: 'ok' | 'soldOut' | 'removed';
  /** Null when the dish is gone. */
  cuisine: Cuisine | null;
  unitPriceCents: number | null;
  quantity: number;
}

/** Inside or outside comes from the database (ST_DWithin on the exact distance). */
export type DeliveryPoint =
  { status: 'unknown' } | { status: 'inside' | 'outside'; distanceMeters: number };

/** A coupon as stored. */
export interface CouponFacts {
  code: string;
  description: string | null;
  type: 'PERCENT' | 'FIXED' | 'FREE_DELIVERY';
  /** PERCENT: whole percent. FIXED: cents. FREE_DELIVERY: unused. */
  value: number;
  minSubtotalCents: number;
  maxDiscountCents: number | null;
  usageLimit: number | null;
  usedCount: number;
  perUserLimit: number | null;
  /** Empty: every cuisine. */
  cuisines: Cuisine[];
  ownerUserId: string | null;
  isStoreCredit: boolean;
  isActive: boolean;
  startsAt: Date;
  endsAt: Date | null;
}

/** What the caller's own history says about one code. */
export interface CustomerFacts {
  /** Null for a guest. */
  userId: string | null;
  /** Completed uses (REDEEMED). */
  redeemed: number;
  /** Order numbers of unpaid orders holding the code (RESERVED), newest first. */
  heldBy: string[];
}

export type PromoRequest =
  /** The code was looked up; `coupon` is null when nothing visible to the caller has it. */
  | { kind: 'lookup'; code: string; coupon: CouponFacts | null; customer: CustomerFacts }
  /** The code could not be checked (B5 limit, or the limiter is down). */
  | {
      kind: 'unchecked';
      code: string;
      reason: 'rateLimited' | 'unavailable';
      retryAfterSeconds: number | null;
    };

export interface PromoOutcome {
  code: string;
  status: 'applied' | 'notApplied' | 'refused' | 'unchecked';
  reason: PromoReason | null;
  description: string | null;
  kind: PromoKind | null;
  foodDiscountCents: number;
  deliveryDiscountCents: number;
  amountCents: number;
  freeDelivery: boolean;
  retryAfterSeconds: number | null;
}

export interface QuoteCalcInput {
  lines: PricedLine[];
  promo: PromoRequest | null;
  delivery: DeliveryPoint;
  settings: PricingSettings;
  /** Chosen at checkout (F4); 0 in the cart. */
  tipCents?: number;
  now: Date;
}

export interface QuoteFigures {
  lines: { key: string; lineTotalCents: number; inSubtotal: boolean }[];
  itemCount: number;
  subtotalCents: number;
  promo: PromoOutcome | null;
  delivery: DeliveryFigures;
  tax: { rateBps: number; cents: number };
  tipCents: number;
  totalCents: number;
  totalKind: 'final' | 'beforeDelivery';
}

// ------------------------------------------------------------------ arithmetic

function assertCents(value: number, what: string) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${what} must be a whole, non-negative number`);
  }
}

/** numerator / denominator, rounded half up, for whole non-negative numbers. */
export function roundHalfUp(numerator: number, denominator: number): number {
  assertCents(numerator, 'numerator');
  if (!Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new RangeError('denominator must be a whole, positive number');
  }
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

/** Distance in tenths of a km, as the customer sees it (4.3 km is 43). */
export const distanceTenths = (meters: number) => Math.round(Math.max(0, meters) / 100);

/** base + per-km × distance, the distance already rounded to 0.1 km (B3). */
export function deliveryFee(tenths: number, settings: PricingSettings): number {
  return settings.baseDeliveryFeeCents + roundHalfUp(settings.perKmFeeCents * tenths, 10);
}

/** The fee from the kitchen door to the edge of the area: "$1.99 to $5.99". */
export function deliveryFeeRange(settings: PricingSettings) {
  return {
    minCents: settings.baseDeliveryFeeCents,
    maxCents: deliveryFee(Math.round(settings.deliveryRadiusKm * 10), settings),
  };
}

export interface DeliveryFigures {
  status: 'inside' | 'outside' | 'unknown';
  /** Rounded to 0.1 km; null when unknown. */
  distanceKm: number | null;
  edge: 'justUnder' | 'justOver' | null;
  /** Only inside the area. */
  feeCents: number | null;
  feeRange: { minCents: number; maxCents: number };
}

/**
 * The delivery row: the fee from the distance rounded to 0.1 km. Inside or outside was decided
 * on the exact distance; near the edge the rounded figure gets a flag so nobody reads "8.0 km"
 * next to "we deliver within 8 km" as a refusal (B3).
 */
export function deliveryFigures(point: DeliveryPoint, settings: PricingSettings): DeliveryFigures {
  const feeRange = deliveryFeeRange(settings);
  if (point.status === 'unknown') {
    return { status: 'unknown', distanceKm: null, edge: null, feeCents: null, feeRange };
  }
  const tenths = distanceTenths(point.distanceMeters);
  const radiusTenths = Math.round(settings.deliveryRadiusKm * 10);
  if (point.status === 'inside') {
    return {
      status: 'inside',
      distanceKm: tenths / 10,
      edge: tenths >= radiusTenths ? 'justUnder' : null,
      feeCents: deliveryFee(tenths, settings),
      feeRange,
    };
  }
  return {
    status: 'outside',
    distanceKm: tenths / 10,
    edge: tenths <= radiusTenths ? 'justOver' : null,
    feeCents: null,
    feeRange,
  };
}

const lineTotal = (line: PricedLine) =>
  line.status === 'removed' || line.unitPriceCents === null
    ? 0
    : line.unitPriceCents * line.quantity;

// ------------------------------------------------------------------ promo

const KIND: Record<CouponFacts['type'], PromoKind> = {
  PERCENT: 'percent',
  FIXED: 'fixed',
  FREE_DELIVERY: 'freeDelivery',
};

const nothing = { foodDiscountCents: 0, deliveryDiscountCents: 0, amountCents: 0 };

function refused(code: string, reason: PromoReason, coupon: CouponFacts | null): PromoOutcome {
  // R1 reveals nothing about a code: no description, no kind.
  const visible = reason.code !== 'notFound' && coupon !== null;
  return {
    code,
    status: reason.code === 'minimumNotReached' ? 'notApplied' : 'refused',
    reason,
    description: visible ? coupon.description : null,
    kind: visible ? KIND[coupon.type] : null,
    ...nothing,
    freeDelivery: false,
    retryAfterSeconds: null,
  };
}

/**
 * Public codes are for everyone; a personal or store-credit code only for its signed-in owner.
 * A code that isn't visible answers R1, exactly like one that doesn't exist (S4.16).
 */
export function isCodeVisibleTo(coupon: CouponFacts, userId: string | null) {
  if (!coupon.isActive) return false;
  if (coupon.ownerUserId === null) return !coupon.isStoreCredit;
  return userId !== null && coupon.ownerUserId === userId;
}

export interface PromoContext {
  lines: PricedLine[];
  /** The real delivery fee when the address is known and inside the area. */
  deliveryFeeCents: number | null;
  now: Date;
}

/**
 * Whether a code applies to this cart and what it saves. Reasons are checked in the order of
 * B6: permanent ones first, fixable ones last, so the message says what to do.
 */
export function evaluatePromo(request: PromoRequest, context: PromoContext): PromoOutcome {
  const { code } = request;
  if (request.kind === 'unchecked') {
    return {
      code,
      status: 'unchecked',
      reason: { code: request.reason, rule: null },
      description: null,
      kind: null,
      ...nothing,
      freeDelivery: false,
      retryAfterSeconds: request.retryAfterSeconds,
    };
  }

  const { coupon, customer } = request;
  if (!coupon || !isCodeVisibleTo(coupon, customer.userId)) {
    return refused(code, { code: 'notFound', rule: 'R1' }, null);
  }
  const now = context.now.getTime();
  if (coupon.startsAt.getTime() > now) {
    return refused(
      code,
      { code: 'notStarted', rule: 'R2', startsAt: coupon.startsAt.toISOString() },
      coupon,
    );
  }
  if (coupon.endsAt !== null && coupon.endsAt.getTime() <= now) {
    return refused(
      code,
      { code: 'ended', rule: 'R3', endedAt: coupon.endsAt.toISOString() },
      coupon,
    );
  }
  if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) {
    return refused(code, { code: 'usedUp', rule: 'R4' }, coupon);
  }
  if (coupon.perUserLimit !== null) {
    if (customer.userId === null) {
      return refused(
        code,
        { code: 'signInRequired', rule: 'R5', perCustomer: coupon.perUserLimit },
        coupon,
      );
    }
    if (customer.redeemed >= coupon.perUserLimit) {
      return refused(
        code,
        { code: 'alreadyUsed', rule: 'R6', perCustomer: coupon.perUserLimit },
        coupon,
      );
    }
    const [heldBy] = customer.heldBy;
    if (heldBy !== undefined && customer.redeemed + customer.heldBy.length >= coupon.perUserLimit) {
      return refused(code, { code: 'onHold', rule: 'R7', orderNumber: heldBy }, coupon);
    }
  }

  // Only priced lines count; a cuisine code counts only its own cuisine (U3).
  const counted = context.lines.filter(
    (line) =>
      line.status === 'ok' &&
      (coupon.cuisines.length === 0 ||
        (line.cuisine !== null && coupon.cuisines.includes(line.cuisine))),
  );
  const eligibleCents = counted.reduce((sum, line) => sum + lineTotal(line), 0);
  if (coupon.cuisines.length > 0 && counted.length === 0) {
    return refused(
      code,
      { code: 'notForTheseDishes', rule: 'R8', cuisines: coupon.cuisines },
      coupon,
    );
  }
  if (eligibleCents < coupon.minSubtotalCents) {
    return refused(
      code,
      {
        code: 'minimumNotReached',
        rule: 'R9',
        minSubtotalCents: coupon.minSubtotalCents,
        eligibleCents,
        shortfallCents: coupon.minSubtotalCents - eligibleCents,
        cuisines: coupon.cuisines,
      },
      coupon,
    );
  }

  let foodDiscountCents = 0;
  let deliveryDiscountCents = 0;
  if (coupon.type === 'FREE_DELIVERY') {
    // A discount equal to the fee; the fee itself stays as it is (B4).
    deliveryDiscountCents = context.deliveryFeeCents ?? 0;
  } else {
    const raw =
      coupon.type === 'PERCENT'
        ? roundHalfUp(eligibleCents * Math.max(0, coupon.value), 100)
        : Math.max(0, coupon.value);
    const capped = coupon.maxDiscountCents === null ? raw : Math.min(raw, coupon.maxDiscountCents);
    foodDiscountCents = Math.min(capped, eligibleCents);
  }

  return {
    code,
    status: 'applied',
    reason: null,
    description: coupon.description,
    kind: KIND[coupon.type],
    foodDiscountCents,
    deliveryDiscountCents,
    amountCents: foodDiscountCents + deliveryDiscountCents,
    freeDelivery: coupon.type === 'FREE_DELIVERY',
    retryAfterSeconds: null,
  };
}

// ------------------------------------------------------------------ the quote

export function quote(input: QuoteCalcInput): QuoteFigures {
  const { settings } = input;
  const tipCents = input.tipCents ?? 0;
  assertCents(tipCents, 'tip');

  const lines = input.lines.map((line) => {
    if (line.status !== 'removed') {
      assertCents(line.unitPriceCents ?? -1, 'unit price');
      assertCents(line.quantity, 'quantity');
    }
    return { key: line.key, lineTotalCents: lineTotal(line), inSubtotal: line.status === 'ok' };
  });
  const subtotalCents = lines.reduce((sum, l) => sum + (l.inSubtotal ? l.lineTotalCents : 0), 0);
  const itemCount = input.lines.reduce((sum, l) => sum + (l.status === 'ok' ? l.quantity : 0), 0);

  const delivery = deliveryFigures(input.delivery, settings);
  const { feeCents } = delivery;

  const promo = input.promo
    ? evaluatePromo(input.promo, { lines: input.lines, deliveryFeeCents: feeCents, now: input.now })
    : null;
  const foodDiscountCents = promo?.foodDiscountCents ?? 0;
  const deliveryDiscountCents = promo?.deliveryDiscountCents ?? 0;

  // Tax: the food after the food promo only. Delivery and tip are never taxed (U1).
  const taxCents = roundHalfUp((subtotalCents - foodDiscountCents) * settings.taxRateBps, 10_000);
  const deliveryChargeCents = feeCents === null ? 0 : feeCents - deliveryDiscountCents;

  return {
    lines,
    itemCount,
    subtotalCents,
    promo,
    delivery,
    tax: { rateBps: settings.taxRateBps, cents: taxCents },
    tipCents,
    totalCents: subtotalCents - foodDiscountCents + deliveryChargeCents + taxCents + tipCents,
    totalKind: delivery.status === 'inside' ? 'final' : 'beforeDelivery',
  };
}
