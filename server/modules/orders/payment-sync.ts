import 'server-only';
import { z } from 'zod';
import { type DbContext, runAsSystem } from '@/server/db/context';
import { logger } from '@/server/logger';
import { audit } from '@/server/modules/audit/service';
import { getStoreStatus } from '@/server/modules/menu/service';
import {
  getInstanceTag,
  recordWebhookEvent,
  requireGateway,
} from '@/server/modules/payments/service';
import type { WebhookOutcome } from '@/server/modules/payments/schema';
import { type IntentState, paymentGateway } from '@/server/payments/stripe';
import { redis, waitUntilReady } from '@/server/redis';
import { type OrderEffect, runEffects } from './effects';
import type { OrderEmailKind } from './emails';
import {
  addEvent,
  allDishesAvailable,
  attemptKeyTaken,
  countCustomerUses,
  findCustomer,
  findDueUnpaid,
  findEvents,
  findOrderForPayment,
  findOrderIdByIntent,
  findRedemption,
  findUnsettledRefunds,
  forceCouponUse,
  lockCouponLimits,
  lockCustomerOrders,
  lockOrder,
  type OrderPaymentRow,
  returnCouponUse,
  setPaymentIntent,
  setRedemptionStatus,
  updateOrder,
} from './repo';
import { codeStillFits, decideExpiry, decideLatePayment, decidePayment } from './state';

/*
 * One idempotent step for everything Stripe says about a payment (B6, B7): the webhook, the
 * order page's direct check, the expiry job and the refund job all end up here. Each runs in a
 * transaction that locks the order row, decides with the pure rules in state.ts, writes the
 * change and its timeline entry, and returns follow-ups (emails, refunds) that run only after
 * the commit. Whichever path gets there first acts; the others find nothing left to do.
 */

type Source = 'stripe' | 'check' | 'expiry' | 'customer' | 'refund-job';

interface StepResult {
  outcome: WebhookOutcome;
  effects: OrderEffect[];
}

const UNCHANGED: StepResult = { outcome: 'unchanged', effects: [] };
const orderIdSchema = z.uuid();
/** The cancellation's timeline entry says whether its email already promised the refund (D45). */
const announcedSchema = z.object({ refundAnnounced: z.boolean().optional() });

async function startStep(
  ctx: DbContext,
  event: { id: string; type: string } | undefined,
): Promise<boolean> {
  return event ? recordWebhookEvent(ctx, event.id, event.type) : true;
}

// ------------------------------------------------------------------ codes

async function redeemCode(ctx: DbContext, orderId: string) {
  const redemption = await findRedemption(ctx, orderId);
  if (redemption?.status === 'RESERVED') await setRedemptionStatus(ctx, orderId, 'REDEEMED');
}

async function releaseCode(ctx: DbContext, orderId: string) {
  const redemption = await findRedemption(ctx, orderId);
  if (!redemption || redemption.status === 'RELEASED') return;
  await setRedemptionStatus(ctx, orderId, 'RELEASED');
  await returnCouponUse(ctx, redemption.couponId);
}

/**
 * The order's code as a late payment finds it (security S11). A use that was given back is read
 * under the code's row lock; this customer's other uses are stable under the customer's order
 * lock, which the payment step already holds.
 */
async function lateCodeFacts(ctx: DbContext, order: OrderPaymentRow) {
  const redemption = await findRedemption(ctx, order.id);
  if (!redemption) return null;
  if (redemption.status !== 'RELEASED') {
    return { released: false, customerUses: 0, perUserLimit: null, usedCount: 0, usageLimit: null };
  }
  const limits = await lockCouponLimits(ctx, redemption.couponId);
  if (!limits) return null;
  const customerUses =
    limits.perUserLimit === null
      ? 0
      : await countCustomerUses(ctx, redemption.couponId, order.userId);
  return { released: true, customerUses, ...limits };
}

