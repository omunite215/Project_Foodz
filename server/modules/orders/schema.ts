import { z } from 'zod';
import { DEFAULT_PHONE_COUNTRY, parsePhone } from '@/lib/phone';
import { DisputeStatus, OrderStatus, PaymentStatus } from '@/server/db/enums';
import { nameSchema, PHONE_ERROR } from '@/server/modules/account/schema';
import {
  MAX_NOTE_LENGTH,
  paymentMethodInput,
  promoCodeInput,
  type PromoReason,
  type Quote,
  quoteInput,
  tipChoiceInput,
} from '@/server/modules/cart/schema';
import type { StoreMoment } from '@/server/modules/menu/schema';
import type { SavedCardDto, StripeConfigDto } from '@/server/modules/payments/schema';

/*
 * Checkout and orders (F4). Money is integer cents, instants ISO 8601 in UTC, and every input
 * is strict: an unknown field is refused. Order numbers ("1042") are for reading out loud;
 * every URL and action uses the order's id.
 */

export const ORDERS_PAGE_SIZE = 20;
/** The same dishes to the same address within this long asks "Place it again?" (S7.5). */
export const DUPLICATE_WINDOW_MS = 2 * 60 * 1000;
/** How long a card order waits for its payment unless ORDER_PAYMENT_TTL_MINUTES says otherwise. */
export const DEFAULT_PAYMENT_TTL_MINUTES = 15;

export const PHONE_REQUIRED = 'Enter a phone number so your courier can reach you.';

const cents = z.int().min(0);

// ------------------------------------------------------------------ inputs

/**
 * Made by the browser when checkout opens and again whenever the cart, the total or a choice
 * changes (S7.2). The same key returns the same order instead of making another.
 */
export const attemptKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{16,100}$/, 'Reload the page and try again.');

/** A Stripe card (PaymentMethod) id. Ownership is checked against the caller's own customer. */
export const paymentMethodIdSchema = z.string().regex(/^pm_[A-Za-z0-9_]{4,100}$/);

export const cardChoiceInput = z.discriminatedUnion('kind', [
  /** Typed into the card fields; `save` is "Save this card for next time" (unticked, U4). */
  z.object({ kind: z.literal('new'), save: z.boolean().default(false) }).strict(),
  z.object({ kind: z.literal('saved'), paymentMethodId: paymentMethodIdSchema }).strict(),
]);
export type CardChoice = z.input<typeof cardChoiceInput>;

/**
 * What the button's quote showed, so a refusal can say what changed (S8.2). Assertions only:
 * nothing here is ever used to price the order.
 */
const shownInput = z
  .object({
    lines: z
      .array(z.object({ key: z.string().min(1).max(100), unitPriceCents: cents }).strict())
      .max(100)
      .default([]),
    deliveryFeeCents: cents.nullable().optional(),
    promoAmountCents: cents.optional(),
  })
  .strict();

export const placeOrderInput = z
  .object({
    attemptKey: attemptKeySchema,
    /** The cart, as for the quote: priced again on the server from the database (S8.1). */
    lines: quoteInput.shape.lines,
    code: promoCodeInput.optional(),
    /** One of the caller's saved addresses (S2). */
    addressId: z.uuid(),
    tip: tipChoiceInput,
    method: paymentMethodInput,
    /** Required for card, refused for cash. */
    card: cardChoiceInput.optional(),
    /** "Name for the order" (S2.6): this order only. */
    contactName: nameSchema,
    /** Required (U8); stored as E.164. */
    phone: z.string().trim().max(40, PHONE_ERROR),
    phoneCountry: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .default(DEFAULT_PHONE_COUNTRY),
    /** "Save this number to my profile" (S2.7). */
    savePhone: z.boolean().default(false),
    /** "Note for the kitchen" (S2.8); control characters are removed. */
    kitchenNote: z.string().max(MAX_NOTE_LENGTH, 'Use 200 characters or fewer.').optional(),
    /** The total on the button. Compared, never priced: any difference answers PRICE_CHANGED. */
    expectedTotalCents: z.int().min(0).max(100_000_000),
    shown: shownInput.optional(),
    /** "Place it again" after LIKELY_DUPLICATE (S7.5). */
    allowDuplicate: z.boolean().default(false),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.phone) ctx.addIssue({ code: 'custom', path: ['phone'], message: PHONE_REQUIRED });
    else if (!parsePhone(value.phone, value.phoneCountry)) {
      ctx.addIssue({ code: 'custom', path: ['phone'], message: PHONE_ERROR });
    }
    if (value.method === 'card' && !value.card) {
      ctx.addIssue({ code: 'custom', path: ['card'], message: 'Choose a card.' });
    }
    if (value.method === 'cash' && value.card) {
      ctx.addIssue({ code: 'custom', path: ['card'], message: 'Cash orders take no card.' });
    }
  });
