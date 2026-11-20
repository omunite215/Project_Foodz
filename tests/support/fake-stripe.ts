import { Stripe } from 'stripe';
import {
  type CardDetails,
  type CreateIntentInput,
  type IntentState,
  type PaymentGateway,
  PaymentProviderError,
  type RefundRecord,
  type SavedCardRecord,
} from '@/server/payments/stripe';

/**
 * Stripe as the tests need it: PaymentIntents, customers, saved cards and refunds kept in
 * memory, with the same idempotency rules (same key, same object). Helpers play the browser
 * and the bank: `succeed`, `decline`, `processing`. Nothing here calls Stripe.
 */

export const VISA: CardDetails = {
  brand: 'visa',
  last4: '4242',
  expMonth: 12,
  expYear: 2034,
  fingerprint: 'fp_visa_4242',
};

export const MASTERCARD: CardDetails = {
  brand: 'mastercard',
  last4: '4444',
  expMonth: 8,
  expYear: 2031,
  fingerprint: 'fp_mc_4444',
};

type StoredCard = SavedCardRecord & { customerId: string | null };

export interface FakeRefund extends RefundRecord {
  paymentIntentId: string;
  reason: string;
}

export class FakeStripe implements PaymentGateway {
  readonly intents = new Map<string, IntentState>();
  readonly customers = new Set<string>();
  readonly deletedCustomers: string[] = [];
  readonly cards = new Map<string, StoredCard>();
  readonly refunds: FakeRefund[] = [];
  readonly calls: { method: string; input?: unknown }[] = [];
  /** Methods that answer as if Stripe were unreachable. */
  readonly down = new Set<keyof PaymentGateway>();

  private readonly keys = new Map<string, string>();
  private counter = 0;

  private next(prefix: string) {
    this.counter += 1;
    return `${prefix}_fake${this.counter}${Math.random().toString(36).slice(2, 8)}`;
  }

  private track(method: keyof PaymentGateway, input?: unknown) {
    this.calls.push({ method, input });
    if (this.down.has(method))
      throw new PaymentProviderError(`Stripe ${method} failed`, 'unavailable');
  }

  private copy(intent: IntentState): IntentState {
    return structuredClone(intent);
  }

  private intentOf(id: string) {
    const intent = this.intents.get(id);
    if (!intent) throw new PaymentProviderError('Stripe retrieve failed', 'invalid');
    return intent;
  }

  count(method: keyof PaymentGateway) {
    return this.calls.filter((call) => call.method === method).length;
  }

  // ---------------------------------------------------------------- the gateway

  async createIntent(input: CreateIntentInput) {
    this.track('createIntent', input);
    const existing = this.keys.get(input.idempotencyKey);
    if (existing) return this.copy(this.intentOf(existing));
    const id = this.next('pi');
    const intent: IntentState = {
      id,
      status: 'requires_payment_method',
      amountCents: input.amountCents,
      amountReceivedCents: 0,
      currency: 'usd',
      metadata: {
        orderId: input.orderId,
        orderNumber: input.orderNumber,
        instance: input.instance,
      },
      customerId: input.customerId ?? null,
      paymentMethodId: input.paymentMethodId ?? null,
      card: null,
      saveCard: input.saveCard,
      lastError: null,
      refundedCents: 0,
      clientSecret: `${id}_secret_${Math.random().toString(36).slice(2, 10)}`,
    };
    this.intents.set(id, intent);
    this.keys.set(input.idempotencyKey, id);
    return this.copy(intent);
  }

  async retrieveIntent(id: string) {
    this.track('retrieveIntent', id);
    return this.copy(this.intentOf(id));
  }

  async updateIntent(
    id: string,
    input: { customerId?: string; paymentMethodId?: string; saveCard: boolean },
  ) {
    this.track('updateIntent', { id, ...input });
    const intent = this.intentOf(id);
    if (input.customerId) intent.customerId = input.customerId;
    if (input.paymentMethodId) intent.paymentMethodId = input.paymentMethodId;
    intent.saveCard = input.saveCard;
    return this.copy(intent);
  }

  async cancelIntent(id: string) {
    this.track('cancelIntent', id);
    const intent = this.intentOf(id);
    if (!['succeeded', 'processing', 'canceled'].includes(intent.status))
      intent.status = 'canceled';
    return this.copy(intent);
  }

  async refund(input: {
    paymentIntentId: string;
    amountCents: number;
    reason: string;
    orderId: string;
    idempotencyKey: string;
  }) {
    this.track('refund', input);
    const existing = this.keys.get(input.idempotencyKey);
    if (existing) {
      const refund = this.refunds.find((row) => row.id === existing);
      if (refund) return { id: refund.id, amountCents: refund.amountCents, status: refund.status };
    }
    const intent = this.intentOf(input.paymentIntentId);
    const refund: FakeRefund = {
      id: this.next('re'),
      amountCents: input.amountCents,
      status: 'succeeded',
      paymentIntentId: input.paymentIntentId,
      reason: input.reason,
    };
    intent.refundedCents += input.amountCents;
    this.refunds.push(refund);
    this.keys.set(input.idempotencyKey, refund.id);
    return { id: refund.id, amountCents: refund.amountCents, status: refund.status };
  }

