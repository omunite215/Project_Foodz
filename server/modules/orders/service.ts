import 'server-only';
import { createHash } from 'node:crypto';
import { displayPhone, parsePhone } from '@/lib/phone';
import { can } from '@/server/auth/roles';
import type { UserActor } from '@/server/auth/session';
import { type Actor, type DbContext, runAs, runAsSystem } from '@/server/db/context';
import {
  AppError,
  demoReadOnly,
  invalidInput,
  unauthenticated,
  unavailable,
} from '@/server/errors';
import { logger } from '@/server/logger';
import { getAddress, getAddressBook } from '@/server/modules/addresses/service';
import { ADDRESS_LIMIT } from '@/server/modules/addresses/schema';
import { PHONE_ERROR } from '@/server/modules/account/schema';
import { deliveryFee, distanceTenths } from '@/server/modules/cart/pricing';
import { CASH_LIMIT_CENTS, cleanNote } from '@/server/modules/cart/schema';
import { type CheckoutPricing, priceCartForCheckout } from '@/server/modules/cart/service';
import { lastClosing } from '@/server/modules/menu/hours';
import type { OpeningHours } from '@/server/modules/menu/schema';
import { getStoreStatus } from '@/server/modules/menu/service';
import { SAVED_CARD_LIMIT, type SavedCardDto } from '@/server/modules/payments/schema';
import {
  ensureStripeCustomer,
  findOwnCard,
  getInstanceTag,
  getStripeConfig,
  listMySavedCards,
  requireGateway,
  toSavedCardDto,
} from '@/server/modules/payments/service';
import { type IntentState, paymentGateway, PaymentProviderError } from '@/server/payments/stripe';
import { blockedFor, type LimitCheck, takeAttempts } from '@/server/security/rate-limit';
import { type OrderEffect, rememberPaymentNetwork, runEffects } from './effects';
import { applyIntent, checkWithStripe, expireUnpaidOrder } from './payment-sync';
import { changeReason, priceChanges } from './price-changes';
import {
  addEvent,
  anonymizeOwnOrders,
  cardsLastUsed,
  countCustomerUses,
  countListed,
  findBlockingOrders,
  findByAttemptKey,
  findCustomer,
  findOrderForPayment,
  findOrderView,
  findPricingFacts,
  findRecentDuplicate,
  findRedemption,
  findUnpaid,
  findUnpaidOrders,
  insertOrder,
  lastPaymentMethod,
  listForExport,
  listInProgress,
  listPast,
  lockCustomerOrders,
  lockOrder,
  type NewOrderLine,
  type OrderBrief,
  releaseAttemptKey,
  returnCouponUse,
  setPaymentIntent,
  setRedemptionStatus,
  takeCouponUse,
  updateCustomerPhone,
  updateOrder,
} from './repo';
import {
  type AttemptStatus,
  attemptStatusInput,
  type CancelResult,
  type CheckoutPage,
  type CheckoutUnpaidOrder,
  DEFAULT_PAYMENT_TTL_MINUTES,
  DUPLICATE_WINDOW_MS,
  listOrdersInput,
  orderIdInput,
  ORDERS_PAGE_SIZE,
  type OrderRefusalDetails,
  type OrdersPage,
  orderStatusInput,
  type OrderView,
  type ParsedPlaceOrderInput,
  placeOrderInput,
  type PlaceOrderResult,
  resumePaymentInput,
  type ResumePaymentResult,
} from './schema';
import {
  CARD_NOT_SAVED,
  cardLabel,
  cardPausedMessage,
  cashLimitMessage,
  CHOOSE_ADDRESS,
  DEMO_CANNOT_ORDER,
  duplicateMessage,
  emailGate,
  kitchenStartedMessage,
  NOT_A_CUSTOMER,
  outsideAreaMessage,
  paymentInProgressMessage,
  priceChangedMessage,
  soldOutMessage,
  storeClosedMessage,
  unpaidOrderMessage,
} from './text';
import { storeFacts, toOrderSummary, toOrderView } from './views';

/*
 * Checkout and the customer's orders (F4). Placing an order prices it again from the database
 * and refuses on any change (U12); the order is written by the platform (the customer can't
 * write orders or count code uses, row-level security), under a per-customer lock so one press,
 * one retry or two tabs make one order (S7). Card orders wait for Stripe; everything Stripe says
 * goes through payment-sync.ts.
 */

const ORDER_NOT_FOUND = 'Order not found.';
const notFound = () => new AppError('NOT_FOUND', ORDER_NOT_FOUND, 404);

function refusal<K extends keyof OrderRefusalDetails>(
  code: K,
  message: string,
  status: number,
  details: OrderRefusalDetails[K],
): AppError {
  return new AppError(code, message, status, { details: { ...details } });
}

export function paymentTtlMinutes(env: Record<string, string | undefined> = process.env) {
  const value = Number(env.ORDER_PAYMENT_TTL_MINUTES);
  return Number.isInteger(value) && value >= 1 && value <= 60 ? value : DEFAULT_PAYMENT_TTL_MINUTES;
}

// ------------------------------------------------------------------ who may order (S1, B13)

/** Customer accounts only (U9); never the shared demo (U3). Throws the S1 refusal otherwise. */
function assertCustomer(actor: UserActor) {
  if (actor.role !== 'customer' || !can(actor.role, { order: ['create'] })) {
    throw new AppError('NOT_A_CUSTOMER', NOT_A_CUSTOMER, 403);
  }
  if (actor.isDemo) throw demoReadOnly(DEMO_CANNOT_ORDER);
}

