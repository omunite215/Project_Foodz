import 'server-only';
import { displayPhone } from '@/lib/phone';
import { type Actor, runAs } from '@/server/db/context';
import { AppError } from '@/server/errors';
import { logger } from '@/server/logger';
import { locatePoint, locateSavedAddress } from '@/server/modules/addresses/service';
import { getStoreStatus } from '@/server/modules/menu/service';
import { blockedFor, type LimitCheck, takeAttempts } from '@/server/security/rate-limit';
import { codeHash, rememberCode, wasConfirmed } from './code-memory';
import {
  arrivalWindow,
  cashAllowed,
  type CouponFacts,
  type CustomerFacts,
  type DeliveryPoint,
  distanceTenths,
  evaluatePromo,
  isCodeVisibleTo,
  type PricedLine,
  type PricingSettings,
  type PromoOutcome,
  type PromoRequest,
  quote,
  tipFor,
  tipOptions,
} from './pricing';
import { promoMessage } from './promo-text';
import {
  findCouponByCode,
  findDishes,
  findOfferCampaigns,
  findPricingSettings,
  findRedemptions,
} from './repo';
import {
  CASH_LIMIT_CENTS,
  type CartTooBigDetails,
  type CheckoutBlocker,
  cleanFlavor,
  cleanNote,
  CLOSING_SOON_MINUTES,
  isPossibleCode,
  MAX_CART_ITEMS,
  MAX_CART_LINES,
  type ParsedQuoteInput,
  type Quote,
  type QuoteArrival,
  type QuoteDelivery,
  type QuoteLine,
  type QuoteOffer,
  type QuotePromo,
  quoteInput,
} from './schema';

/*
 * The cart's price breakdown (F3 S2 to S4). Everything comes from the database: prices,
 * availability, the dish's own flavors, codes, fees and the tax rate. The browser's cart is only
 * a list of choices. quote() does the arithmetic; this file gathers its facts.
 *
 * Code guessing (B5): a code that doesn't exist, or isn't the caller's, costs a point per
 * account and per network; a real code costs nothing. While either is blocked every code is
 * refused alike, except codes the caller had confirmed before (the one in the cart).
 */

const SITE_IMAGE = /^\/(?![/\\])\S*$|^https:\/\/\S+$/;

type CouponRow = NonNullable<Awaited<ReturnType<typeof findCouponByCode>>>;
type DishRow = Awaited<ReturnType<typeof findDishes>>[number];
type RedemptionRow = Awaited<ReturnType<typeof findRedemptions>>[number];

const toFacts = (row: CouponRow): CouponFacts => ({
  code: row.code,
  description: row.description,
  type: row.type,
  value: row.value,
  minSubtotalCents: row.minSubtotalCents,
  maxDiscountCents: row.maxDiscountCents,
  usageLimit: row.usageLimit,
  usedCount: row.usedCount,
  perUserLimit: row.perUserLimit,
  cuisines: row.cuisines,
  ownerUserId: row.ownerUserId,
  isStoreCredit: row.isStoreCredit,
  isActive: row.isActive,
  startsAt: row.startsAt,
  endsAt: row.endsAt,
});

const userIdOf = (actor: Actor) => (actor.kind === 'user' ? actor.userId : null);

function customerFacts(
  userId: string | null,
  couponId: string,
  redemptions: RedemptionRow[],
): CustomerFacts {
  const own = redemptions.filter((row) => row.couponId === couponId);
  return {
    userId,
    redeemed: own.filter((row) => row.status === 'REDEEMED').length,
    heldBy: own
      .filter((row) => row.status === 'RESERVED' && row.order.status === 'PENDING_PAYMENT')
      .map((row) => row.order.number),
  };
}

/** A running campaign's code is offered while it can be used by anyone (never a personal one). */
function isOfferLive(coupon: CouponRow, at: Date) {
  return (
    coupon.isActive &&
    coupon.ownerUserId === null &&
    !coupon.isStoreCredit &&
    coupon.startsAt <= at &&
    (coupon.endsAt === null || coupon.endsAt > at) &&
    (coupon.usageLimit === null || coupon.usedCount < coupon.usageLimit)
  );
}

