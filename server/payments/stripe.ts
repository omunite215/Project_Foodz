import 'server-only';
import { Stripe } from 'stripe';
import { logger } from '@/server/logger';

/*
 * Everything Foodz asks of Stripe, behind one small interface. The rest of the server never
 * touches Stripe's objects: they are reduced here to the few fields checkout, the webhook and
 * saved cards use. Tests swap in a fake with `setPaymentGatewayForTests`, so no test calls the
 * real API unless it opts in.
 *
 * Card data never passes through here: the browser sends it straight to Stripe (Elements).
 */

export type IntentStatus =
  | 'requires_payment_method'
  | 'requires_confirmation'
  | 'requires_action'
  | 'processing'
  | 'requires_capture'
  | 'canceled'
  | 'succeeded';

export interface CardDetails {
  /** Stripe's brand key: visa, mastercard, amex, ... */
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  /** The same card number gives the same fingerprint; used to merge duplicates. */
  fingerprint: string | null;
}

export interface IntentState {
  id: string;
  status: IntentStatus;
  amountCents: number;
  amountReceivedCents: number;
  currency: string;
  metadata: Record<string, string>;
  customerId: string | null;
  paymentMethodId: string | null;
  card: CardDetails | null;
  /** Set when the card should be saved for later (setup_future_usage = on_session). */
  saveCard: boolean;
  /** The last decline or bank-check failure, if any. */
  lastError: { code: string | null; declineCode: string | null } | null;
  /** On the latest charge: how much has been refunded so far. */
  refundedCents: number;
  /** Returned to the paying customer only; never logged or stored. */
  clientSecret: string | null;
}

/** Where the order is delivered and who takes it, from the order's own snapshot (S2.10). */
export interface ShippingDetails {
  name: string;
  line1: string;
  line2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
}

export interface CreateIntentInput {
  amountCents: number;
  orderId: string;
  orderNumber: string;
  /** This database's tag (B6): the webhook ignores events carrying another one. */
  instance: string;
  /**
   * A payment in USD on a Stripe account registered outside the US counts as an export there
   * (India, for one), and the bank refuses it unless the PaymentIntent names the customer, their
   * address and what was bought. The delivery address is that address.
   */
  shipping?: ShippingDetails;
  /** Set when paying with a saved card or saving a new one. */
  customerId?: string;
  /** A saved card, already checked to belong to `customerId`. */
  paymentMethodId?: string;
  saveCard: boolean;
  /** Same key, same PaymentIntent: a retried request never makes a second one. */
  idempotencyKey: string;
}

export interface UpdateIntentInput {
  customerId?: string;
  paymentMethodId?: string;
  saveCard: boolean;
}

export interface SavedCardRecord extends CardDetails {
  id: string;
  createdAt: Date;
}

export interface RefundRecord {
  id: string;
  amountCents: number;
  status: 'pending' | 'requires_action' | 'succeeded' | 'failed' | 'canceled';
}

export interface PaymentGateway {
  createIntent(input: CreateIntentInput): Promise<IntentState>;
  retrieveIntent(id: string): Promise<IntentState>;
  updateIntent(id: string, input: UpdateIntentInput): Promise<IntentState>;
  /** Cancels when Stripe still can; otherwise returns the PaymentIntent as it is. */
  cancelIntent(id: string): Promise<IntentState>;
  refund(input: {
    paymentIntentId: string;
    amountCents: number;
    reason: string;
    orderId: string;
    idempotencyKey: string;
  }): Promise<RefundRecord>;
  createCustomer(input: {
    userId: string;
    instance: string;
    idempotencyKey: string;
  }): Promise<string>;
  deleteCustomer(customerId: string): Promise<void>;
  listCards(customerId: string): Promise<SavedCardRecord[]>;
  /** A card and the customer it belongs to; null when it doesn't exist. */
  retrieveCard(
    paymentMethodId: string,
  ): Promise<(SavedCardRecord & { customerId: string | null }) | null>;
  detachCard(paymentMethodId: string): Promise<void>;
}

/** Stripe could not be reached or refused the request for a reason other than the card. */
export class PaymentProviderError extends Error {
  constructor(
    message: string,
    readonly kind: 'unavailable' | 'invalid',
  ) {
    super(message);
    this.name = 'PaymentProviderError';
  }
}

// ------------------------------------------------------------------ configuration

export interface StripeSettings {
  /** Card payments work on this machine: a secret key is set. */
  configured: boolean;
  /** The keys are Stripe test-mode keys ("Test mode: no real money moves", S6.2). */
  testMode: boolean;
  /** For Stripe.js in the browser; null when not set. */
  publishableKey: string | null;
}