async function requireOrderingCustomer(actor: UserActor) {
  assertCustomer(actor);
  const customer = await runAs(actor, (ctx) => findCustomer(ctx, actor.userId));
  // Suspended or deleted since the page loaded (S1.8): treated as signed out.
  if (!customer || customer.banned || customer.deletedAt) throw unauthenticated();
  if (!customer.emailVerified) {
    throw refusal('EMAIL_NOT_CONFIRMED', emailGate(customer.email), 403, { email: customer.email });
  }
  return customer;
}

// ------------------------------------------------------------------ helpers

const declineChecks = (actor: UserActor, ip: string): LimitCheck[] => [
  { policy: 'payment.decline.user', key: `user:${actor.userId}` },
  { policy: 'payment.decline.ip', key: `ip:${ip}` },
];

async function cardPausedUntil(actor: UserActor, ip: string | null, now: Date) {
  const checks = ip ? declineChecks(actor, ip) : declineChecks(actor, '').slice(0, 1);
  const blocked = await blockedFor(checks).catch(() => null);
  return blocked?.retryAfterSeconds
    ? new Date(now.getTime() + blocked.retryAfterSeconds * 1000).toISOString()
    : null;
}

/** Same dishes (with extras) to the same address: the S7.5 duplicate check. */
function cartFingerprint(input: ParsedPlaceOrderInput) {
  const lines = input.lines
    .map((line) => [line.menuItemId, line.quantity, [...line.flavors].toSorted()] as const)
    .toSorted((a, b) => (a[0] === b[0] ? a[1] - b[1] : a[0].localeCompare(b[0])));
  return createHash('sha256')
    .update(JSON.stringify({ address: input.addressId, lines }))
    .digest('hex');
}

function hoursOf(pricing: CheckoutPricing): OpeningHours {
  const hours: OpeningHours = {};
  for (const day of pricing.store.weeklyHours) hours[day.weekday] = day.hours;
  return hours;
}

const tipChoiceText = (tip: ParsedPlaceOrderInput['tip']) =>
  tip.kind === 'none' ? 'none' : tip.kind === 'percent' ? String(tip.percent) : 'amount';

/** Refusals that come from the quote itself (S8): nothing is created. */
function refuseFromQuote(input: ParsedPlaceOrderInput, pricing: CheckoutPricing, now: Date) {
  const quote = pricing.quote;
  if (quote.lines.length === 0) throw invalidInput('Your cart is empty.');

  const soldOut = quote.lines.filter((line) => line.status === 'soldOut');
  const removed = quote.lines.filter((line) => line.status === 'removed');
  if (soldOut.length > 0 || removed.length > 0) {
    const message =
      soldOut.length > 0
        ? soldOutMessage(soldOut.map((line) => line.dish?.title ?? 'A dish'))
        : `${removed.length === 1 ? '1 dish in your cart is' : `${removed.length} dishes in your cart are`} no longer on our menu, so we took ${removed.length === 1 ? 'it' : 'them'} out.`;
    throw refusal('SOLD_OUT', message, 409, {
      soldOut: soldOut.map((line) => ({
        key: line.key,
        menuItemId: line.menuItemId,
        dish: line.dish?.title ?? '',
      })),
      removed: removed.map((line) => ({ key: line.key, menuItemId: line.menuItemId })),
      quote,
    });
  }
  if (quote.itemCount === 0) throw invalidInput('Your cart is empty.');

  if (quote.delivery.kind !== 'saved' || quote.delivery.missingAddress) {
    throw invalidInput(CHOOSE_ADDRESS, { addressId: [CHOOSE_ADDRESS] });
  }
  if (!quote.store.isOpen) {
    const closedAt = lastClosing(hoursOf(pricing), quote.store.timeZone, now);
    throw refusal('STORE_CLOSED', storeClosedMessage(closedAt, quote.store.opensAt), 409, {
      closedAt,
      opensAt: quote.store.opensAt,
    });
  }
  if (quote.delivery.status !== 'inside' || quote.delivery.feeCents === null) {
    const place = quote.delivery.address?.label ?? quote.delivery.address?.line1 ?? 'this address';
    throw refusal(
      'OUTSIDE_AREA',
      outsideAreaMessage(place, quote.delivery.distanceKm, quote.delivery.radiusKm),
      422,
      { distanceKm: quote.delivery.distanceKm, radiusKm: quote.delivery.radiusKm },
    );
  }
  const promo = quote.promo;
  if (
    input.code &&
    promo &&
    (promo.status === 'refused' || promo.status === 'unchecked') &&
    promo.reason
  ) {
    throw refusal('PROMO_REFUSED', promo.message ?? `Sorry, ${promo.code} can't be used.`, 409, {
      code: promo.code,
      reason: promo.reason,
      quote,
    });
  }
  if (input.expectedTotalCents !== quote.totalCents) {
    const changes = priceChanges(input.shown, quote);
    const first = changes.map(changeReason).find((reason) => reason !== null) ?? null;
    throw refusal(
      'PRICE_CHANGED',
      priceChangedMessage(input.expectedTotalCents, quote.totalCents, first, input.method),
      409,
      { oldTotalCents: input.expectedTotalCents, newTotalCents: quote.totalCents, quote, changes },
    );
  }
  if (input.method === 'cash' && !quote.cashAllowed) {
    throw refusal('CASH_LIMIT', cashLimitMessage(quote.totalCents, CASH_LIMIT_CENTS), 422, {
      totalCents: quote.totalCents,
      limitCents: CASH_LIMIT_CENTS,
    });
  }
}

// ------------------------------------------------------------------ card payments

type OwnCard = NonNullable<Awaited<ReturnType<typeof findOwnCard>>>;