// ------------------------------------------------------------------ lines

interface LineView {
  priced: PricedLine;
  view: Omit<QuoteLine, 'lineTotalCents' | 'inSubtotal'>;
}

function viewLine(line: ParsedQuoteInput['lines'][number], dish: DishRow | undefined): LineView {
  const wanted = [...new Set(line.flavors.map(cleanFlavor).filter(Boolean))];
  const note = cleanNote(line.note);
  if (!dish) {
    return {
      priced: {
        key: line.key,
        status: 'removed',
        cuisine: null,
        unitPriceCents: null,
        quantity: line.quantity,
      },
      view: {
        key: line.key,
        menuItemId: line.menuItemId,
        status: 'removed',
        dish: null,
        unitPriceCents: null,
        quantity: line.quantity,
        flavors: wanted,
        droppedFlavors: [],
        flavorsOffered: [],
        note,
      },
    };
  }
  const offered = new Set(dish.flavors);
  const status = dish.isAvailable ? 'ok' : 'soldOut';
  return {
    priced: {
      key: line.key,
      status,
      cuisine: dish.cuisine,
      unitPriceCents: dish.priceCents,
      quantity: line.quantity,
    },
    view: {
      key: line.key,
      menuItemId: line.menuItemId,
      status,
      dish: {
        title: dish.title,
        slug: dish.slug,
        image: dish.images.find((image) => SITE_IMAGE.test(image)) ?? null,
        cuisine: dish.cuisine,
      },
      unitPriceCents: dish.priceCents,
      quantity: line.quantity,
      flavors: wanted.filter((flavor) => offered.has(flavor)),
      droppedFlavors: wanted.filter((flavor) => !offered.has(flavor)),
      flavorsOffered: dish.flavors,
      note,
    },
  };
}

// ------------------------------------------------------------------ delivery

interface ResolvedDelivery {
  point: DeliveryPoint;
  kind: QuoteDelivery['kind'];
  address: QuoteDelivery['address'];
  missingAddress: boolean;
}

/** No address known; `missingAddress` when a saved one was asked for and isn't the caller's. */
const noDelivery = (missingAddress = false): ResolvedDelivery => ({
  point: { status: 'unknown' },
  kind: 'none',
  address: null,
  missingAddress,
});

async function resolveDelivery(
  actor: Actor,
  target: ParsedQuoteInput['delivery'],
): Promise<ResolvedDelivery> {
  if (target.kind === 'none') return noDelivery();
  if (target.kind === 'point') {
    const { distanceMeters, inside } = await locatePoint(target.lat, target.lng);
    return {
      point: { status: inside ? 'inside' : 'outside', distanceMeters },
      kind: 'point',
      address: null,
      missingAddress: false,
    };
  }
  const asked = target.kind === 'saved';
  if (actor.kind !== 'user') return noDelivery(asked);
  const saved = await locateSavedAddress(actor, asked ? { id: target.addressId } : 'default');
  if (!saved) return noDelivery(asked);
  return {
    point: { status: saved.inside ? 'inside' : 'outside', distanceMeters: saved.distanceMeters },
    kind: 'saved',
    address: { id: saved.id, label: saved.label, line1: saved.line1 },
    missingAddress: false,
  };
}

// ------------------------------------------------------------------ the code

interface CodeCheck {
  request: PromoRequest;
  /** With an unchecked code: the limiter's sentence, with the real wait. */
  limitMessage?: string;
}

/**
 * Decides whether the code may be checked, and spends a guessing point only on codes that
 * don't exist for this caller (B5).
 */
