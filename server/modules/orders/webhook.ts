import 'server-only';
import { z } from 'zod';
import { logger } from '@/server/logger';
import { getInstanceTag } from '@/server/modules/payments/service';
import {
  chargeObjectSchema,
  disputeObjectSchema,
  HANDLED_EVENTS,
  type HandledEvent,
  intentObjectSchema,
  stripeEventSchema,
  type WebhookOutcome,
} from '@/server/modules/payments/schema';
import {
  type IntentState,
  intentStatus,
  paymentGateway,
  verifyStripeEvent,
} from '@/server/payments/stripe';
import { applyDispute, applyIntent, applyRefund } from './payment-sync';

/*
 * POST /api/webhooks/stripe (B6). The signature is checked on the raw body before anything is
 * read; each event id is applied once, in the same transaction as the change it makes; events
 * from another machine sharing the Stripe test account, or for orders this database doesn't
 * hold, are answered 200 and change nothing (S10.7). Slow work (emails, refunds) goes to jobs.
 */

export interface WebhookResult {
  status: 200 | 400;
  outcome: WebhookOutcome | 'bad-signature' | 'bad-payload' | 'not-configured';
}

const isHandled = (type: string): type is HandledEvent =>
  (HANDLED_EVENTS as readonly string[]).includes(type);

const idOf = (value: string | { id: string } | null | undefined) =>
  typeof value === 'string' ? value : (value?.id ?? null);

const reference = z.union([z.string(), z.object({ id: z.string() }).loose()]).nullish();

/** The optional parts of an event's PaymentIntent the webhook reads. */
const intentExtrasSchema = z
  .object({
    last_payment_error: z
      .object({ code: z.string().nullish(), decline_code: z.string().nullish() })
      .loose()
      .nullish(),
    customer: reference,
    payment_method: reference,
    setup_future_usage: z.string().nullish(),
  })
  .loose();

/** The event's own copy of the PaymentIntent, as the gateway would describe it. */
function intentFromEvent(object: unknown): IntentState | null {
  const parsed = intentObjectSchema.safeParse(object);
  const extras = intentExtrasSchema.safeParse(object);
  if (!parsed.success || !extras.success) return null;
  const raw = extras.data;
  const intent = parsed.data;
  return {
    id: intent.id,
    status: intentStatus(intent.status),
    amountCents: intent.amount,
    amountReceivedCents: intent.amount_received,
    currency: intent.currency,
    metadata: intent.metadata,
    customerId: idOf(raw.customer),
    paymentMethodId: idOf(raw.payment_method),
    card: null,
    saveCard: raw.setup_future_usage === 'on_session',
    lastError: raw.last_payment_error
      ? {
          code: raw.last_payment_error.code ?? null,
          declineCode: raw.last_payment_error.decline_code ?? null,
        }
      : null,
    refundedCents: 0,
    clientSecret: null,
  };
}

/**
 * The PaymentIntent as Stripe holds it now, with the card label, when Stripe answers; the
 * event's copy otherwise. Asking keeps out-of-order events from deciding anything (S10.3).
 */
async function currentIntent(fromEvent: IntentState): Promise<IntentState> {
  const gateway = paymentGateway();
  if (!gateway) return fromEvent;
  try {
    return await gateway.retrieveIntent(fromEvent.id);
  } catch (error) {
    logger.warn({ err: error }, 'stripe webhook: using the event copy of the payment');
    return fromEvent;
  }
}

export async function handleStripeWebhook(
  rawBody: string,
  signature: string | null,
): Promise<WebhookResult> {
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    logger.error('stripe webhook received but STRIPE_WEBHOOK_SECRET is not set');
    return { status: 400, outcome: 'not-configured' };
  }
  let verified: unknown;
  try {
    verified = verifyStripeEvent(rawBody, signature);
  } catch {
    // Alerted on: a spike means someone is probing the endpoint or the secret is stale.
    logger.warn({ alert: 'stripe-webhook-signature' }, 'stripe webhook signature check failed');
    return { status: 400, outcome: 'bad-signature' };
  }
  const envelope = stripeEventSchema.safeParse(verified);
  if (!envelope.success) {
    logger.warn('stripe webhook payload not understood');
    return { status: 400, outcome: 'bad-payload' };
  }
  const { id, type, data } = envelope.data;
  if (!isHandled(type)) return { status: 200, outcome: 'ignored-type' };
  const event = { id, type };
  const object: unknown = data.object;

  switch (type) {
    case 'payment_intent.succeeded':
    case 'payment_intent.payment_failed':
    case 'payment_intent.canceled': {
      const fromEvent = intentFromEvent(object);
      if (!fromEvent) return { status: 400, outcome: 'bad-payload' };
      if (fromEvent.metadata.instance !== (await getInstanceTag())) {
        return { status: 200, outcome: 'other-instance' };
      }
      const intent = await currentIntent(fromEvent);
      const { outcome } = await applyIntent(intent, { source: 'stripe', event });
      return { status: 200, outcome };
    }
    case 'charge.refunded': {
      const charge = chargeObjectSchema.safeParse(object);
      if (!charge.success) return { status: 400, outcome: 'bad-payload' };
      if (!charge.data.payment_intent) return { status: 200, outcome: 'unknown-order' };
      const instance = charge.data.metadata.instance;
      if (instance && instance !== (await getInstanceTag())) {
        return { status: 200, outcome: 'other-instance' };
      }
      const outcome = await applyRefund({
        paymentIntentId: charge.data.payment_intent,
        refundedCents: charge.data.amount_refunded,
        chargedCents: charge.data.amount,
        event,
      });
      return { status: 200, outcome };
    }
    case 'charge.dispute.created':
    case 'charge.dispute.closed':
    default: {
      const dispute = disputeObjectSchema.safeParse(object);
      if (!dispute.success) return { status: 400, outcome: 'bad-payload' };
      if (!dispute.data.payment_intent) return { status: 200, outcome: 'unknown-order' };
      const outcome = await applyDispute({
        paymentIntentId: dispute.data.payment_intent,
        phase: type === 'charge.dispute.created' ? 'created' : 'closed',
        status: dispute.data.status,
        event,
      });
      return { status: 200, outcome };
    }
  }
}