/** U10: a revived order keeps its code at the price paid, even past the code's limit. */
async function honourCode(ctx: DbContext, orderId: string) {
  const redemption = await findRedemption(ctx, orderId);
  if (!redemption) return;
  if (redemption.status === 'RELEASED') {
    await forceCouponUse(ctx, redemption.couponId);
    const { usageLimit, usedCount } = redemption.coupon;
    if (usageLimit !== null && usedCount + 1 > usageLimit) {
      logger.warn({ orderId }, 'late payment kept its code past the usage limit');
    }
  }
  if (redemption.status !== 'REDEEMED') await setRedemptionStatus(ctx, orderId, 'REDEEMED');
}

// ------------------------------------------------------------------ PaymentIntents

const cardChange = (intent: IntentState) => ({
  cardBrand: intent.card?.brand ?? null,
  cardLast4: intent.card?.last4 ?? null,
  stripePaymentMethodId: intent.paymentMethodId,
});

async function decideAndApply(
  ctx: DbContext,
  order: OrderPaymentRow,
  intent: IntentState,
  source: Source,
  facts: { storeOpen: boolean; now: Date },
): Promise<StepResult> {
  const decision = decidePayment(order, intent);
  const { now } = facts;
  const actor = { actor: source };

  switch (decision.kind) {
    case 'place': {
      await updateOrder(ctx, order.id, order.version, {
        status: 'PLACED',
        paymentStatus: 'PAID',
        placedAt: now,
        ...cardChange(intent),
      });
      await redeemCode(ctx, order.id);
      await addEvent(ctx, {
        orderId: order.id,
        type: 'paid',
        data: { ...actor, amountCents: intent.amountReceivedCents },
      });
      await addEvent(ctx, {
        orderId: order.id,
        type: 'placed',
        fromStatus: 'PENDING_PAYMENT',
        toStatus: 'PLACED',
        data: { ...actor, method: 'card' },
      });
      const effects: OrderEffect[] = [
        { kind: 'email', orderId: order.id, email: 'receipt', change: 'placed' },
      ];
      if (intent.saveCard && intent.customerId && intent.paymentMethodId) {
        effects.push({
          kind: 'keepCard',
          customerId: intent.customerId,
          paymentMethodId: intent.paymentMethodId,
          fingerprint: intent.card?.fingerprint ?? null,
        });
      }
      return { outcome: 'applied', effects };
    }

    case 'fail': {
      await updateOrder(ctx, order.id, order.version, { status: 'FAILED' });
      await releaseCode(ctx, order.id);
      await addEvent(ctx, {
        orderId: order.id,
        type: 'payment-failed',
        fromStatus: 'PENDING_PAYMENT',
        toStatus: 'FAILED',
        data: { ...actor, code: decision.decline.code, declineCode: decision.decline.declineCode },
      });
      const effects: OrderEffect[] = [];
      if (intent.status !== 'canceled') {
        effects.push({ kind: 'cancelIntent', paymentIntentId: intent.id });
        effects.push({ kind: 'decline', userId: order.userId, paymentIntentId: intent.id });
      }
      return { outcome: 'applied', effects };
    }

    case 'late': {
      const keyFree =
        !order.attemptKey ||
        !(await attemptKeyTaken(ctx, order.userId, order.attemptKey, order.id));
      const account = await findCustomer(ctx, order.userId);
      const code = await lateCodeFacts(ctx, order);
      const verdict = decideLatePayment({
        dishesAvailable: await allDishesAvailable(ctx, order.id),
        storeOpen: facts.storeOpen,
        attemptKeyFree: keyFree,
        accountActive: Boolean(account && !account.deletedAt && !account.banned),
        codeFits: codeStillFits(code, order.status === 'FAILED' ? 'declined' : 'expired'),
      });
      if (verdict === 'revive') {
        await updateOrder(ctx, order.id, order.version, {
          status: 'PLACED',
          paymentStatus: 'PAID',
          placedAt: now,
          cancelledAt: null,
          cancelReason: null,
          ...cardChange(intent),
        });
        await honourCode(ctx, order.id);
        await addEvent(ctx, {
          orderId: order.id,
          type: 'revived',
          fromStatus: order.status,
          toStatus: 'PLACED',
          data: { ...actor, amountCents: intent.amountReceivedCents },
        });
        logger.warn({ orderId: order.id }, 'late payment: order placed after all');
        return {
          outcome: 'applied',
          effects: [{ kind: 'email', orderId: order.id, email: 'receipt-late', change: 'revived' }],
        };
      }
      await updateOrder(ctx, order.id, order.version, {
        paymentStatus: 'PAID',
        autoRefundReason: 'late-payment',
        ...cardChange(intent),
      });
      await addEvent(ctx, {
        orderId: order.id,
        type: 'late-payment',
        data: { ...actor, amountCents: intent.amountReceivedCents, refund: true },
      });
      logger.warn({ orderId: order.id }, 'late payment: refunding in full');
      return { outcome: 'applied', effects: [{ kind: 'refund', orderId: order.id }] };
    }

    case 'refundUnwanted': {
      await updateOrder(ctx, order.id, order.version, {
        paymentStatus: 'PAID',
        autoRefundReason: 'customer-cancel',
        ...cardChange(intent),
      });
      await addEvent(ctx, {
        orderId: order.id,
        type: 'late-payment',
        data: { ...actor, amountCents: intent.amountReceivedCents, refund: true },
      });
      return { outcome: 'applied', effects: [{ kind: 'refund', orderId: order.id }] };
    }

    case 'mismatch': {
      await updateOrder(ctx, order.id, order.version, {
        ...(order.status === 'PENDING_PAYMENT' && { status: 'FAILED' as const }),
        paymentStatus: 'PAID',
        autoRefundReason: 'mismatch',
        ...cardChange(intent),
      });
      await releaseCode(ctx, order.id);
      await addEvent(ctx, {
        orderId: order.id,
        type: 'mismatch',
        data: {
          ...actor,
          amountReceivedCents: intent.amountReceivedCents,
          currency: intent.currency,
          expectedCents: order.totalCents,
        },
      });
      logger.error(
        { orderId: order.id, received: intent.amountReceivedCents, expected: order.totalCents },
        'stripe payment does not match its order; refunding',
      );
      return { outcome: 'applied', effects: [{ kind: 'refund', orderId: order.id }] };
    }

    case 'none':
    default:
      if (order.paymentStatus === 'PAID' && !order.cardBrand && intent.card) {
        await updateOrder(ctx, order.id, order.version, cardChange(intent));
      }
      return UNCHANGED;
  }
}