/** Marks an order whose payment could not be started as failed and gives its code back. */
async function abandonOrder(orderId: string) {
  await runAsSystem('payment not started', async (ctx) => {
    const order = await lockOrder(ctx, orderId);
    if (!order || order.status !== 'PENDING_PAYMENT' || order.stripePaymentIntentId) return;
    await updateOrder(ctx, orderId, order.version, { status: 'FAILED' });
    const redemption = await findRedemption(ctx, orderId);
    if (redemption && redemption.status !== 'RELEASED') {
      await setRedemptionStatus(ctx, orderId, 'RELEASED');
      await returnCouponUse(ctx, redemption.couponId);
    }
    await addEvent(ctx, {
      orderId,
      type: 'payment-failed',
      fromStatus: 'PENDING_PAYMENT',
      toStatus: 'FAILED',
      data: { actor: 'system', code: 'payment_not_started', declineCode: null },
    });
  });
}

/**
 * Creates the order's PaymentIntent (B5): for exactly its total, in USD, cards only, tagged with
 * the order and this database. Its idempotency key is the order, so a retry gets the same one.
 */
async function startCardPayment(
  actor: UserActor,
  order: { id: string; number: string; totalCents: number; expiresAt: Date | null },
  card: { kind: 'new'; save: boolean } | { kind: 'saved'; own: OwnCard } | null,
  ip: string,
): Promise<IntentState> {
  const gateway = requireGateway();
  try {
    let customerId: string | undefined;
    let paymentMethodId: string | undefined;
    let saveCard = false;
    if (card?.kind === 'saved') {
      customerId = card.own.customerId;
      paymentMethodId = card.own.id;
    } else if (card?.kind === 'new' && card.save) {
      const saved = await listMySavedCards(actor);
      if (saved.length < SAVED_CARD_LIMIT) {
        customerId = await ensureStripeCustomer(actor);
        saveCard = true;
      }
    }
    const intent = await gateway.createIntent({
      amountCents: order.totalCents,
      orderId: order.id,
      orderNumber: order.number,
      instance: await getInstanceTag(),
      customerId,
      paymentMethodId,
      saveCard,
      idempotencyKey: `order-${order.id}`,
    });
    await runAsSystem('payment started', (ctx) => setPaymentIntent(ctx, order.id, intent.id));
    await rememberPaymentNetwork(intent.id, ip);
    if (order.expiresAt) {
      await runEffects([
        { kind: 'expiry', orderId: order.id, expiresAt: order.expiresAt.toISOString() },
      ]);
    }
    return intent;
  } catch (error) {
    if (!(error instanceof PaymentProviderError)) throw error;
    await abandonOrder(order.id);
    throw unavailable(
      "We couldn't start the card payment. Nothing was charged. Try again in a minute, or pay with cash.",
    );
  }
}

/** The same press again (S7.2): the order it made, and for a card the same payment. */
async function replay(
  actor: UserActor,
  order: OrderBrief,
  card: Parameters<typeof startCardPayment>[2],
  ip: string,
): Promise<PlaceOrderResult> {
  const placed = (): PlaceOrderResult => ({
    kind: 'placed',
    orderId: order.id,
    number: order.number,
    method: order.paymentMethod === 'CARD' ? 'card' : 'cash',
    totalCents: order.totalCents,
    replayed: true,
  });
  if (order.status !== 'PENDING_PAYMENT') return placed();

  let intent: IntentState;
  if (order.stripePaymentIntentId) {
    intent = await requireGateway().retrieveIntent(order.stripePaymentIntentId);
  } else {
    intent = await startCardPayment(actor, order, card, ip);
  }
  if (intent.status === 'succeeded') {
    await applyIntent(intent, { source: 'check' });
    return placed();
  }
  if (!intent.clientSecret) throw unavailable();
  return {
    kind: 'pay',
    orderId: order.id,
    number: order.number,
    totalCents: order.totalCents,
    clientSecret: intent.clientSecret,
    expiresAt: (order.expiresAt ?? new Date()).toISOString(),
    replayed: true,
  };
}

// ------------------------------------------------------------------ placing an order (B2)

export interface PlaceCaller {
  /** The client's network, for the per-network limits. */
  ip: string;
}

/** Thrown inside the order transaction when a figure moved since the quote a moment before. */
class PricesMoved extends Error {}

type Address = NonNullable<Awaited<ReturnType<typeof getAddress>>>;

/**
 * F3 security S8: every figure is checked again inside the order's own transaction against
 * the database (dish prices and availability, the fee and tax settings, and the distance of
 * the saved address the order goes to), so nothing the quote read can have moved since.
 */
function stillPriced(
  facts: Awaited<ReturnType<typeof findPricingFacts>>,
  pricing: CheckoutPricing,
  address: Address,
): boolean {
  const { quote } = pricing;
  const { settings } = facts;
  if (!settings || !facts.address?.inside) return false;
  if (facts.address.lat !== address.lat || facts.address.lng !== address.lng) return false;
  const linesHold = quote.lines.every((line) => {
    if (line.status !== 'ok') return true;
    const dish = facts.dishes.get(line.menuItemId);
    return Boolean(dish?.isAvailable) && dish?.priceCents === line.unitPriceCents;
  });
  const fee = deliveryFee(distanceTenths(facts.address.distance_m ?? 0), {
    taxRateBps: settings.taxRateBps,
    baseDeliveryFeeCents: settings.baseDeliveryFeeCents,
    perKmFeeCents: settings.perKmFeeCents,
    deliveryRadiusKm: settings.deliveryRadiusKm,
  });
  return (
    linesHold &&
    settings.taxRateBps === quote.tax.rateBps &&
    settings.deliveryRadiusKm === quote.delivery.radiusKm &&
    fee === quote.delivery.feeCents
  );
}

export async function placeOrder(
  actor: UserActor,
  rawInput: unknown,
  caller: PlaceCaller,
  now = new Date(),
): Promise<PlaceOrderResult> {
  // The per-network limit (B11); the per-account one is the action's own.
  await takeAttempts([{ policy: 'order.place.ip', key: `ip:${caller.ip}` }]);
  try {
    return await placeOrderOnce(actor, rawInput, caller, now);
  } catch (error) {
    if (!(error instanceof PricesMoved)) throw error;
    // Priced again from scratch: the refusal now says what moved (S8.2).
    try {
      return await placeOrderOnce(actor, rawInput, caller, now);
    } catch (again) {
      if (again instanceof PricesMoved) throw unavailable();
      throw again;
    }
  }
}