async function checkCode(
  actor: Actor,
  ip: string,
  code: string,
  coupon: CouponFacts | null,
  customer: CustomerFacts,
): Promise<CodeCheck> {
  const userId = userIdOf(actor);
  const checks: LimitCheck[] = [
    ...(userId ? [{ policy: 'coupon.miss.user' as const, key: `user:${userId}` }] : []),
    { policy: 'coupon.miss.ip', key: `ip:${ip}` },
  ];
  const caller = userId ? `user:${userId}` : `ip:${ip}`;
  const who = userId ? { userId } : { ip };

  // A code that can't exist tells a guesser nothing, so it costs no guessing point.
  if (!isPossibleCode(code)) return { request: { kind: 'lookup', code, coupon: null, customer } };

  try {
    if (!coupon || !isCodeVisibleTo(coupon, userId)) {
      await takeAttempts(checks);
      logger.info({ ...who, codeHash: codeHash(code) }, 'promo code not found');
      return { request: { kind: 'lookup', code, coupon: null, customer } };
    }
    const blocked = await blockedFor(checks);
    if (blocked && !(await wasConfirmed(caller, code))) throw blocked;
    await rememberCode(caller, code);
    return { request: { kind: 'lookup', code, coupon, customer } };
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    if (error.code === 'RATE_LIMITED') {
      logger.warn({ ...who, codeHash: codeHash(code) }, 'promo code checks blocked');
      return {
        request: {
          kind: 'unchecked',
          code,
          reason: 'rateLimited',
          retryAfterSeconds: error.retryAfterSeconds ?? null,
        },
        limitMessage: error.message,
      };
    }
    if (error.code === 'UNAVAILABLE') {
      return {
        request: { kind: 'unchecked', code, reason: 'unavailable', retryAfterSeconds: null },
      };
    }
    throw error;
  }
}

function promoView(outcome: PromoOutcome, timeZone: string, limitMessage?: string): QuotePromo {
  return {
    code: outcome.code,
    status: outcome.status,
    reason: outcome.reason,
    message: outcome.reason
      ? promoMessage(outcome.code, outcome.reason, { timeZone, rateLimitMessage: limitMessage })
      : null,
    description: outcome.description,
    kind: outcome.kind,
    foodDiscountCents: outcome.foodDiscountCents,
    deliveryDiscountCents: outcome.deliveryDiscountCents,
    amountCents: outcome.amountCents,
    freeDelivery: outcome.freeDelivery,
    retryAfterSeconds: outcome.retryAfterSeconds,
  };
}

// ------------------------------------------------------------------ the quote

function cartTooBig(contactPhone: string): AppError {
  const phone = displayPhone(contactPhone.replace(/\s+/g, '')).display;
  const details: CartTooBigDetails = { maxItems: MAX_CART_ITEMS, maxLines: MAX_CART_LINES, phone };
  return new AppError(
    'CART_TOO_BIG',
    `Your cart is full (${MAX_CART_ITEMS} items). For a bigger order, call us on ${phone}.`,
    422,
    { details: { ...details } },
  );
}

export interface QuoteCaller {
  /** The client address, for the per-network guessing limit. */
  ip: string;
}

/** What checkout needs besides the quote itself to create the order (F4). */
export interface CheckoutPricing {
  quote: Quote;
  /** The coupon behind an applied code, as the caller could see it. Null otherwise. */
  coupon: {
    id: string;
    code: string;
    usageLimit: number | null;
    perUserLimit: number | null;
    ownerUserId: string | null;
  } | null;
  /** Each priced dish's current title, by menu item id. */
  titles: Map<string, string>;
  /** The exact distance to the saved address, in metres (null when unknown). */
  distanceMeters: number | null;
  /** The store's hours and status at `now`. */
  store: Awaited<ReturnType<typeof getStoreStatus>>;
}

/**
 * The whole price breakdown for a cart, as the caller (S2.2). Anyone may ask; a saved address
 * is used only when it is the caller's own.
 */
export async function quoteCart(
  actor: Actor,
  input: unknown,
  caller: QuoteCaller,
  now = new Date(),
): Promise<Quote> {
  return (await priceCart(actor, input, caller, now)).quote;
}

/**
 * The same breakdown for placing an order (F4 S8.1): priced again from the database, with the
 * facts the order keeps.
 */
export async function priceCartForCheckout(
  actor: Actor,
  input: unknown,
  caller: QuoteCaller,
  now = new Date(),
): Promise<CheckoutPricing> {
  return priceCart(actor, input, caller, now);
}