/**
 * Applies what a PaymentIntent says to its order. Payments from another machine sharing the
 * Stripe test account, or for an order this database doesn't hold, change nothing (S10.7).
 */
export async function applyIntent(
  intent: IntentState,
  options: { source: Source; event?: { id: string; type: string }; now?: Date },
): Promise<{ outcome: WebhookOutcome; orderId: string | null }> {
  const now = options.now ?? new Date();
  if (intent.metadata.instance !== (await getInstanceTag())) {
    return { outcome: 'other-instance', orderId: null };
  }
  const parsedId = orderIdSchema.safeParse(intent.metadata.orderId);
  if (!parsedId.success) return { outcome: 'unknown-order', orderId: null };
  const orderId = parsedId.data;
  const storeOpen = (await getStoreStatus(now)).isOpen;

  const result = await runAsSystem('stripe payment', async (ctx): Promise<StepResult> => {
    if (!(await startStep(ctx, options.event))) return { outcome: 'duplicate', effects: [] };
    const owner = await findOrderForPayment(ctx, orderId);
    if (!owner) return { outcome: 'unknown-order', effects: [] };
    // Checkout and account deletion hold the same lock, so a payment never lands beside either
    // (B21). Taken before the order row, in the same order as checkout, so they can't deadlock.
    await lockCustomerOrders(ctx, owner.userId);
    const order = await lockOrder(ctx, orderId);
    if (!order || (order.stripePaymentIntentId && order.stripePaymentIntentId !== intent.id)) {
      return { outcome: 'unknown-order', effects: [] };
    }
    if (!order.stripePaymentIntentId) await setPaymentIntent(ctx, order.id, intent.id);
    return decideAndApply(ctx, order, intent, options.source, { storeOpen, now });
  });
  await runEffects(result.effects);
  return { outcome: result.outcome, orderId };
}