export function stripeSettings(
  env: Record<string, string | undefined> = process.env,
): StripeSettings {
  const secret = env.STRIPE_SECRET_KEY ?? '';
  const publishable = env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';
  const configured = secret.startsWith('sk_') && publishable.startsWith('pk_');
  return {
    configured,
    testMode: configured && secret.startsWith('sk_test_') && publishable.startsWith('pk_test_'),
    publishableKey: configured ? publishable : null,
  };
}

// ------------------------------------------------------------------ the real gateway

let override: PaymentGateway | null | undefined;
let client: Stripe | undefined;

/** Tests only: a fake gateway, or null for "Stripe isn't set up". Undefined restores the real one. */
export function setPaymentGatewayForTests(gateway: PaymentGateway | null | undefined) {
  override = gateway;
}

/** The gateway, or null when card payments aren't set up on this machine. */
export function paymentGateway(): PaymentGateway | null {
  if (override !== undefined) return override;
  if (!stripeSettings().configured) return null;
  client ??= new Stripe(process.env.STRIPE_SECRET_KEY ?? '', {
    maxNetworkRetries: 2,
    timeout: 10_000,
  });
  return stripeGateway(client);
}

const idOf = (value: string | { id: string } | null | undefined) =>
  value === null || value === undefined ? null : typeof value === 'string' ? value : value.id;

function cardOf(method: Stripe.PaymentMethod | null): CardDetails | null {
  const card = method?.card;
  if (!card) return null;
  return {
    brand: card.brand,
    last4: card.last4,
    expMonth: card.exp_month,
    expYear: card.exp_year,
    fingerprint: card.fingerprint ?? null,
  };
}

function cardFromCharge(charge: Stripe.Charge | null): CardDetails | null {
  const card = charge?.payment_method_details?.card;
  if (!card) return null;
  return {
    brand: card.brand ?? 'card',
    last4: card.last4 ?? '0000',
    expMonth: card.exp_month,
    expYear: card.exp_year,
    fingerprint: card.fingerprint ?? null,
  };
}

function intentState(intent: Stripe.PaymentIntent): IntentState {
  const charge = typeof intent.latest_charge === 'object' ? intent.latest_charge : null;
  const method = typeof intent.payment_method === 'object' ? intent.payment_method : null;
  const error = intent.last_payment_error;
  return {
    id: intent.id,
    status: intentStatus(intent.status),
    amountCents: intent.amount,
    amountReceivedCents: intent.amount_received,
    currency: intent.currency,
    metadata: { ...intent.metadata },
    customerId: idOf(intent.customer),
    paymentMethodId: idOf(intent.payment_method),
    card: cardOf(method) ?? cardFromCharge(charge),
    saveCard: intent.setup_future_usage === 'on_session',
    lastError: error ? { code: error.code ?? null, declineCode: error.decline_code ?? null } : null,
    refundedCents: charge?.amount_refunded ?? 0,
    clientSecret: intent.client_secret,
  };
}

function savedCard(method: Stripe.PaymentMethod): SavedCardRecord | null {
  const card = cardOf(method);
  return card ? { id: method.id, createdAt: new Date(method.created * 1000), ...card } : null;
}

const EXPAND = ['latest_charge', 'payment_method'];

const STATUSES: readonly IntentStatus[] = [
  'requires_payment_method',
  'requires_confirmation',
  'requires_action',
  'processing',
  'requires_capture',
  'canceled',
  'succeeded',
];

const REFUND_STATUSES: readonly RefundRecord['status'][] = [
  'pending',
  'requires_action',
  'succeeded',
  'failed',
  'canceled',
];

const refundStatus = (value: string | null): RefundRecord['status'] =>
  REFUND_STATUSES.find((status) => status === value) ?? 'pending';

/** A status this code doesn't know yet is treated as still waiting. */
export const intentStatus = (value: string): IntentStatus =>
  STATUSES.find((status) => status === value) ?? 'requires_confirmation';

/** Network trouble and Stripe's own outages are worth retrying; anything else is our mistake. */
function providerError(error: unknown, what: string): PaymentProviderError {
  if (error instanceof Stripe.errors.StripeError) {
    const retryable =
      error instanceof Stripe.errors.StripeConnectionError ||
      error instanceof Stripe.errors.StripeAPIError ||
      error instanceof Stripe.errors.StripeRateLimitError;
    logger.warn({ type: error.type, stripeCode: error.code, what }, 'stripe request failed');
    return new PaymentProviderError(`Stripe ${what} failed`, retryable ? 'unavailable' : 'invalid');
  }
  return new PaymentProviderError(`Stripe ${what} failed`, 'unavailable');
}

async function call<T>(what: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw providerError(error, what);
  }
}

