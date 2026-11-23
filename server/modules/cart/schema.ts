import { z } from 'zod';
import { Cuisine } from '@/server/db/enums';
import { latitudeSchema, longitudeSchema } from '@/server/modules/addresses/schema';
import { storeMomentSchema } from '@/server/modules/menu/schema';

/*
 * The cart's price breakdown (F3). The browser sends what the customer picked; the server looks
 * up every price, fee, rate and code itself and answers with the whole breakdown. Money is
 * integer cents (1299 is $12.99), instants are ISO 8601 strings in UTC, distances are km with
 * one decimal.
 */

export const MAX_LINE_QUANTITY = 20;
export const MAX_CART_LINES = 25;
export const MAX_CART_ITEMS = 50;
export const MAX_NOTE_LENGTH = 200;
export const MAX_FLAVORS = 5;
export const MAX_FLAVOR_LENGTH = 40;
export const MAX_CODE_LENGTH = 32;

const cents = z.int().min(0);
const instant = z.iso.datetime();

// ------------------------------------------------------------------ cleaning what the browser sends

const CONTROL = /\p{Cc}+/gu;
// Invisible format characters (bidi overrides, zero-width spaces) could make a note read
// differently to the kitchen. The two joiners some scripts need are kept.
const FORMAT = /\p{Cf}/gu;
const keepJoiners = (char: string) => (char === '‌' || char === '‍' ? char : '');

/**
 * Case, spaces, line breaks and invisible characters don't matter in a code (S4.2):
 * " kbbq5 ", "KBBQ 5" and "kbbq5⏎" are all KBBQ5. Full-width letters become plain ones.
 */
export function normalizeCode(raw: string): string {
  return raw
    .normalize('NFKC')
    .replace(/[\s\p{Cc}\p{Cf}]+/gu, '')
    .toUpperCase();
}

/** The form every stored code has (the `coupons_code_format` check in the database). */
const CODE_FORMAT = /^[A-Z0-9][A-Z0-9-]{0,31}$/;

/**
 * Whether a normalised code could exist at all. One that couldn't is answered "not found"
 * without being looked up against the guessing limits, and the browser doesn't send it.
 */
export const isPossibleCode = (code: string): boolean => CODE_FORMAT.test(code);

/**
 * The kitchen note as it is used and stored (S1.16): control characters become a space,
 * invisible format characters are removed, and the ends are trimmed. Everything else stays
 * exactly as typed. Blank means no note.
 */
export function cleanNote(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const cleaned = raw.replace(CONTROL, ' ').replace(FORMAT, keepJoiners).trim();
  return cleaned ? cleaned : null;
}

/** A flavor name as compared with the dish's own list; blank means none. */
export function cleanFlavor(raw: string): string {
  return raw.replace(CONTROL, ' ').replace(FORMAT, keepJoiners).trim();
}

// ------------------------------------------------------------------ input

export const quoteLineInput = z
  .object({
    /**
     * The browser's own key for the line, echoed back so it can match answers to lines. Use
     * the line's stable order key, not the composite cart id (which holds the note).
     */
    key: z.string().min(1).max(100),
    menuItemId: z.uuid(),
    /** At most 5. Names the dish doesn't offer are dropped and reported, not refused (S3.4). */
    flavors: z.array(z.string().max(MAX_FLAVOR_LENGTH)).max(MAX_FLAVORS).default([]),
    quantity: z.int().min(1).max(MAX_LINE_QUANTITY),
    /** Up to 200 characters; control characters are removed (S1.16). */
    note: z.string().max(MAX_NOTE_LENGTH).optional(),
  })
  .strict();
export type QuoteLineInput = z.input<typeof quoteLineInput>;

/**
 * Where the order would go. `default` is the signed-in customer's default saved address (none
 * for a guest); `point` is an address checked without saving it (U2).
 */
export const deliveryTargetInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('default') }).strict(),
  z.object({ kind: z.literal('saved'), addressId: z.uuid() }).strict(),
  z.object({ kind: z.literal('point'), lat: latitudeSchema, lng: longitudeSchema }).strict(),
  z.object({ kind: z.literal('none') }).strict(),
]);
export type DeliveryTargetInput = z.input<typeof deliveryTargetInput>;

/** A code as typed: normalised, and empty means no code. */
export const promoCodeInput = z
  .string()
  .max(64)
  .transform(normalizeCode)
  .refine((code) => code.length <= MAX_CODE_LENGTH, 'Promo codes are 32 characters or fewer.');

export const quoteInput = z
  .object({
    /** Lines in cart order. More than 25 lines or 50 items answers CART_TOO_BIG (S1.12). */
    lines: z
      .array(quoteLineInput)
      .max(100)
      .refine(
        (lines) => new Set(lines.map((line) => line.key)).size === lines.length,
        'Each line needs its own key.',
      ),
    /** The applied (or newly typed) code; checked again on every quote (S4.15). */
    code: promoCodeInput.optional(),
    delivery: deliveryTargetInput.default({ kind: 'default' }),
  })
  .strict();
