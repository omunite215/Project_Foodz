import type { PromoReason, QuotePromo } from '@/server/modules/cart/schema';
import { promoAppliedText } from './cart-text';

/*
 * The message under the cart's promo field (F3 design 2.10). It is the field's description, so a
 * screen reader hears it with the field: it must never contradict the code's chip. A message
 * about the cart's own code follows every quote; one about these dishes goes when they change.
 */

export type PromoMessage =
  | { tone: 'success' | 'neutral'; text: string }
  | { tone: 'error'; text: string; invalid: boolean; signInCode?: string }
  | { tone: 'limited' | 'offline'; text: string };

/** What the message slot is about. */
export type PromoNote =
  /**
   * The code attached to the cart: "applied, you save…" or the R9 shortfall, worked out again
   * from each quote. `message` is what was said when it was attached, shown until the first
   * quote with the code is back.
   */
  | {
      kind: 'code';
      code: string;
      message: PromoMessage;
      /**
       * The cart has been seen holding the code. Until then (the code is written to the cart
       * and read back a moment later) a different stored code doesn't clear the message.
       */
      seen?: boolean;
    }
  /** True only for these dishes (R8, or R9 for a code that wasn't attached): gone once they change. */
  | { kind: 'lines'; linesKey: string; message: PromoMessage }
  /** True whatever is in the cart (R1 to R7, offline, the guessing limit, the checker down). */
  | { kind: 'fixed'; message: PromoMessage };

interface QuotedLine {
  key: string;
  menuItemId: string;
  quantity: number;
}

/** The dishes and quantities a quote was for: what R8 and R9 depend on. */
export const linesKey = (lines: readonly QuotedLine[]) =>
  lines.map((line) => `${line.key}:${line.menuItemId}:${line.quantity}`).join('|');

/** Reasons that only hold for the dishes in the cart right now. */
export const dependsOnLines = (reason: PromoReason | null) =>
  reason?.code === 'notForTheseDishes' || reason?.code === 'minimumNotReached';

/** A note for a message about a code, kept for these lines when its reason depends on them. */
export function noteFor(
  message: PromoMessage,
  reason: PromoReason | null,
  lines: readonly QuotedLine[],
): PromoNote {
  return dependsOnLines(reason)
    ? { kind: 'lines', linesKey: linesKey(lines), message }
    : { kind: 'fixed', message };
}

export interface PromoFieldNow {
  /** The code attached to the cart. */
  storedCode: string | null;
  /** The promo part of the quote on screen (with the cart's code, when it has one). */
  promo: Pick<QuotePromo, 'code' | 'status' | 'message' | 'amountCents' | 'freeDelivery'> | null;
  /** linesKey() of the cart as it is now. */
  linesKey: string;
}

/** The message to show under the field now; null leaves the slot empty. */
export function promoFieldMessage(note: PromoNote | null, now: PromoFieldNow): PromoMessage | null {
  if (!note) return null;
  if (note.kind === 'fixed') return note.message;
  if (note.kind === 'lines') return note.linesKey === now.linesKey ? note.message : null;
  // The cart's own code: whatever the newest quote says about it, so it always matches the chip.
  if (now.storedCode !== note.code) return note.seen ? null : note.message;
  const promo = now.promo?.code === note.code ? now.promo : null;
  if (!promo) return note.message;
  if (promo.status === 'applied') return { tone: 'success', text: promoAppliedText(promo) };
  if (promo.status === 'notApplied') {
    return { tone: 'neutral', text: promo.message ?? note.message.text };
  }
  // Refused or unchecked: the code is coming off, and that answer says why.
  return null;
}