export type PlaceOrderInput = z.input<typeof placeOrderInput>;
export type ParsedPlaceOrderInput = z.output<typeof placeOrderInput>;

export const orderIdInput = z.object({ orderId: z.uuid() }).strict();

export const orderStatusInput = z
  .object({
    orderId: z.uuid(),
    /** The browser saw Stripe confirm the payment: ask Stripe now rather than wait (B7). */
    confirmed: z.boolean().default(false),
  })
  .strict();

export const attemptStatusInput = z.object({ attemptKey: attemptKeySchema }).strict();

export const resumePaymentInput = z
  .object({
    orderId: z.uuid(),
    /** Leave out to pay with whatever the payment was started with. */
    card: cardChoiceInput.optional(),
  })
  .strict();

export const listOrdersInput = z.object({ cursor: z.string().max(200).optional() }).strict();

// ------------------------------------------------------------------ results

export type PlaceOrderResult =
  /** Cash: placed at once. Also a replay of a card order that is already paid. */
  | {
      kind: 'placed';
      orderId: string;
      number: string;
      method: 'cash' | 'card';
      totalCents: number;
      /** The same attempt key was sent before: this is that order, nothing new was made. */
      replayed: boolean;
    }
  /** Card: confirm `clientSecret` with Stripe.js, then go to the order page. */
  | {
      kind: 'pay';
      orderId: string;
      number: string;
      totalCents: number;
      clientSecret: string;
      expiresAt: string;
      replayed: boolean;
    };

/** Why the total changed (S8.2), for "because Gimbap is now $13.99 (was $12.99)". */
export type PriceChange =
  | { kind: 'price'; key: string; dish: string; wasCents: number; nowCents: number }
  | { kind: 'deliveryFee'; label: string | null; wasCents: number | null; nowCents: number | null }
  | { kind: 'extraDropped'; key: string; extra: string; dish: string }
  | { kind: 'promo'; code: string; wasCents: number | null; nowCents: number }
  | { kind: 'other' };

/** `details` of each refusal, by `serverError.code`. */
export interface OrderRefusalDetails {
  EMAIL_NOT_CONFIRMED: { email: string };
  PRICE_CHANGED: {
    oldTotalCents: number;
    newTotalCents: number;
    quote: Quote;
    changes: PriceChange[];
  };
  SOLD_OUT: {
    soldOut: { key: string; menuItemId: string; dish: string }[];
    /** Lines whose dish left the menu (F3 S3.2). */
    removed: { key: string; menuItemId: string }[];
    quote: Quote;
  };
  PROMO_REFUSED: { code: string; reason: PromoReason; quote: Quote };
  STORE_CLOSED: { closedAt: StoreMoment | null; opensAt: StoreMoment | null };
  CASH_LIMIT: { totalCents: number; limitCents: number };
  OUTSIDE_AREA: { distanceKm: number | null; radiusKm: number };
  UNPAID_ORDER: { orderId: string; number: string; totalCents: number; expiresAt: string | null };
  LIKELY_DUPLICATE: { orderId: string; number: string };
  CARD_PAUSED: { until: string };
  KITCHEN_STARTED: { orderId: string; number: string; phone: string };
  PAYMENT_IN_PROGRESS: { orderId: string; number: string };
}