// ------------------------------------------------------------------ refunds and disputes

function refundEmail(reason: string | null, announced: boolean): OrderEmailKind | null {
  switch (reason) {
    case 'late-payment':
      return 'late-refund';
    case 'mismatch':
      return 'mismatch-refund';
    // D45: her own cancellation already said the money is coming back.
    case 'customer-cancel':
      return announced ? null : 'refunded';
    default:
      return 'refunded';
  }
}

/**
 * Stripe's refunded total for a payment (S10.1): REFUNDED or PARTIALLY_REFUNDED, a timeline
 * entry and one email per refund. Older or repeated totals change nothing.
 */
export async function applyRefund(input: {
  paymentIntentId: string;
  refundedCents: number;
  chargedCents: number;
  event?: { id: string; type: string };
  now?: Date;
}): Promise<WebhookOutcome> {
  const now = input.now ?? new Date();
  const found = await runAsSystem('stripe refund', (ctx) =>
    findOrderIdByIntent(ctx, input.paymentIntentId),
  );
  if (!found) return 'unknown-order';

  // A refund can arrive before the success it refunds (S10.3): catch up with Stripe first.
  const before = await runAsSystem('stripe refund', (ctx) => findOrderForPayment(ctx, found.id));
  const gateway = paymentGateway();
  if (before?.status === 'PENDING_PAYMENT' && gateway) {
    await applyIntent(await gateway.retrieveIntent(input.paymentIntentId), {
      source: 'stripe',
      now,
    });
  }

  const result = await runAsSystem('stripe refund', async (ctx): Promise<StepResult> => {
    if (!(await startStep(ctx, input.event))) return { outcome: 'duplicate', effects: [] };
    const order = await lockOrder(ctx, found.id);
    if (!order || input.refundedCents <= order.refundedCents) return UNCHANGED;
    const delta = input.refundedCents - order.refundedCents;
    await updateOrder(ctx, order.id, order.version, {
      refundedCents: input.refundedCents,
      paymentStatus: input.refundedCents >= input.chargedCents ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
    });
    await addEvent(ctx, {
      orderId: order.id,
      type: 'refunded',
      data: { amountCents: delta, totalRefundedCents: input.refundedCents },
    });
    const cancellations = await findEvents(ctx, order.id, 'cancelled');
    const announced = cancellations.some(
      (event) => announcedSchema.safeParse(event.data).data?.refundAnnounced === true,
    );
    const email = refundEmail(order.autoRefundReason, announced);
    return {
      outcome: 'applied',
      effects: email
        ? [
            {
              kind: 'email',
              orderId: order.id,
              email,
              change: `refund-${input.refundedCents}`,
              refundCents: delta,
              at: now.toISOString(),
            },
          ]
        : [],
    };
  });
  await runEffects(result.effects);
  return result.outcome;
}

/** A dispute opened or closed by the customer's bank (S10.1, S10.6). Nothing is emailed. */
export async function applyDispute(input: {
  paymentIntentId: string;
  phase: 'created' | 'closed';
  status: string;
  event?: { id: string; type: string };
  now?: Date;
}): Promise<WebhookOutcome> {
  const now = input.now ?? new Date();
  const found = await runAsSystem('stripe dispute', (ctx) =>
    findOrderIdByIntent(ctx, input.paymentIntentId),
  );
  if (!found) return 'unknown-order';
  const result = await runAsSystem('stripe dispute', async (ctx): Promise<StepResult> => {
    if (!(await startStep(ctx, input.event))) return { outcome: 'duplicate', effects: [] };
    const order = await lockOrder(ctx, found.id);
    if (!order) return UNCHANGED;
    if (input.phase === 'created') {
      await updateOrder(ctx, order.id, order.version, {
        disputeStatus: 'OPEN',
        disputeOpenedAt: now,
        disputeClosedAt: null,
      });
      await addEvent(ctx, {
        orderId: order.id,
        type: 'dispute-opened',
        data: { status: input.status },
      });
    } else {
      const disputeStatus =
        input.status === 'won' ? 'WON' : input.status === 'lost' ? 'LOST' : ('NONE' as const);
      await updateOrder(ctx, order.id, order.version, { disputeStatus, disputeClosedAt: now });
      await addEvent(ctx, {
        orderId: order.id,
        type: 'dispute-closed',
        data: { status: input.status },
      });
    }
    logger.warn({ orderId: order.id, phase: input.phase, status: input.status }, 'card dispute');
    return { outcome: 'applied', effects: [] };
  });
  return result.outcome;
}