  async createCustomer(input: { userId: string; instance: string; idempotencyKey: string }) {
    this.track('createCustomer', input);
    const existing = this.keys.get(input.idempotencyKey);
    if (existing) return existing;
    const id = this.next('cus');
    this.customers.add(id);
    this.keys.set(input.idempotencyKey, id);
    return id;
  }

  async deleteCustomer(customerId: string) {
    this.track('deleteCustomer', customerId);
    this.customers.delete(customerId);
    this.deletedCustomers.push(customerId);
    for (const card of this.cards.values()) {
      if (card.customerId === customerId) card.customerId = null;
    }
  }

  async listCards(customerId: string) {
    this.track('listCards', customerId);
    return [...this.cards.values()]
      .filter((card) => card.customerId === customerId)
      .map(({ customerId: _owner, ...card }) => card);
  }

  async retrieveCard(paymentMethodId: string) {
    this.track('retrieveCard', paymentMethodId);
    const card = this.cards.get(paymentMethodId);
    return card ? { ...card } : null;
  }

  async detachCard(paymentMethodId: string) {
    this.track('detachCard', paymentMethodId);
    const card = this.cards.get(paymentMethodId);
    if (card) card.customerId = null;
  }

  // ---------------------------------------------------------------- the browser and the bank

  /** A card saved to a customer, as a past payment with "Save this card" would leave it. */
  addCard(customerId: string, card: CardDetails = VISA, createdAt = new Date()) {
    const id = this.next('pm');
    this.cards.set(id, { id, createdAt, customerId, ...card });
    return id;
  }

  /** The browser confirmed and the bank said yes. A card to save is attached to the customer. */
  succeed(id: string, card: CardDetails = VISA, amountCents?: number) {
    const intent = this.intentOf(id);
    intent.status = 'succeeded';
    intent.amountReceivedCents = amountCents ?? intent.amountCents;
    intent.card = card;
    intent.lastError = null;
    if (!intent.paymentMethodId) {
      intent.paymentMethodId = this.next('pm');
      this.cards.set(intent.paymentMethodId, {
        id: intent.paymentMethodId,
        createdAt: new Date(),
        customerId: intent.saveCard ? intent.customerId : null,
        ...card,
      });
    }
    return this.copy(intent);
  }

  decline(id: string, code = 'card_declined', declineCode: string | null = 'generic_decline') {
    const intent = this.intentOf(id);
    intent.status = 'requires_payment_method';
    intent.lastError = { code, declineCode };
    return this.copy(intent);
  }

  processing(id: string) {
    const intent = this.intentOf(id);
    intent.status = 'processing';
    return this.copy(intent);
  }

  /** The intent created for an order. */
  intentFor(orderId: string) {
    return [...this.intents.values()].find((intent) => intent.metadata.orderId === orderId) ?? null;
  }
}

// ---------------------------------------------------------------- signed webhook events

export const WEBHOOK_SECRET = 'whsec_test_integration_secret_for_signatures';

let eventCounter = 0;

/** A Stripe event as the webhook receives it: the raw body and its Stripe-Signature header. */
export function signedEvent(
  type: string,
  object: Record<string, unknown>,
  options: { id?: string; secret?: string; timestamp?: number } = {},
) {
  eventCounter += 1;
  const payload = JSON.stringify({
    id: options.id ?? `evt_test${eventCounter}${Math.random().toString(36).slice(2, 10)}`,
    object: 'event',
    type,
    created: Math.floor(Date.now() / 1000),
    data: { object },
  });
  const signature = Stripe.webhooks.generateTestHeaderString({
    payload,
    secret: options.secret ?? WEBHOOK_SECRET,
    ...(options.timestamp !== undefined && { timestamp: options.timestamp }),
  });
  return { payload, signature };
}

/** A PaymentIntent object as Stripe puts it in an event. */
export const intentObject = (intent: IntentState) => ({
  id: intent.id,
  object: 'payment_intent',
  amount: intent.amountCents,
  amount_received: intent.amountReceivedCents,
  currency: intent.currency,
  status: intent.status,
  metadata: intent.metadata,
  customer: intent.customerId,
  payment_method: intent.paymentMethodId,
  setup_future_usage: intent.saveCard ? 'on_session' : null,
  last_payment_error: intent.lastError
    ? { code: intent.lastError.code, decline_code: intent.lastError.declineCode }
    : null,
});

export const chargeObject = (
  intent: IntentState,
  refundedCents: number,
  metadata: Record<string, string> = intent.metadata,
) => ({
  id: `ch_${intent.id.slice(3)}`,
  object: 'charge',
  amount: intent.amountReceivedCents,
  amount_refunded: refundedCents,
  currency: intent.currency,
  payment_intent: intent.id,
  metadata,
});

export const disputeObject = (intent: IntentState, status: string) => ({
  id: `dp_${intent.id.slice(3)}`,
  object: 'dispute',
  amount: intent.amountReceivedCents,
  currency: intent.currency,
  status,
  payment_intent: intent.id,
  created: Math.floor(Date.now() / 1000),
});