export type AttemptStatus =
  | { kind: 'notFound' }
  | { kind: 'placed'; orderId: string; number: string }
  | { kind: 'awaitingPayment'; orderId: string; number: string; expiresAt: string | null }
  | { kind: 'failed'; orderId: string; number: string; decline: Decline | null }
  | { kind: 'cancelled'; orderId: string; number: string; reason: CancelReason | null };

export type ResumePaymentResult =
  | {
      kind: 'pay';
      orderId: string;
      number: string;
      amountCents: number;
      clientSecret: string;
      expiresAt: string | null;
    }
  /** Stripe already has the payment: go to the order page. */
  | { kind: 'paid'; orderId: string; number: string };

export interface CancelResult {
  orderId: string;
  number: string;
  status: 'CANCELLED';
  /** A paid card order is refunded in full automatically (U6). */
  refund: { amountCents: number; cardLabel: string | null } | null;
}

// ------------------------------------------------------------------ the order page

export const CANCEL_REASONS = ['customer', 'payment-expired', 'account-deleted'] as const;
export type CancelReason = (typeof CANCEL_REASONS)[number];

export const AUTO_REFUND_REASONS = ['customer-cancel', 'late-payment', 'mismatch'] as const;
export type AutoRefundReason = (typeof AUTO_REFUND_REASONS)[number];

/** The bank's answer, for "Your card was declined for insufficient funds" (S6.8). */
export interface Decline {
  code: string | null;
  declineCode: string | null;
}

export type TimelineKind =
  'placed' | 'revived' | 'cancelled' | 'expired' | 'refunded' | 'disputeOpened' | 'disputeClosed';

export interface OrderView {
  id: string;
  number: string;
  createdAt: string;
  placedAt: string | null;
  status: OrderStatus;
  cancelReason: CancelReason | null;
  /** Waiting for payment, or placed and not yet accepted by the kitchen (U6). */
  cancellable: boolean;
  /** Waiting for payment with time left: "Finish paying" (S7.6). */
  payable: boolean;
  expiresAt: string | null;
  payment: {
    method: 'cash' | 'card';
    status: PaymentStatus;
    /** "Visa •••• 4242"; null for cash and until the card is known. */
    card: { brand: string; last4: string; label: string; spoken: string } | null;
    /** The last decline, when the payment failed. */
    decline: Decline | null;
  };
  lines: {
    title: string;
    flavors: string[];
    note: string | null;
    quantity: number;
    unitPriceCents: number;
    lineTotalCents: number;
  }[];
  kitchenNote: string | null;
  breakdown: {
    subtotalCents: number;
    promo: { code: string; foodDiscountCents: number; freeDelivery: boolean } | null;
    /** The real fee; deliveryDiscountCents is the free-delivery promo. */
    deliveryFeeCents: number;
    deliveryDiscountCents: number;
    tax: { rateBps: number | null; cents: number };
    tipCents: number;
    tipChoice: 'none' | '10' | '15' | '20' | 'amount';
    totalCents: number;
  };
  refunds: { refundedCents: number; entries: { amountCents: number; at: string }[] };
  dispute: {
    status: DisputeStatus;
    openedAt: string | null;
    closedAt: string | null;
  };
  delivery: {
    label: string | null;
    line1: string;
    line2: string | null;
    city: string | null;
    instructions: string | null;
    distanceKm: number;
  };
  contact: { name: string; firstName: string; phoneDisplay: string };
  /** Minutes after placing, and as instants once placed (S3.2). Null for older orders. */
  arrival: {
    fromMinutes: number;
    toMinutes: number;
    from: string | null;
    to: string | null;
  } | null;
  timeline: { kind: TimelineKind; at: string; amountCents: number | null }[];
  flags: {
    /** "Your payment arrived just after the deadline, and we've placed order 1042." (S9.5) */
    revivedAfterLatePayment: boolean;
    /** Paid after it expired and couldn't be placed: refunded in full (S9.5). */
    lateRefund: boolean;
    /** The payment didn't match the order and was refunded in full (S10.4). */
    mismatchRefund: boolean;
  };
  store: { phone: string; timeZone: string };
}