/**
 * The refund job: refunds what Stripe holds for a payment Foodz decided to give back
 * (cancellation, late payment, mismatch), once, and records it. Audited with the amount.
 */
export async function processAutoRefund(
  orderId: string,
  now = new Date(),
): Promise<'refunded' | 'none'> {
  const order = await runAsSystem('refund', (ctx) => findOrderForPayment(ctx, orderId));
  if (!order?.autoRefundReason || !order.stripePaymentIntentId) return 'none';
  if (order.paymentStatus === 'REFUNDED') return 'none';
  const gateway = requireGateway();
  const intent = await gateway.retrieveIntent(order.stripePaymentIntentId);
  const remaining = intent.amountReceivedCents - intent.refundedCents;
  let refunded = intent.refundedCents;
  if (remaining > 0) {
    const refund = await gateway.refund({
      paymentIntentId: intent.id,
      amountCents: remaining,
      reason: order.autoRefundReason,
      orderId,
      idempotencyKey: `refund-${orderId}-${order.autoRefundReason}`,
    });
    await runAsSystem('refund', (ctx) =>
      audit(ctx, {
        action: 'order.refund-issued',
        targetType: 'order',
        targetId: orderId,
        data: { amountCents: remaining, reason: order.autoRefundReason, status: refund.status },
      }),
    );
    if (refund.status === 'failed' || refund.status === 'canceled') {
      logger.error({ orderId }, 'automatic refund failed');
      throw new Error('The refund did not go through.');
    }
    if (refund.status === 'succeeded') refunded += refund.amountCents;
  }
  if (refunded > order.refundedCents) {
    await applyRefund({
      paymentIntentId: intent.id,
      refundedCents: refunded,
      chargedCents: intent.amountReceivedCents,
      now,
    });
  }
  return 'refunded';
}

// ------------------------------------------------------------------ expiry (B8) and the direct check (B7)

/** Cancels an unpaid card order once its time is up, unless Stripe already has the money. */
export async function expireUnpaidOrder(
  orderId: string,
  now = new Date(),
  reason: 'payment-expired' | 'account-deleted' = 'payment-expired',
): Promise<'none' | 'notYet' | 'expired' | 'paid' | 'wait'> {
  const order = await runAsSystem('expiry', (ctx) => findOrderForPayment(ctx, orderId));
  if (!order || order.status !== 'PENDING_PAYMENT') return 'none';
  const deadline = reason === 'account-deleted' ? null : order.expiresAt;
  const gateway = paymentGateway();
  const due = { status: order.status, expiresAt: deadline };
  if (decideExpiry(due, now, null) === 'notYet') return 'notYet';

  const intent =
    order.stripePaymentIntentId && gateway
      ? await gateway.cancelIntent(order.stripePaymentIntentId)
      : null;
  const decision = decideExpiry(due, now, intent);
  if (decision === 'paid' && intent) {
    await applyIntent(intent, { source: 'expiry', now });
    return 'paid';
  }
  if (decision !== 'expire') return decision === 'wait' ? 'wait' : 'none';

  return runAsSystem('expiry', async (ctx) => {
    const locked = await lockOrder(ctx, orderId);
    if (!locked || locked.status !== 'PENDING_PAYMENT') return 'none';
    await updateOrder(ctx, orderId, locked.version, {
      status: 'CANCELLED',
      cancelReason: reason,
      cancelledAt: now,
    });
    await releaseCode(ctx, orderId);
    await addEvent(ctx, {
      orderId,
      type: 'expired',
      fromStatus: 'PENDING_PAYMENT',
      toStatus: 'CANCELLED',
      data: { actor: reason === 'account-deleted' ? 'system' : 'expiry-job', reason },
    });
    return 'expired' as const;
  });
}

