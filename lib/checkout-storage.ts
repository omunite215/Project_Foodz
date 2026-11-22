import { z } from 'zod';

/*
 * What checkout keeps for this tab only (design "Data shown"): the tip, the typed "Other" amount,
 * the kitchen note, the attempt key and the order the tab just placed. sessionStorage, never
 * localStorage, so a reload of the same tab keeps them (S7.2) and nothing outlives the tab.
 * Storage can be blocked; every read and write is guarded and the page works without it.
 */

const KEYS = {
  choices: 'foodz.checkout.choices',
  attempt: 'foodz.checkout.attempt',
  placed: 'foodz.checkout.placed',
  arrival: 'foodz.order.arrival',
  confirming: 'foodz.order.confirming',
  clearCart: 'foodz.order.clear-cart',
} as const;

function read(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, value);
  } catch {
    // Storage blocked: the value lasts until the page is left.
  }
}

function readJson<T>(key: string, schema: z.ZodType<T>): T | null {
  const raw = read(key);
  if (!raw) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ choices (S7.2)

const choicesSchema = z.object({
  tip: z.union([
    z.object({ kind: z.literal('none') }),
    z.object({
      kind: z.literal('percent'),
      percent: z.union([z.literal(10), z.literal(15), z.literal(20)]),
    }),
    z.object({ kind: z.literal('other') }),
  ]),
  otherText: z.string().max(20),
  note: z.string().max(200),
  summaryOpen: z.boolean(),
});
export type CheckoutChoices = z.infer<typeof choicesSchema>;

export const NO_CHOICES: CheckoutChoices = {
  tip: { kind: 'none' },
  otherText: '',
  note: '',
  summaryOpen: false,
};

export const readChoices = (): CheckoutChoices =>
  readJson(KEYS.choices, choicesSchema) ?? NO_CHOICES;
export const writeChoices = (choices: CheckoutChoices) =>
  write(KEYS.choices, JSON.stringify(choices));

// ------------------------------------------------------------------ the attempt key (B2)

const attemptSchema = z.object({
  key: z.string().regex(/^[A-Za-z0-9_-]{16,100}$/),
  fingerprint: z.string(),
  /** Pressed with this key: on reload, ask the server what became of it (S7.3, S7.4). */
  pressed: z.boolean(),
});
export type StoredAttempt = z.infer<typeof attemptSchema>;

export const readAttempt = () => readJson(KEYS.attempt, attemptSchema);
export const writeAttempt = (attempt: StoredAttempt | null) =>
  write(KEYS.attempt, attempt ? JSON.stringify(attempt) : null);

// ------------------------------------------------------------------ the order this tab placed (S1.6, S7.4)

const placedSchema = z.object({
  orderId: z.uuid(),
  number: z.string().max(20),
  /** A card payment the server hasn't confirmed yet. */
  confirming: z.boolean(),
});
export type PlacedHere = z.infer<typeof placedSchema>;

export const readPlacedHere = () => readJson(KEYS.placed, placedSchema);
export const writePlacedHere = (placed: PlacedHere | null) =>
  write(KEYS.placed, placed ? JSON.stringify(placed) : null);

// ------------------------------------------------------------------ the order page (D35, B7, B16)

const orderIdSchema = z.uuid();

function takeId(key: string, orderId: string): boolean {
  const stored = read(key);
  if (stored !== orderId) return false;
  write(key, null);
  return true;
}

function hasId(key: string, orderId: string): boolean {
  return orderIdSchema.safeParse(read(key)).success && read(key) === orderId;
}

/** Play the check once: set by checkout, read (and forgotten) by the order page (D35). */
export const markArrival = (orderId: string) => write(KEYS.arrival, orderId);
export const takeArrival = (orderId: string) => takeId(KEYS.arrival, orderId);

/** The browser saw Stripe take the payment; the order page says "Confirming…" until the server knows. */
export const markConfirming = (orderId: string) => write(KEYS.confirming, orderId);
export const isConfirming = (orderId: string) => hasId(KEYS.confirming, orderId);
export const forgetConfirming = (orderId: string) => {
  if (read(KEYS.confirming) === orderId) write(KEYS.confirming, null);
};

/** The cart is emptied once this card order is placed (B16), on the order page. */
export const markClearCart = (orderId: string) => write(KEYS.clearCart, orderId);
export const takeClearCart = (orderId: string) => takeId(KEYS.clearCart, orderId);