/** The status words used everywhere (design 4.3). */
export type OrderStatusWord =
  | 'waitingForPayment'
  | 'placed'
  | 'accepted'
  | 'preparing'
  | 'ready'
  | 'pickedUp'
  | 'delivered'
  | 'cancelled'
  | 'expired';

export interface OrderSummary {
  id: string;
  number: string;
  createdAt: string;
  /** Up to 3 dishes, as "Gimbap ×2". */
  dishes: { title: string; quantity: number }[];
  moreCount: number;
  totalCents: number;
  status: OrderStatus;
  statusWord: OrderStatusWord;
  method: 'cash' | 'card';
  /** Shown beside the total (S12.4). */
  moneyFlag: 'refunded' | 'partlyRefunded' | 'disputed' | null;
}

export interface OrdersPage {
  /** Waiting for payment and placed orders; on the first page only. */
  inProgress: OrderSummary[];
  /** Delivered, cancelled and expired, newest first, 20 at a time. Failed attempts never show. */
  past: OrderSummary[];
  /** Pass back as `cursor` for the next 20; null when there are no more. */
  nextCursor: string | null;
}

// ------------------------------------------------------------------ the checkout page

export type CheckoutEligibility = 'guest' | 'staff' | 'courier' | 'unconfirmed' | 'demo' | 'ok';

export interface CheckoutAddress {
  id: string;
  kind: 'HOME' | 'WORK' | 'OTHER';
  label: string;
  line1: string;
  line2: string | null;
  city: string;
  /** Courier instructions. */
  notes: string | null;
  isDefault: boolean;
  /** Outside the delivery area now (S2.3): listed but can't be chosen. */
  outsideNow: boolean;
  distanceKm: number;
  /** The real delivery fee; null when outside. */
  feeCents: number | null;
}

/** An unpaid card order blocking checkout (S7.6, U11). */
export interface CheckoutUnpaidOrder {
  id: string;
  number: string;
  totalCents: number;
  expiresAt: string | null;
  /** Stripe is still confirming it: "Cancel it and start again" is refused. */
  paymentInProgress: boolean;
}

export type CheckoutPage =
  | { eligibility: 'guest' | 'staff' | 'courier' }
  | {
      eligibility: 'ok' | 'unconfirmed' | 'demo';
      /** For the email gate (S1.3). */
      email: string;
      profile: {
        name: string;
        /** E.164, or null. */
        phone: string | null;
        phoneDisplay: string | null;
        phoneCountry: string | null;
      };
      addresses: CheckoutAddress[];
      addressCount: number;
      addressLimit: number;
      lastPaymentMethod: 'cash' | 'card' | null;
      /** Never listed for the demo account. Most recently used first. */
      savedCards: SavedCardDto[];
      savedCardLimit: number;
      stripe: StripeConfigDto;
      /** Too many declines: card payment pauses until then (S6.9). */
      cardPausedUntil: string | null;
      unpaidOrder: CheckoutUnpaidOrder | null;
      cashLimitCents: number;
      paymentTtlMinutes: number;
      storePhone: string;
    };

// ------------------------------------------------------------------ enum re-exports for screens

export const orderStatusSchema = z.enum(OrderStatus);
export const paymentStatusSchema = z.enum(PaymentStatus);