async function placeOrderOnce(
  actor: UserActor,
  rawInput: unknown,
  caller: PlaceCaller,
  now: Date,
): Promise<PlaceOrderResult> {
  const input = placeOrderInput.parse(rawInput);
  const customer = await requireOrderingCustomer(actor);

  const isCard = input.method === 'card';
  const store = await storeFacts();
  if (isCard) {
    requireGateway();
    const until = await cardPausedUntil(actor, caller.ip, now);
    if (until) {
      throw refusal('CARD_PAUSED', cardPausedMessage(until, store.timeZone), 429, { until });
    }
  }

  // The same press again returns the order it made (S7.2).
  const earlier = await runAs(actor, (ctx) =>
    findByAttemptKey(ctx, actor.userId, input.attemptKey),
  );
  let ownCard: OwnCard | null = null;
  if (input.card?.kind === 'saved') {
    ownCard = await findOwnCard(actor, input.card.paymentMethodId).catch((error: unknown) => {
      if (error instanceof PaymentProviderError) throw unavailable();
      throw error;
    });
    if (!ownCard) throw new AppError('NOT_FOUND', CARD_NOT_SAVED, 404);
    if (toSavedCardDto(ownCard, now).expired) {
      throw invalidInput('That card has expired. Choose another card.', {
        card: ['That card has expired. Choose another card.'],
      });
    }
  }
  const cardChoice =
    input.card?.kind === 'saved' && ownCard
      ? { kind: 'saved' as const, own: ownCard }
      : input.card?.kind === 'new'
        ? { kind: 'new' as const, save: input.card.save }
        : null;
  if (earlier && earlier.status !== 'FAILED' && earlier.status !== 'CANCELLED') {
    return replay(actor, earlier, cardChoice, caller.ip);
  }

  // An unpaid order past its time is settled first, so it doesn't block this one.
  const unpaid = await runAs(actor, (ctx) => findUnpaid(ctx, actor.userId));
  if (unpaid?.expiresAt && unpaid.expiresAt.getTime() <= now.getTime()) {
    await expireUnpaidOrder(unpaid.id, now).catch((error: unknown) => {
      logger.warn({ err: error }, 'could not expire an unpaid order at checkout');
    });
  }

  // Priced again from the database (S8.1): nothing the browser kept is trusted.
  const pricing = await priceCartForCheckout(
    actor,
    {
      lines: input.lines,
      ...(input.code ? { code: input.code } : {}),
      delivery: { kind: 'saved', addressId: input.addressId },
      tip: input.tip,
      method: input.method,
    },
    { ip: caller.ip },
    now,
  );
  refuseFromQuote(input, pricing, now);
  const quote = pricing.quote;

  const address = await getAddress(actor, input.addressId);
  if (!address) throw invalidInput(CHOOSE_ADDRESS, { addressId: [CHOOSE_ADDRESS] });
  const phone = parsePhone(input.phone, input.phoneCountry);
  if (!phone) throw invalidInput('Check the highlighted fields.', { phone: [PHONE_ERROR] });

  const ttl = paymentTtlMinutes();
  const expiresAt = isCard ? new Date(now.getTime() + ttl * 60_000) : null;
  const okLines = quote.lines.filter((line) => line.status === 'ok' && line.dish);
  const lines: NewOrderLine[] = okLines.map((line) => ({
    menuItemId: line.menuItemId,
    title: line.dish?.title ?? '',
    unitPriceCents: line.unitPriceCents ?? 0,
    quantity: line.quantity,
    flavors: line.flavors,
    note: line.note,
  }));
  const promo = quote.promo?.status === 'applied' ? quote.promo : null;
  const coupon = promo ? pricing.coupon : null;
  const kitchenNote = cleanNote(input.kitchenNote);
  const fingerprint = cartFingerprint(input);
  const arrival = quote.arrival.status === 'ok' ? quote.arrival : null;
  const addressText = [address.line1, address.line2, address.city].filter(Boolean).join(', ');

  const created = await runAsSystem('checkout', async (ctx) => {
    await lockCustomerOrders(ctx, actor.userId);
    // Deleted or suspended while this press waited: account deletion holds the same lock (B21).
    const stillCustomer = await findCustomer(ctx, actor.userId);
    if (!stillCustomer || stillCustomer.banned || stillCustomer.deletedAt) throw unauthenticated();
    const facts = await findPricingFacts(ctx, {
      userId: actor.userId,
      addressId: input.addressId,
      menuItemIds: okLines.map((line) => line.menuItemId),
    });
    if (!stillPriced(facts, pricing, address)) throw new PricesMoved();

    const again = await findByAttemptKey(ctx, actor.userId, input.attemptKey);
    if (again && again.status !== 'FAILED' && again.status !== 'CANCELLED') {
      return { replayOf: again } as const;
    }
    if (again) await releaseAttemptKey(ctx, actor.userId, input.attemptKey);

    const waiting = await findUnpaid(ctx, actor.userId);
    if (waiting) {
      throw refusal(
        'UNPAID_ORDER',
        unpaidOrderMessage(
          waiting.number,
          waiting.totalCents,
          waiting.expiresAt?.toISOString() ?? null,
          store.timeZone,
        ),
        409,
        {
          orderId: waiting.id,
          number: waiting.number,
          totalCents: waiting.totalCents,
          expiresAt: waiting.expiresAt?.toISOString() ?? null,
        },
      );
    }
    if (!input.allowDuplicate) {
      const duplicate = await findRecentDuplicate(
        ctx,
        actor.userId,
        fingerprint,
        new Date(now.getTime() - DUPLICATE_WINDOW_MS),
      );
      if (duplicate) {
        throw refusal('LIKELY_DUPLICATE', duplicateMessage(duplicate.number), 409, {
          orderId: duplicate.id,
          number: duplicate.number,
        });
      }
    }

    // The code is held (card) or used (cash) atomically, within its limits (S9.1, B9).
    if (promo && coupon) {
      const ownerOk = coupon.ownerUserId === null || coupon.ownerUserId === actor.userId;
      const uses =
        coupon.perUserLimit === null ? 0 : await countCustomerUses(ctx, coupon.id, actor.userId);
      const perCustomerOk = coupon.perUserLimit === null || uses < coupon.perUserLimit;
      const taken = ownerOk && perCustomerOk ? await takeCouponUse(ctx, coupon, now) : 0;
      if (taken === 0) {
        const reason = !perCustomerOk
          ? ({ code: 'alreadyUsed', rule: 'R6', perCustomer: coupon.perUserLimit ?? 1 } as const)
          : ({ code: 'usedUp', rule: 'R4' } as const);
        const message =
          reason.code === 'usedUp'
            ? `Sorry, ${coupon.code} has run out.`
            : `You've already used ${coupon.code}. It's one per customer.`;
        throw refusal('PROMO_REFUSED', message, 409, { code: coupon.code, reason, quote });
      }
    }

    const order = await insertOrder(
      ctx,
      {
        userId: actor.userId,
        status: isCard ? 'PENDING_PAYMENT' : 'PLACED',
        paymentMethod: isCard ? 'CARD' : 'CASH',
        contactName: input.contactName,
        contactPhone: phone.e164,
        addressText,
        addressLabel: address.label,
        addressLine1: address.line1,
        addressLine2: address.line2,
        addressCity: address.city,
        courierInstructions: address.notes,
        addressLat: address.lat,
        addressLng: address.lng,
        distanceKm: quote.delivery.distanceKm ?? address.distanceKm,
        note: kitchenNote,
        subtotalCents: quote.subtotalCents,
        discountCents: promo?.foodDiscountCents ?? 0,
        deliveryFeeCents: quote.delivery.feeCents ?? 0,
        deliveryDiscountCents: promo?.deliveryDiscountCents ?? 0,
        taxCents: quote.tax.cents,
        taxRateBps: quote.tax.rateBps,
        tipCents: quote.tipCents,
        tipChoice: tipChoiceText(input.tip),
        totalCents: quote.totalCents,
        couponId: coupon?.id ?? null,
        promoCode: promo?.code ?? null,
        attemptKey: input.attemptKey,
        cartFingerprint: fingerprint,
        arrivalFromMinutes: arrival?.fromMinutes ?? null,
        arrivalToMinutes: arrival?.toMinutes ?? null,
        expiresAt,
        placedAt: isCard ? null : now,
      },
      lines,
      promo && coupon
        ? {
            couponId: coupon.id,
            status: isCard ? 'RESERVED' : 'REDEEMED',
            discountCents: promo.amountCents,
          }
        : null,
    );
    await addEvent(ctx, {
      orderId: order.id,
      type: 'created',
      toStatus: isCard ? 'PENDING_PAYMENT' : 'PLACED',
      actorId: actor.userId,
      data: { actor: 'customer', method: input.method },
    });
    if (!isCard) {
      await addEvent(ctx, {
        orderId: order.id,
        type: 'placed',
        toStatus: 'PLACED',
        actorId: actor.userId,
        data: { actor: 'customer', method: 'cash' },
      });
    }
    if (input.savePhone && customer.phone !== phone.e164) {
      await updateCustomerPhone(ctx, actor.userId, phone.e164);
    }
    return { order } as const;
  });

  if (created.replayOf) return replay(actor, created.replayOf, cardChoice, caller.ip);
  const { order } = created;

  if (!isCard) {
    await runEffects([{ kind: 'email', orderId: order.id, email: 'receipt', change: 'placed' }]);
    return {
      kind: 'placed',
      orderId: order.id,
      number: order.number,
      method: 'cash',
      totalCents: quote.totalCents,
      replayed: false,
    };
  }

  const intent = await startCardPayment(
    actor,
    { id: order.id, number: order.number, totalCents: quote.totalCents, expiresAt },
    cardChoice,
    caller.ip,
  );
  if (!intent.clientSecret) throw unavailable();
  return {
    kind: 'pay',
    orderId: order.id,
    number: order.number,
    totalCents: quote.totalCents,
    clientSecret: intent.clientSecret,
    expiresAt: (expiresAt ?? now).toISOString(),
    replayed: false,
  };
}