async function priceCart(
  actor: Actor,
  input: unknown,
  caller: QuoteCaller,
  now: Date,
): Promise<CheckoutPricing> {
  const parsed = quoteInput.parse(input);
  const userId = userIdOf(actor);
  const itemCount = parsed.lines.reduce((sum, line) => sum + line.quantity, 0);

  const facts = await runAs(actor, async (ctx) => {
    const settings = await findPricingSettings(ctx);
    if (!settings) throw new Error('Store settings are missing. Run the seed.');
    if (parsed.lines.length > MAX_CART_LINES || itemCount > MAX_CART_ITEMS) {
      throw cartTooBig(settings.contactPhone);
    }
    const ids = [...new Set(parsed.lines.map((line) => line.menuItemId))];
    const dishes = ids.length > 0 ? await findDishes(ctx, ids) : [];
    const coupon = parsed.code ? await findCouponByCode(ctx, parsed.code) : null;
    const campaigns = await findOfferCampaigns(ctx, now);
    const couponIds = [
      ...new Set([
        ...(coupon ? [coupon.id] : []),
        ...campaigns.flatMap((campaign) => (campaign.coupon ? [campaign.coupon.id] : [])),
      ]),
    ];
    const redemptions =
      userId && couponIds.length > 0 ? await findRedemptions(ctx, userId, couponIds) : [];
    return { settings, dishes, coupon, campaigns, redemptions };
  });

  const pricing: PricingSettings = {
    taxRateBps: facts.settings.taxRateBps,
    baseDeliveryFeeCents: facts.settings.baseDeliveryFeeCents,
    perKmFeeCents: facts.settings.perKmFeeCents,
    deliveryRadiusKm: facts.settings.deliveryRadiusKm,
  };
  const [delivery, store] = await Promise.all([
    resolveDelivery(actor, parsed.delivery),
    getStoreStatus(now),
  ]);

  const dishes = new Map(facts.dishes.map((dish) => [dish.id, dish]));
  const lines = parsed.lines.map((line) => viewLine(line, dishes.get(line.menuItemId)));

  let code: CodeCheck | null = null;
  if (parsed.code) {
    const coupon = facts.coupon ? toFacts(facts.coupon) : null;
    const customer = facts.coupon
      ? customerFacts(userId, facts.coupon.id, facts.redemptions)
      : { userId, redeemed: 0, heldBy: [] };
    code = await checkCode(actor, caller.ip, parsed.code, coupon, customer);
  }

  // The tip is worked out on the food before any promo (F4 U1).
  const foodSubtotalCents = lines.reduce(
    (sum, { priced }) =>
      sum + (priced.status === 'ok' ? (priced.unitPriceCents ?? 0) * priced.quantity : 0),
    0,
  );
  const figures = quote({
    lines: lines.map((line) => line.priced),
    promo: code?.request ?? null,
    delivery: delivery.point,
    settings: pricing,
    tipCents: tipFor(parsed.tip, foodSubtotalCents),
    now,
  });

  // Offers: each running campaign's public code, tried on this cart (S4.10, B18).
  const offers = new Map<string, QuoteOffer>();
  for (const campaign of facts.campaigns) {
    const row = campaign.coupon;
    if (!row || !isOfferLive(row, now)) continue;
    const existing = offers.get(row.code);
    const campaignEnd = campaign.endsAt.getTime();
    const endsAt = new Date(
      Math.min(
        Math.max(campaignEnd, existing ? Date.parse(existing.endsAt) : 0),
        row.endsAt?.getTime() ?? Number.POSITIVE_INFINITY,
      ),
    ).toISOString();
    if (existing) {
      existing.endsAt = endsAt;
      continue;
    }
    const outcome = evaluatePromo(
      {
        kind: 'lookup',
        code: row.code,
        coupon: toFacts(row),
        customer: customerFacts(userId, row.id, facts.redemptions),
      },
      { lines: lines.map((line) => line.priced), deliveryFeeCents: figures.delivery.feeCents, now },
    );
    if (outcome.status === 'unchecked') continue;
    offers.set(row.code, {
      code: row.code,
      description: row.description,
      kind: outcome.kind ?? 'fixed',
      campaignTitle: campaign.title,
      endsAt,
      status: outcome.status,
      reason: outcome.reason,
      message: outcome.reason
        ? promoMessage(row.code, outcome.reason, { timeZone: store.timeZone })
        : null,
      amountCents: outcome.amountCents,
    });
  }

  const quoteLines: QuoteLine[] = lines.map(({ view }, index) =>
    Object.assign(view, {
      lineTotalCents: figures.lines[index]!.lineTotalCents,
      inSubtotal: figures.lines[index]!.inSubtotal,
    }),
  );

  const checkoutBlockers: CheckoutBlocker[] = [];
  if (figures.itemCount === 0) checkoutBlockers.push('empty');
  if (quoteLines.some((line) => line.status === 'soldOut')) checkoutBlockers.push('soldOut');
  if (!store.isOpen) checkoutBlockers.push('closed');
  if (figures.delivery.status === 'outside') checkoutBlockers.push('outside');

  const prep = parsed.lines.flatMap((line, index) => {
    const dish = dishes.get(line.menuItemId);
    return dish && figures.lines[index]?.inSubtotal ? [dish.prepMinutes] : [];
  });
  let arrival: QuoteArrival = { status: 'noAddress' };
  if (!store.isOpen) arrival = { status: 'closed' };
  else if (delivery.point.status === 'inside') {
    const window = arrivalWindow(prep, distanceTenths(delivery.point.distanceMeters));
    if (window) {
      arrival = {
        status: 'ok',
        ...window,
        by: new Date(now.getTime() + window.toMinutes * 60_000).toISOString(),
      };
    }
  }
  const closesAt = store.closesAt ? Date.parse(store.closesAt.at) : null;
  const closingSoon =
    store.isOpen && closesAt !== null && closesAt - now.getTime() <= CLOSING_SOON_MINUTES * 60_000;

  const appliedCoupon =
    facts.coupon && figures.promo?.status === 'applied'
      ? {
          id: facts.coupon.id,
          code: facts.coupon.code,
          usageLimit: facts.coupon.usageLimit,
          perUserLimit: facts.coupon.perUserLimit,
          ownerUserId: facts.coupon.ownerUserId,
        }
      : null;

  const result: Quote = {
    quotedAt: now.toISOString(),
    lines: quoteLines,
    itemCount: figures.itemCount,
    subtotalCents: figures.subtotalCents,
    promo: figures.promo ? promoView(figures.promo, store.timeZone, code?.limitMessage) : null,
    delivery: {
      kind: delivery.kind,
      address: delivery.address,
      status: figures.delivery.status,
      distanceKm: figures.delivery.distanceKm,
      radiusKm: pricing.deliveryRadiusKm,
      edge: figures.delivery.edge,
      feeCents: figures.delivery.feeCents,
      feeRange: figures.delivery.feeRange,
      missingAddress: delivery.missingAddress,
    },
    tax: figures.tax,
    tipCents: figures.tipCents,
    tipOptions: tipOptions(foodSubtotalCents),
    totalCents: figures.totalCents,
    totalKind: figures.totalKind,
    store: {
      timeZone: store.timeZone,
      isOpen: store.isOpen,
      opensAt: store.opensAt,
      closesAt: store.closesAt,
      closingSoon,
    },
    arrival,
    cashAllowed: cashAllowed(figures.totalCents),
    cashLimitCents: CASH_LIMIT_CENTS,
    offers: [...offers.values()].toSorted((a, b) => a.endsAt.localeCompare(b.endsAt)),
    checkoutBlockers,
  };
  return {
    quote: result,
    coupon: appliedCoupon,
    titles: new Map(facts.dishes.map((dish) => [dish.id, dish.title])),
    distanceMeters: delivery.point.status === 'unknown' ? null : delivery.point.distanceMeters,
    store,
  };
}