export type QuoteInput = z.input<typeof quoteInput>;
export type ParsedQuoteInput = z.output<typeof quoteInput>;

// ------------------------------------------------------------------ output

export const cuisineSchema = z.enum(Cuisine);

export const quoteLineSchema = z.object({
  key: z.string(),
  menuItemId: z.uuid(),
  /** ok: priced. soldOut: kept, flagged, left out of the subtotal (S3.1). removed: no longer on the menu (S3.2). */
  status: z.enum(['ok', 'soldOut', 'removed']),
  /** Null when the dish is no longer on the menu. */
  dish: z
    .object({
      title: z.string(),
      slug: z.string(),
      /** A path on this site, or null: show the placeholder plate. */
      image: z.string().nullable(),
      cuisine: cuisineSchema,
    })
    .nullable(),
  /** The current menu price; null when removed. Compare with the last one shown for S3.3. */
  unitPriceCents: cents.nullable(),
  quantity: z.int().min(1).max(MAX_LINE_QUANTITY),
  /** unit price × quantity (0 when removed), shown on the line even when sold out. */
  lineTotalCents: cents,
  /** Whether this line is part of the subtotal (only `ok` lines are). */
  inSubtotal: z.boolean(),
  /** The flavors kept, as the dish names them. */
  flavors: z.array(z.string()),
  /** Flavors taken off because the dish doesn't offer them (S1.16, S3.4). */
  droppedFlavors: z.array(z.string()),
  /** What the dish offers, for the edit form (empty when removed). */
  flavorsOffered: z.array(z.string()),
  /** The note as it will reach the kitchen, or null. Render as text. */
  note: z.string().nullable(),
});
export type QuoteLine = z.infer<typeof quoteLineSchema>;

/**
 * Why a code gives nothing, in the order they are checked (B6). `rule` is the story's R-number.
 * Only R9 keeps the code attached as "Not applied yet" (status notApplied).
 */
export const promoReasonSchema = z.discriminatedUnion('code', [
  /** R1: unknown, switched off, or someone else's personal code. Nothing else is revealed. */
  z.object({ code: z.literal('notFound'), rule: z.literal('R1') }),
  z.object({ code: z.literal('notStarted'), rule: z.literal('R2'), startsAt: instant }),
  z.object({ code: z.literal('ended'), rule: z.literal('R3'), endedAt: instant }),
  z.object({ code: z.literal('usedUp'), rule: z.literal('R4') }),
  z.object({
    code: z.literal('signInRequired'),
    rule: z.literal('R5'),
    perCustomer: z.int().min(1),
  }),
  z.object({
    code: z.literal('alreadyUsed'),
    rule: z.literal('R6'),
    /** Uses allowed per customer ("one per customer"). */
    perCustomer: z.int().min(1),
  }),
  z.object({
    code: z.literal('onHold'),
    rule: z.literal('R7'),
    /** The customer's unpaid order holding the code (F4). */
    orderNumber: z.string(),
  }),
  z.object({
    code: z.literal('notForTheseDishes'),
    rule: z.literal('R8'),
    cuisines: z.array(cuisineSchema).min(1),
  }),
  z.object({
    code: z.literal('minimumNotReached'),
    rule: z.literal('R9'),
    minSubtotalCents: cents,
    /** What counts towards the minimum: the whole subtotal, or only `cuisines` dishes. */
    eligibleCents: cents,
    shortfallCents: cents,
    /** Empty: the whole order counts. */
    cuisines: z.array(cuisineSchema),
  }),
  /** Too many unknown codes tried (B5); the code was not checked. */
  z.object({ code: z.literal('rateLimited'), rule: z.null() }),
  /** The code checker is down (fails closed, S4.14); the code was not checked. */
  z.object({ code: z.literal('unavailable'), rule: z.null() }),
]);
export type PromoReason = z.infer<typeof promoReasonSchema>;
export type PromoReasonCode = PromoReason['code'];

export const promoKindSchema = z.enum(['percent', 'fixed', 'freeDelivery']);
export type PromoKind = z.infer<typeof promoKindSchema>;

export const quotePromoSchema = z.object({
  /** Normalised, e.g. "KBBQ5". Render as text. */
  code: z.string(),
  /**
   * applied: in the total. notApplied: exists and is yours, but the minimum isn't reached yet
   * (R9); it applies by itself once it is. refused: R1 to R8. unchecked: rate limited or the
   * checker is down; quoted without it.
   */
  status: z.enum(['applied', 'notApplied', 'refused', 'unchecked']),
  reason: promoReasonSchema.nullable(),
  /** The story's sentence for a refusal, R9 or unchecked; null when applied. Safe to show. */
  message: z.string().nullable(),
  /** "$5 off Korean dishes over $25". Null for R1 and unchecked (nothing is revealed). */
  description: z.string().nullable(),
  kind: promoKindSchema.nullable(),
  /** Off the food; the tax is worked out after it. */
  foodDiscountCents: cents,
  /** Free delivery, kept apart from the fee itself (B4). 0 until the fee is known. */
  deliveryDiscountCents: cents,
  /** What the code saves in this quote: food + delivery discount. */
  amountCents: cents,
  /** A free-delivery code is applied: show the delivery row as "Free". */
  freeDelivery: z.boolean(),
  /** With reason rateLimited: seconds until codes can be tried again. */
  retryAfterSeconds: z.int().min(1).nullable(),
});
export type QuotePromo = z.infer<typeof quotePromoSchema>;