// ------------------------------------------------------------------ reading orders

/** The order page (S11): the caller's own order only; null for anyone else's or a made-up id. */
export async function getOrderView(
  actor: UserActor,
  orderId: string,
  now = new Date(),
): Promise<OrderView | null> {
  const parsed = orderIdInput.safeParse({ orderId });
  if (!parsed.success) return null;
  const [row, store] = await Promise.all([
    runAs(actor, (ctx) => findOrderView(ctx, parsed.data.orderId, actor.userId)),
    storeFacts(),
  ]);
  return row ? toOrderView(row, store, now) : null;
}

async function requireOwnView(actor: UserActor, orderId: string, now: Date) {
  const view = await getOrderView(actor, orderId, now);
  if (!view) throw notFound();
  return view;
}

/** The order page's poll (B7): asks Stripe about a waiting card payment, then reads the order. */
export async function checkOrderStatus(
  actor: UserActor,
  input: unknown,
  now = new Date(),
): Promise<OrderView> {
  const { orderId, confirmed } = orderStatusInput.parse(input);
  const before = await requireOwnView(actor, orderId, now);
  if (before.status !== 'PENDING_PAYMENT') return before;
  await checkWithStripe(orderId, { confirmed, now });
  return requireOwnView(actor, orderId, now);
}