function stripeGateway(stripe: Stripe): PaymentGateway {
  const retrieveIntent = (id: string) =>
    call('retrieve', async () =>
      intentState(await stripe.paymentIntents.retrieve(id, { expand: EXPAND })),
    );

  return {
    createIntent: (input) =>
      call('create', async () =>
        intentState(
          await stripe.paymentIntents.create(
            {
              amount: input.amountCents,
              currency: 'usd',
              allowed_payment_method_types: ['card'],
              description: `Foodz order ${input.orderNumber}`,
              ...(input.shipping && {
                shipping: {
                  name: input.shipping.name,
                  address: {
                    line1: input.shipping.line1,
                    ...(input.shipping.line2 && { line2: input.shipping.line2 }),
                    ...(input.shipping.city && { city: input.shipping.city }),
                    ...(input.shipping.state && { state: input.shipping.state }),
                    ...(input.shipping.postalCode && { postal_code: input.shipping.postalCode }),
                    country: 'US',
                  },
                },
              }),
              metadata: {
                orderId: input.orderId,
                orderNumber: input.orderNumber,
                instance: input.instance,
              },
              ...(input.customerId && { customer: input.customerId }),
              ...(input.paymentMethodId && { payment_method: input.paymentMethodId }),
              ...(input.saveCard && { setup_future_usage: 'on_session' as const }),
              expand: EXPAND,
            },
            { idempotencyKey: input.idempotencyKey },
          ),
        ),
      ),

    retrieveIntent,

    updateIntent: (id, input) =>
      call('update', async () =>
        intentState(
          await stripe.paymentIntents.update(id, {
            ...(input.customerId && { customer: input.customerId }),
            ...(input.paymentMethodId && { payment_method: input.paymentMethodId }),
            setup_future_usage: input.saveCard ? 'on_session' : '',
            expand: EXPAND,
          }),
        ),
      ),

    async cancelIntent(id) {
      try {
        return intentState(await stripe.paymentIntents.cancel(id, { expand: EXPAND }));
      } catch (error) {
        // Already succeeded, processing or canceled: report where it stands instead.
        if (
          error instanceof Stripe.errors.StripeInvalidRequestError &&
          error.code === 'payment_intent_unexpected_state'
        ) {
          return retrieveIntent(id);
        }
        throw providerError(error, 'cancel');
      }
    },

    refund: (input) =>
      call('refund', async () => {
        const refund = await stripe.refunds.create(
          {
            payment_intent: input.paymentIntentId,
            amount: input.amountCents,
            reason: 'requested_by_customer',
            metadata: { orderId: input.orderId, reason: input.reason },
          },
          { idempotencyKey: input.idempotencyKey },
        );
        return { id: refund.id, amountCents: refund.amount, status: refundStatus(refund.status) };
      }),

    createCustomer: (input) =>
      call('customer', async () => {
        const customer = await stripe.customers.create(
          { metadata: { userId: input.userId, instance: input.instance } },
          { idempotencyKey: input.idempotencyKey },
        );
        return customer.id;
      }),

    deleteCustomer: (customerId) =>
      call('customer delete', async () => {
        try {
          await stripe.customers.del(customerId);
        } catch (error) {
          // Already gone is what we wanted.
          if (
            error instanceof Stripe.errors.StripeInvalidRequestError &&
            error.code === 'resource_missing'
          ) {
            return;
          }
          throw error;
        }
      }),

    listCards: (customerId) =>
      call('cards', async () => {
        const list = await stripe.customers.listPaymentMethods(customerId, {
          type: 'card',
          limit: 20,
        });
        return list.data.flatMap((method) => {
          const card = savedCard(method);
          return card ? [card] : [];
        });
      }),

    retrieveCard: (paymentMethodId) =>
      call('card', async () => {
        try {
          const method = await stripe.paymentMethods.retrieve(paymentMethodId);
          const card = savedCard(method);
          return card ? { ...card, customerId: idOf(method.customer) } : null;
        } catch (error) {
          if (
            error instanceof Stripe.errors.StripeInvalidRequestError &&
            error.code === 'resource_missing'
          ) {
            return null;
          }
          throw error;
        }
      }),

    detachCard: (paymentMethodId) =>
      call('detach', async () => {
        await stripe.paymentMethods.detach(paymentMethodId);
      }),
  };
}

// ------------------------------------------------------------------ webhooks

/**
 * Checks the Stripe-Signature header against the raw body and returns the parsed event. Throws
 * when the signature is missing, wrong or too old (5 minutes), or the secret isn't set.
 */
export function verifyStripeEvent(
  rawBody: string,
  signature: string | null,
  secret = process.env.STRIPE_WEBHOOK_SECRET,
): unknown {
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET is not set');
  if (!signature) throw new Error('missing Stripe-Signature header');
  return Stripe.webhooks.constructEvent(rawBody, signature, secret);
}