/** Catches unpaid orders whose expiry job was lost (every 5 minutes, B8). */
export async function sweepUnpaidOrders(now = new Date()) {
  const due = await runAsSystem('expiry sweep', (ctx) =>
    findDueUnpaid(ctx, new Date(now.getTime() - 60_000), 50),
  );
  return due.reduce<Promise<number>>(async (count, { id }) => {
    const done = await count;
    try {
      return (await expireUnpaidOrder(id, now)) === 'expired' ? done + 1 : done;
    } catch (error) {
      logger.warn({ err: error, orderId: id }, 'could not expire an unpaid order');
      return done;
    }
  }, Promise.resolve(0));
}

/** How long the refund job has before the sweep steps in. */
const REFUND_JOB_GRACE_MS = 5 * 60_000;

/**
 * Every 5 minutes: refunds Foodz decided on (cancellation, late payment, mismatch) whose job
 * was never queued or never finished. processAutoRefund reads Stripe first and uses the same
 * idempotency key as the job, so whichever runs second refunds nothing more.
 */
export async function sweepAutoRefunds(now = new Date()) {
  const due = await runAsSystem('refund sweep', (ctx) =>
    findUnsettledRefunds(ctx, new Date(now.getTime() - REFUND_JOB_GRACE_MS), 50),
  );
  return due.reduce<Promise<number>>(async (count, { id }) => {
    const done = await count;
    try {
      if ((await processAutoRefund(id, now)) !== 'refunded') return done;
      logger.warn({ orderId: id }, 'refund sweep settled a refund its job had not');
      return done + 1;
    } catch (error) {
      logger.error(
        { err: error, orderId: id, alert: 'order-refund-sweep' },
        'refund sweep could not refund an order',
      );
      return done;
    }
  }, Promise.resolve(0));
}

const CHECK_SPACING_MS = 2_000;
const CHECK_AFTER_MS = 5_000;

async function mayCheck(orderId: string) {
  try {
    await waitUntilReady();
    return (await redis.set(`order:check:${orderId}`, '1', 'PX', CHECK_SPACING_MS, 'NX')) === 'OK';
  } catch {
    return true;
  }
}

/**
 * B7: asks Stripe about a waiting card order, so the order page reaches the right state without
 * the webhook. Asked once the browser reports the payment confirmed, or 5 seconds after the
 * order was made, at most every 2 seconds per order. Stripe being unreachable changes nothing.
 */
export async function checkWithStripe(
  orderId: string,
  options: { confirmed: boolean; now?: Date },
) {
  const now = options.now ?? new Date();
  const order = await runAsSystem('payment check', (ctx) => findOrderForPayment(ctx, orderId));
  if (!order || order.status !== 'PENDING_PAYMENT') return;
  try {
    if (order.expiresAt && order.expiresAt.getTime() <= now.getTime()) {
      await expireUnpaidOrder(orderId, now);
      return;
    }
    const gateway = paymentGateway();
    if (!gateway || !order.stripePaymentIntentId) return;
    const oldEnough = now.getTime() - order.createdAt.getTime() >= CHECK_AFTER_MS;
    if (!options.confirmed && !oldEnough) return;
    if (!(await mayCheck(orderId))) return;
    await applyIntent(await gateway.retrieveIntent(order.stripePaymentIntentId), {
      source: 'check',
      now,
    });
  } catch (error) {
    logger.warn({ err: error, orderId }, 'could not check a payment with Stripe');
  }
}