/** S7.3 and B16: what became of a press, by its attempt key. */
export async function getAttemptStatus(
  actor: UserActor,
  input: unknown,
  now = new Date(),
): Promise<AttemptStatus> {
  const { attemptKey } = attemptStatusInput.parse(input);
  const find = () => runAs(actor, (ctx) => findByAttemptKey(ctx, actor.userId, attemptKey));
  let order = await find();
  if (order?.status === 'PENDING_PAYMENT') {
    await checkWithStripe(order.id, { confirmed: false, now });
    order = await find();
  }
  if (!order) return { kind: 'notFound' };
  switch (order.status) {
    case 'PENDING_PAYMENT':
      return {
        kind: 'awaitingPayment',
        orderId: order.id,
        number: order.number,
        expiresAt: order.expiresAt?.toISOString() ?? null,
      };
    case 'FAILED': {
      const view = await getOrderView(actor, order.id, now);
      return {
        kind: 'failed',
        orderId: order.id,
        number: order.number,
        decline: view?.payment.decline ?? null,
      };
    }
    case 'CANCELLED':
      return {
        kind: 'cancelled',
        orderId: order.id,
        number: order.number,
        reason:
          order.cancelReason === 'customer' ||
          order.cancelReason === 'payment-expired' ||
          order.cancelReason === 'account-deleted'
            ? order.cancelReason
            : null,
      };
    default:
      return { kind: 'placed', orderId: order.id, number: order.number };
  }
}

const encodeCursor = (createdAt: Date, id: string) =>
  Buffer.from(`${createdAt.toISOString()}|${id}`).toString('base64url');

