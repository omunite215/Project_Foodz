import { z } from 'zod';

/*
 * Saved cards and Stripe's webhook (F4). Cards live at Stripe under one Stripe customer per
 * account, made the first time a card is saved; Foodz keeps only the customer id and shows
 * brand, last 4 and expiry.
 */

/** Up to 5 saved cards per account (U4). */
export const SAVED_CARD_LIMIT = 5;

/** A Stripe card (PaymentMethod) id. */
export const savedCardIdSchema = z.string().regex(/^pm_[A-Za-z0-9_]{4,100}$/);

export const removeSavedCardInput = z.object({ paymentMethodId: savedCardIdSchema }).strict();

export interface SavedCardDto {
  /** The PaymentMethod id: pass it back to pay with or remove this card. */
  id: string;
  /** Stripe's brand key: visa, mastercard, amex, ... */
  brand: string;
  /** "Visa", "Mastercard", "American Express". */
  brandLabel: string;
  last4: string;
  expMonth: number;
  expYear: number;
  /** Past its expiry month (S6.12): listed, can't be chosen. */
  expired: boolean;
  /** "Visa •••• 4242". */
  label: string;
  /** For screen readers: "Visa ending in 4242". */
  spoken: string;
  /** "12/34". */
  expiry: string;
  /** The last order paid with it, for choosing it first (S6.11). */
  lastUsedAt: string | null;
}

export interface SavedCardsList {
  cards: SavedCardDto[];
  limit: typeof SAVED_CARD_LIMIT;
}

/** /account/cards, server-rendered (design 5.4). */
export type SavedCardsPage =
  | { state: 'ok'; cards: SavedCardDto[]; limit: typeof SAVED_CARD_LIMIT }
  | { state: 'demo' }
  | { state: 'notConfigured' }
  /** Stripe couldn't be reached: "We couldn't load your saved cards." */
  | { state: 'unavailable' };

export interface StripeConfigDto {
  /** Card payments work on this computer (keys set). */
  configured: boolean;
  /** Test keys: show "Test mode: no real money moves" (S6.2). */
  testMode: boolean;
  publishableKey: string | null;
}

// ------------------------------------------------------------------ webhook payloads

/*
 * The parts of Stripe's events the webhook reads. Everything else in the payload is ignored;
 * these fields are checked before anything is looked up.
 */

const metadata = z.record(z.string(), z.string()).default({});

export const intentObjectSchema = z.object({
  id: z.string().regex(/^pi_[A-Za-z0-9_]+$/),
  object: z.literal('payment_intent'),
  amount: z.int().min(0),
  amount_received: z.int().min(0).default(0),
  currency: z.string().min(3).max(3),
  status: z.string(),
  metadata,
});

export const chargeObjectSchema = z.object({
  id: z.string().regex(/^(ch|py)_[A-Za-z0-9_]+$/),
  object: z.literal('charge'),
  amount: z.int().min(0),
  amount_refunded: z.int().min(0),
  currency: z.string().min(3).max(3),
  payment_intent: z
    .string()
    .regex(/^pi_[A-Za-z0-9_]+$/)
    .nullable(),
  metadata,
});

export const disputeObjectSchema = z.object({
  id: z.string().regex(/^(dp|du)_[A-Za-z0-9_]+$/),
  object: z.literal('dispute'),
  amount: z.int().min(0),
  currency: z.string().min(3).max(3),
  status: z.string(),
  payment_intent: z
    .string()
    .regex(/^pi_[A-Za-z0-9_]+$/)
    .nullable(),
  created: z.int(),
});

export const HANDLED_EVENTS = [
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'payment_intent.canceled',
  'charge.refunded',
  'charge.dispute.created',
  'charge.dispute.closed',
] as const;
export type HandledEvent = (typeof HANDLED_EVENTS)[number];

export const stripeEventSchema = z.object({
  id: z.string().regex(/^evt_[A-Za-z0-9_]+$/),
  type: z.string().max(100),
  created: z.int(),
  data: z.object({ object: z.object({ object: z.string() }).loose() }),
});
export type StripeEventEnvelope = z.infer<typeof stripeEventSchema>;

/** What the webhook answered, for its own tests and logs. */
export type WebhookOutcome =
  'applied' | 'unchanged' | 'duplicate' | 'ignored-type' | 'other-instance' | 'unknown-order';
