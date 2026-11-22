import { describe, expect, it } from 'vitest';
import type { PromoReason, QuotePromo } from '@/server/modules/cart/schema';
import {
  dependsOnLines,
  linesKey,
  noteFor,
  type PromoMessage,
  type PromoNote,
  promoFieldMessage,
} from './promo-field';

/*
 * The message under the promo field (D2, S4.5, S4.6, S7.5): it is the field's description, so it
 * must say what the chip says after every quote, and go once it stops being true.
 */

const kimchi = (quantity: number) => ({ key: 'k1', menuItemId: 'kimchi', quantity });
const padThai = { key: 'p1', menuItemId: 'pad-thai', quantity: 1 };

const r9 = (eligibleCents: number): PromoReason => ({
  code: 'minimumNotReached',
  rule: 'R9',
  minSubtotalCents: 2500,
  eligibleCents,
  shortfallCents: 2500 - eligibleCents,
  cuisines: ['KOREAN'],
});

const shortfallMessage = (eligible: string, shortfall: string) =>
  `KBBQ5 needs $25.00 of Korean dishes. You have ${eligible}, so add ${shortfall} more.`;

const kbbq5 = (status: QuotePromo['status'], message: string | null = null) => ({
  code: 'KBBQ5',
  status,
  message,
  amountCents: status === 'applied' ? 500 : 0,
  freeDelivery: false,
});

/** The cart as it is now: KBBQ5 attached, Kimchi and Pad Thai in it. */
const now = (promo: ReturnType<typeof kbbq5> | null) => ({
  storedCode: 'KBBQ5',
  promo,
  linesKey: linesKey([kimchi(1), padThai]),
});

describe('the message about the cart’s own code', () => {
  const attached: PromoNote = {
    kind: 'code',
    code: 'KBBQ5',
    message: { tone: 'neutral', text: shortfallMessage('$6.99', '$18.01') },
  };

  it('turns to "applied" when the code applies by itself (S4.6)', () => {
    expect(promoFieldMessage(attached, now(kbbq5('applied')))).toEqual({
      tone: 'success',
      text: 'KBBQ5 applied. You save $5.00.',
    });
  });

  it('gives the new shortfall when the cart drops back under the minimum, never the old one', () => {
    const under = kbbq5('notApplied', shortfallMessage('$20.97', '$4.03'));
    expect(promoFieldMessage(attached, now(under))).toEqual({
      tone: 'neutral',
      text: shortfallMessage('$20.97', '$4.03'),
    });
  });

  it('keeps what was said until the first quote with the code is back', () => {
    expect(promoFieldMessage(attached, now(null))).toEqual(attached.message);
    expect(
      promoFieldMessage(attached, { ...now(null), promo: { ...kbbq5('applied'), code: 'OTHER' } }),
    ).toEqual(attached.message);
  });

  it('stands while the cart is still taking the code', () => {
    expect(promoFieldMessage(attached, { ...now(null), storedCode: null })).toEqual(
      attached.message,
    );
  });

  it('goes when the code comes off, is swapped, or is refused', () => {
    const seen: PromoNote = { ...attached, seen: true };
    expect(promoFieldMessage(seen, { ...now(kbbq5('applied')), storedCode: null })).toBeNull();
    expect(
      promoFieldMessage(seen, { ...now(kbbq5('applied')), storedCode: 'FREEDELIVERY' }),
    ).toBeNull();
    expect(promoFieldMessage(attached, now(kbbq5('refused', 'KBBQ5 is for Korean…')))).toBeNull();
  });
});

describe('a message about these dishes (R8, R9 for a code that stayed out)', () => {
  const before = [kimchi(1)];
  const r8: PromoMessage = {
    tone: 'error',
    text: 'KBBQ5 is for Korean dishes. Add a Korean dish to use it.',
    invalid: false,
  };
  const reason: PromoReason = { code: 'notForTheseDishes', rule: 'R8', cuisines: ['KOREAN'] };

  it('stays while the dishes are the same', () => {
    const note = noteFor(r8, reason, [padThai]);
    expect(note.kind).toBe('lines');
    expect(
      promoFieldMessage(note, { storedCode: null, promo: null, linesKey: linesKey([padThai]) }),
    ).toBe(r8);
  });

  it('goes once the dishes change: an Undo brings the Korean dish back (D2)', () => {
    const note = noteFor(r8, reason, [padThai]);
    const undone = linesKey([...before, padThai]);
    expect(promoFieldMessage(note, { storedCode: null, promo: null, linesKey: undone })).toBeNull();
  });

  it('goes when a quantity changes too', () => {
    const note = noteFor({ tone: 'neutral', text: 'R9 …' }, r9(699), [kimchi(1)]);
    expect(
      promoFieldMessage(note, { storedCode: null, promo: null, linesKey: linesKey([kimchi(2)]) }),
    ).toBeNull();
  });
});

describe('a message that holds whatever is in the cart', () => {
  it('stays: an unknown code, a code that ended, offline', () => {
    const message: PromoMessage = {
      tone: 'error',
      text: "We couldn't find the code NOPE. Check the spelling, or try another code.",
      invalid: true,
    };
    const note = noteFor(message, { code: 'notFound', rule: 'R1' }, [kimchi(1)]);
    expect(note.kind).toBe('fixed');
    expect(
      promoFieldMessage(note, { storedCode: 'KBBQ5', promo: null, linesKey: 'anything' }),
    ).toBe(message);
  });

  it('knows which reasons depend on the dishes', () => {
    expect(dependsOnLines({ code: 'notForTheseDishes', rule: 'R8', cuisines: ['KOREAN'] })).toBe(
      true,
    );
    expect(dependsOnLines(r9(699))).toBe(true);
    expect(dependsOnLines({ code: 'usedUp', rule: 'R4' })).toBe(false);
    expect(dependsOnLines(null)).toBe(false);
  });

  it('is empty with nothing to say', () => {
    expect(promoFieldMessage(null, { storedCode: null, promo: null, linesKey: '' })).toBeNull();
  });
});