function decodeCursor(cursor: string | undefined) {
  if (!cursor) return null;
  const [at, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  const createdAt = new Date(at ?? '');
  const valid =
    !Number.isNaN(createdAt.getTime()) && orderIdInput.safeParse({ orderId: id }).success;
  if (!valid || !id) throw invalidInput('Reload the page to see more orders.');
  return { createdAt, id };
}

/** S12.1, S12.2: in progress first (first page only), then the rest 20 at a time. */
export async function listMyOrders(actor: UserActor, input: unknown = {}): Promise<OrdersPage> {
  const { cursor } = listOrdersInput.parse(input);
  const after = decodeCursor(cursor);
  return runAs(actor, async (ctx) => {
    const inProgress = after ? [] : await listInProgress(ctx, actor.userId, ORDERS_PAGE_SIZE);
    const past = await listPast(ctx, actor.userId, after, ORDERS_PAGE_SIZE + 1);
    const page = past.slice(0, ORDERS_PAGE_SIZE);
    const last = page.at(-1);
    return {
      inProgress: inProgress.map(toOrderSummary),
      past: page.map(toOrderSummary),
      nextCursor:
        past.length > ORDERS_PAGE_SIZE && last ? encodeCursor(last.createdAt, last.id) : null,
    };
  });
}

// ------------------------------------------------------------------ cancelling (U6, S12.5)

export async function cancelOrder(
  actor: UserActor,
  input: unknown,
  now = new Date(),
): Promise<CancelResult> {
  const { orderId } = orderIdInput.parse(input);
  if (actor.isDemo) throw demoReadOnly(DEMO_CANNOT_ORDER);
  if (actor.role !== 'customer' || !can(actor.role, { order: ['cancel'] })) {
    throw new AppError('NOT_A_CUSTOMER', NOT_A_CUSTOMER, 403);
  }
  const own = await runAs(actor, (ctx) => findOrderView(ctx, orderId, actor.userId));
  if (!own) throw notFound();
  const store = await storeFacts();

  if (own.status === 'PENDING_PAYMENT' && own.paymentMethod === 'CARD') {
    const order = await runAsSystem('cancel', (ctx) => findOrderForPayment(ctx, orderId));
    const gateway = paymentGateway();
    if (order?.stripePaymentIntentId && gateway) {
      let intent: IntentState;
      try {
        intent = await gateway.cancelIntent(order.stripePaymentIntentId);
      } catch {
        throw unavailable("We couldn't reach our payment provider. Try again in a minute.");
      }
      if (intent.status === 'processing') {
        throw refusal('PAYMENT_IN_PROGRESS', paymentInProgressMessage(own.number), 409, {
          orderId,
          number: own.number,
        });
      }
      // Paid a moment ago: it is placed, then cancelled and refunded below.
      if (intent.status === 'succeeded') await applyIntent(intent, { source: 'customer', now });
    }
  }

  const result = await runAsSystem('cancel', async (ctx) => {
    const order = await lockOrder(ctx, orderId);
    if (!order || order.userId !== actor.userId) throw notFound();
    // A part refunded earlier (staff, from Stripe) still leaves the rest to give back.
    const paidByCard =
      order.paymentMethod === 'CARD' &&
      (order.paymentStatus === 'PAID' || order.paymentStatus === 'PARTIALLY_REFUNDED');
    const refundCents = order.totalCents - order.refundedCents;
    if (order.status === 'CANCELLED') {
      // A double press cancels once (S12.6).
      return {
        order,
        paidByCard: order.autoRefundReason === 'customer-cancel',
        refundCents,
        effects: [] as OrderEffect[],
      };
    }
    if (order.status !== 'PENDING_PAYMENT' && order.status !== 'PLACED') {
      if (['ACCEPTED', 'PREPARING', 'READY', 'PICKED_UP'].includes(order.status)) {
        throw refusal('KITCHEN_STARTED', kitchenStartedMessage(order.number, store.phone), 409, {
          orderId,
          number: order.number,
          phone: store.phone,
        });
      }
      throw new AppError('CONFLICT', "This order can't be cancelled.", 409);
    }
    await updateOrder(ctx, orderId, order.version, {
      status: 'CANCELLED',
      cancelReason: 'customer',
      cancelledAt: now,
      ...(paidByCard && { autoRefundReason: 'customer-cancel' }),
    });
    const redemption = await findRedemption(ctx, orderId);
    if (redemption && redemption.status !== 'RELEASED') {
      await setRedemptionStatus(ctx, orderId, 'RELEASED');
      await returnCouponUse(ctx, redemption.couponId);
    }
    await addEvent(ctx, {
      orderId,
      type: 'cancelled',
      fromStatus: order.status,
      toStatus: 'CANCELLED',
      actorId: actor.userId,
      data: {
        actor: 'customer',
        refundAnnounced: paidByCard,
        refundCents: paidByCard ? refundCents : 0,
      },
    });
    const effects: OrderEffect[] = [
      {
        kind: 'email',
        orderId,
        email: 'cancelled',
        change: 'cancelled',
        ...(paidByCard && { refundCents, at: now.toISOString() }),
      },
    ];
    if (paidByCard) effects.push({ kind: 'refund', orderId });
    return { order, paidByCard, refundCents, effects };
  });
  await runEffects(result.effects);

  const view = await getOrderView(actor, orderId, now);
  return {
    orderId,
    number: result.order.number,
    status: 'CANCELLED',
    refund: result.paidByCard
      ? { amountCents: result.refundCents, cardLabel: view?.payment.card?.label ?? null }
      : null,
  };
}

// ------------------------------------------------------------------ finishing a payment (S7.6)

export async function resumePayment(
  actor: UserActor,
  input: unknown,
  caller: PlaceCaller,
  now = new Date(),
): Promise<ResumePaymentResult> {
  const { orderId, card } = resumePaymentInput.parse(input);
  assertCustomer(actor);
  const own = await runAs(actor, (ctx) => findOrderView(ctx, orderId, actor.userId));
  if (!own) throw notFound();
  const order = await runAsSystem('resume payment', (ctx) => findOrderForPayment(ctx, orderId));
  if (!order) throw notFound();
  const paid = (): ResumePaymentResult => ({ kind: 'paid', orderId, number: order.number });
  if (order.status === 'PLACED' && order.paymentStatus === 'PAID') return paid();
  if (
    order.status !== 'PENDING_PAYMENT' ||
    (order.expiresAt && order.expiresAt.getTime() <= now.getTime())
  ) {
    throw new AppError(
      'ORDER_NOT_PAYABLE',
      "This order can't be paid any more. Place your order again.",
      409,
    );
  }
  const gateway = requireGateway();

  let intent: IntentState;
  if (!order.stripePaymentIntentId) {
    intent = await startCardPayment(actor, order, null, caller.ip);
  } else {
    intent = await gateway.retrieveIntent(order.stripePaymentIntentId);
  }
  if (intent.status === 'succeeded') {
    await applyIntent(intent, { source: 'check', now });
    return paid();
  }
  if (card) {
    let customerId: string | undefined;
    let paymentMethodId: string | undefined;
    let saveCard = false;
    if (card.kind === 'saved') {
      const ownCard = await findOwnCard(actor, card.paymentMethodId);
      if (!ownCard) throw new AppError('NOT_FOUND', CARD_NOT_SAVED, 404);
      customerId = ownCard.customerId;
      paymentMethodId = ownCard.id;
    } else if (card.save && (await listMySavedCards(actor)).length < SAVED_CARD_LIMIT) {
      customerId = await ensureStripeCustomer(actor);
      saveCard = true;
    }
    intent = await gateway.updateIntent(intent.id, { customerId, paymentMethodId, saveCard });
  }
  if (!intent.clientSecret) throw unavailable();
  return {
    kind: 'pay',
    orderId,
    number: order.number,
    amountCents: order.totalCents,
    clientSecret: intent.clientSecret,
    expiresAt: order.expiresAt?.toISOString() ?? null,
  };
}

// ------------------------------------------------------------------ the checkout page (design "[BE] needs")

function feeFor(distanceKm: number, settings: { baseFeeCents: number; perKmFeeCents: number }) {
  return deliveryFee(Math.round(distanceKm * 10), {
    taxRateBps: 0,
    baseDeliveryFeeCents: settings.baseFeeCents,
    perKmFeeCents: settings.perKmFeeCents,
    deliveryRadiusKm: 0,
  });
}

/** Server render of /checkout: who may order, and what the page fills in (S1, S2, S6, S7.6). */
export async function getCheckoutPage(
  actor: Actor,
  caller: { ip: string | null } = { ip: null },
  now = new Date(),
): Promise<CheckoutPage> {
  if (actor.kind !== 'user') return { eligibility: 'guest' };
  if (actor.role === 'partner') return { eligibility: 'courier' };
  if (actor.role !== 'customer') return { eligibility: 'staff' };

  const customer = await runAs(actor, (ctx) => findCustomer(ctx, actor.userId));
  if (!customer || customer.banned || customer.deletedAt) return { eligibility: 'guest' };
  const eligibility = actor.isDemo ? 'demo' : customer.emailVerified ? 'ok' : 'unconfirmed';

  const book = await getAddressBook(actor);
  const status = await getStoreStatus(now);
  const settings = status.delivery;
  const addresses = book.addresses.map((address) => ({
    id: address.id,
    kind: address.kind,
    label: address.label,
    line1: address.line1,
    line2: address.line2,
    city: address.city,
    notes: address.notes,
    isDefault: address.isDefault,
    outsideNow: !address.deliverable,
    distanceKm: address.distanceKm,
    feeCents: address.deliverable ? feeFor(address.distanceKm, settings) : null,
  }));

  const { lastMethod, lastUsed, unpaid } = await runAs(actor, async (ctx) => ({
    lastMethod: await lastPaymentMethod(ctx, actor.userId),
    lastUsed: await cardsLastUsed(ctx, actor.userId),
    unpaid: await findUnpaid(ctx, actor.userId),
  }));

  let savedCards: SavedCardDto[] = [];
  if (!actor.isDemo) {
    try {
      const cards = await listMySavedCards(actor);
      savedCards = cards
        .map((card) => toSavedCardDto(card, now, lastUsed.get(card.id) ?? null))
        .toSorted((a, b) => (b.lastUsedAt ?? '').localeCompare(a.lastUsedAt ?? ''));
    } catch (error) {
      logger.warn({ err: error }, 'saved cards left off the checkout page');
    }
  }

  let unpaidOrder: CheckoutUnpaidOrder | null = null;
  if (unpaid) {
    if (unpaid.expiresAt && unpaid.expiresAt.getTime() <= now.getTime()) {
      await expireUnpaidOrder(unpaid.id, now).catch(() => undefined);
    } else {
      let paymentInProgress = false;
      const gateway = paymentGateway();
      if (gateway && unpaid.stripePaymentIntentId) {
        try {
          const intent = await gateway.retrieveIntent(unpaid.stripePaymentIntentId);
          if (intent.status === 'succeeded') await applyIntent(intent, { source: 'check', now });
          paymentInProgress = intent.status === 'processing' || intent.status === 'succeeded';
        } catch (error) {
          logger.warn({ err: error }, 'could not check an unpaid order with Stripe');
        }
      }
      unpaidOrder = {
        id: unpaid.id,
        number: unpaid.number,
        totalCents: unpaid.totalCents,
        expiresAt: unpaid.expiresAt?.toISOString() ?? null,
        paymentInProgress,
      };
    }
  }

  return {
    eligibility,
    email: customer.email,
    profile: {
      name: customer.name,
      phone: customer.phone,
      phoneDisplay: customer.phone ? displayPhone(customer.phone).display : null,
      phoneCountry: customer.phone ? displayPhone(customer.phone).country : null,
    },
    addresses,
    addressCount: book.addresses.length,
    addressLimit: ADDRESS_LIMIT,
    lastPaymentMethod: lastMethod === 'CARD' ? 'card' : lastMethod === 'CASH' ? 'cash' : null,
    savedCards,
    savedCardLimit: SAVED_CARD_LIMIT,
    stripe: getStripeConfig(),
    cardPausedUntil: actor.isDemo ? null : await cardPausedUntil(actor, caller.ip, now),
    unpaidOrder,
    cashLimitCents: CASH_LIMIT_CENTS,
    paymentTtlMinutes: paymentTtlMinutes(),
    storePhone: displayPhone(status.store.phone.replace(/\s+/g, '')).display,
  };
}

// ------------------------------------------------------------------ the account (F2 hooks)

/** Orders in the customer's list, for the account skeletons. */
export function countMyOrders(actor: UserActor) {
  return runAs(actor, (ctx) => countListed(ctx, actor.userId));
}

/**
 * B21: before an account is deleted, its unpaid card orders are cancelled at Stripe and here,
 * and their codes released. One Stripe has already been paid for becomes placed, which then
 * blocks the deletion until it is cancelled (U6).
 */
export async function cancelUnpaidOrdersForDeletion(actor: UserActor, now = new Date()) {
  const unpaid = await runAs(actor, (ctx) => findUnpaidOrders(ctx, actor.userId));
  await unpaid.reduce(async (previous, order) => {
    await previous;
    await expireUnpaidOrder(order.id, now, 'account-deleted');
  }, Promise.resolve());
}

/**
 * First thing in the deletion transaction: the customer's order lock, which checkout and every
 * payment step take too, so no order or payment lands while the account is erased (B21).
 */
export function lockOrdersForDeletion(ctx: DbContext, userId: string) {
  return lockCustomerOrders(ctx, userId);
}

/**
 * What still stops a deletion: a placed order she can cancel, orders on their way, and a card
 * payment the bank is still confirming (its order stays waiting until Stripe decides).
 */
export async function ordersBlockingDeletion(ctx: DbContext, userId: string) {
  const blocking = await findBlockingOrders(ctx, userId);
  const unpaid = await findUnpaid(ctx, userId);
  return { ...blocking, paying: unpaid ? { id: unpaid.id, number: unpaid.number } : null };
}

/** Inside the deletion transaction: the caller's orders kept without their details. */
export function anonymizeMyOrders(ctx: DbContext) {
  return anonymizeOwnOrders(ctx);
}

/** S12.7: the orders section of "Download my data". */
export async function exportMyOrders(actor: UserActor) {
  const rows = await runAs(actor, (ctx) => listForExport(ctx, actor.userId));
  return rows.map((row) => ({
    number: row.number,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    placedAt: row.placedAt?.toISOString() ?? null,
    deliveredAt: row.deliveredAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    lines: row.items.map((item) => ({
      dish: item.title,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      extras: item.flavors,
      note: item.note,
    })),
    subtotalCents: row.subtotalCents,
    promoCode: row.promoCode,
    discountCents: row.discountCents,
    deliveryFeeCents: row.deliveryFeeCents,
    deliveryDiscountCents: row.deliveryDiscountCents,
    taxCents: row.taxCents,
    tipCents: row.tipCents,
    totalCents: row.totalCents,
    refundedCents: row.refundedCents,
    paymentMethod: row.paymentMethod === 'CARD' ? ('card' as const) : ('cash' as const),
    paymentStatus: row.paymentStatus,
    card: row.cardBrand && row.cardLast4 ? cardLabel(row.cardBrand, row.cardLast4) : null,
    deliveredTo: row.addressText,
    kitchenNote: row.note,
  }));
}