export const quoteDeliverySchema = z.object({
  /** saved: a saved address (yours). point: an address checked without saving. none: unknown. */
  kind: z.enum(['saved', 'point', 'none']),
  /** The saved address used ("Home", "12 Peterborough Street"); null otherwise. */
  address: z.object({ id: z.uuid(), label: z.string(), line1: z.string() }).nullable(),
  /** Inside or outside is decided on the exact distance; unknown when no address is known. */
  status: z.enum(['inside', 'outside', 'unknown']),
  /** Straight-line distance from the kitchen, rounded to 0.1 km; null when unknown. */
  distanceKm: z.number().min(0).nullable(),
  radiusKm: z.number().min(0),
  /**
   * justOver: outside, though the rounded distance reads as the radius ("just over 8 km").
   * justUnder: inside at the rounded radius. Null otherwise.
   */
  edge: z.enum(['justUnder', 'justOver']).nullable(),
  /** base + per-km × distanceKm, only when inside. The real fee, even with free delivery (B4). */
  feeCents: cents.nullable(),
  /** "$1.99 to $5.99", for when the address isn't known (S2.7). */
  feeRange: z.object({ minCents: cents, maxCents: cents }),
  /** A saved address id that isn't (or is no longer) yours: quoted as unknown. */
  missingAddress: z.boolean(),
});
export type QuoteDelivery = z.infer<typeof quoteDeliverySchema>;

export const quoteOfferSchema = z.object({
  code: z.string(),
  description: z.string().nullable(),
  kind: promoKindSchema,
  /** Running campaign's title, e.g. "Korean BBQ weekend". */
  campaignTitle: z.string(),
  /** The countdown end: the earlier of the campaign's end and the code's end (B18). */
  endsAt: instant,
  /** How it would do on this cart right now (never rate limited: these codes are public). */
  status: z.enum(['applied', 'notApplied', 'refused']),
  reason: promoReasonSchema.nullable(),
  message: z.string().nullable(),
  /** What it would save on this cart now. */
  amountCents: cents,
});
export type QuoteOffer = z.infer<typeof quoteOfferSchema>;

export const checkoutBlockerSchema = z.enum([
  /** Nothing priced in the cart. */
  'empty',
  /** A sold-out dish is in the cart (S3.1). */
  'soldOut',
  /** The store is closed (S3.5). */
  'closed',
  /** The address is outside the delivery area (S2.8). */
  'outside',
]);
export type CheckoutBlocker = z.infer<typeof checkoutBlockerSchema>;

export const quoteSchema = z.object({
  quotedAt: instant,
  lines: z.array(quoteLineSchema),
  /** Items in the subtotal (sold-out and removed lines left out). */
  itemCount: z.int().min(0),
  subtotalCents: cents,
  /** Null when no code was sent. */
  promo: quotePromoSchema.nullable(),
  delivery: quoteDeliverySchema,
  tax: z.object({
    /** 700 is 7 %. Taxes the food after the promo; never delivery or tip (U1). */
    rateBps: z.int().min(0),
    cents,
  }),
  /** Always 0 in the cart; the tip is chosen at checkout (F4). */
  tipCents: cents,
  /** subtotal − food discount + delivery fee − delivery discount + tax + tip. */
  totalCents: cents,
  /**
   * final: nothing more is added for delivery (the fee is in the total, or a free-delivery code
   * is applied and no address is known yet). beforeDelivery: no fee is in the total (no address
   * yet, or outside the area).
   */
  totalKind: z.enum(['final', 'beforeDelivery']),
  store: z.object({
    timeZone: z.string(),
    isOpen: z.boolean(),
    opensAt: storeMomentSchema.nullable(),
    closesAt: storeMomentSchema.nullable(),
  }),
  /** Running campaigns with a public code (S4.10). Personal codes are never listed. */
  offers: z.array(quoteOfferSchema),
  /** Why checkout can't start yet (S1.17); empty when it can. */
  checkoutBlockers: z.array(checkoutBlockerSchema),
});
export type Quote = z.infer<typeof quoteSchema>;

/** CART_TOO_BIG details (S1.12). */
export interface CartTooBigDetails {
  maxItems: typeof MAX_CART_ITEMS;
  maxLines: typeof MAX_CART_LINES;
  /** "(617) 555-0142", from the store settings. */
  phone: string;
}
