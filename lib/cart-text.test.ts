import { describe, expect, it } from 'vitest';
import type { Quote, QuoteDelivery, QuotePromo } from '@/server/modules/cart/schema';
import {
  cartButtonLabel,
  cartFullText,
  checkoutButtonState,
  cheaperSide,
  codeEndedText,
  type CompareSide,
  compareNoteText,
  compareSide,
  compareText,
  deliveryRowLabel,
  discountLabel,
  discountText,
  droppedFlavorText,
  lineSuffix,
  linesLabel,
  noLongerAppliedText,
  noteSnippet,
  orderingOpensText,
  outsideText,
  priceChangeText,
  promoAppliedText,
  shortfallText,
  storeClosedText,
  taxRateText,
  tooManyCodesText,
  totalAnnouncement,
  unitLabel,
  unitText,
} from './cart-text';

const GIMBAP = 'g';
const KIMCHI = 'k';

const delivery = (fields: Partial<QuoteDelivery>): QuoteDelivery => ({
  kind: 'saved',
  address: { id: 'a', label: 'Home', line1: '12 Peterborough Street' },
  status: 'inside',
  distanceKm: 4.3,
  radiusKm: 8,
  edge: null,
  feeCents: 414,
  feeRange: { minCents: 199, maxCents: 599 },
  missingAddress: false,
  ...fields,
});

describe('money in the cart (design §0)', () => {
  it('writes discounts with a real minus sign and reads them as "minus"', () => {
    expect(discountText(480)).toBe('−$4.80');
    expect(discountText(124950)).toBe('−$1,249.50');
    expect(discountLabel(480)).toBe('minus $4.80');
  });

  it('writes the tax rate without trailing zeros', () => {
    expect(taxRateText(700)).toBe('7%');
    expect(taxRateText(625)).toBe('6.25%');
    expect(taxRateText(1050)).toBe('10.5%');
  });

  it('counts items on the header button and the list', () => {
    expect(cartButtonLabel(null)).toBe('Cart');
    expect(cartButtonLabel(0)).toBe('Cart, empty');
    expect(cartButtonLabel(1)).toBe('Cart, 1 item');
    expect(cartButtonLabel(3)).toBe('Cart, 3 items');
    expect(linesLabel(1)).toBe('1 dish in your cart');
    expect(linesLabel(3)).toBe('3 dishes in your cart');
  });

  it('shows and reads the unit price', () => {
    expect(unitText(2, 1299)).toBe('2 × $12.99');
    expect(unitLabel(2, 1299)).toBe('2 times $12.99');
    expect(priceChangeText(1399, 1299)).toBe('Now $13.99 (was $12.99)');
  });

  it('announces the settled total', () => {
    expect(totalAnnouncement({ totalCents: 5547, totalKind: 'final' })).toBe('Total $55.47');
    expect(totalAnnouncement({ totalCents: 5133, totalKind: 'beforeDelivery' })).toBe(
      'Total before delivery $51.33',
    );
  });
});

describe('lines of the same dish (S7.2)', () => {
  const plain = { id: '1', menuItemId: GIMBAP, flavors: [] };
  const spicy = { id: '2', menuItemId: GIMBAP, flavors: ['Gochujang'] };
  const noted = {
    id: '3',
    menuItemId: GIMBAP,
    flavors: [],
    note: 'No cucumber please, and extra rice',
  };
  const kimchi = { id: '4', menuItemId: KIMCHI, flavors: [] };

  it('adds nothing when the dish has one line', () => {
    expect(lineSuffix(kimchi, [plain, kimchi])).toBe('');
  });

  it('tells lines apart by flavors, then note, then place', () => {
    const lines = [plain, spicy, noted, kimchi];
    expect(lineSuffix(spicy, lines)).toBe(' with Gochujang');
    expect(lineSuffix(noted, lines)).toBe(' with note No cucumber please, and…');
    expect(lineSuffix(plain, lines)).toBe(', line 1');
  });

  it('cuts notes at 24 characters', () => {
    expect(noteSnippet('Short')).toBe('Short');
    expect(noteSnippet('x'.repeat(30))).toBe(`${'x'.repeat(24)}…`);
  });

  it('says which flavor was taken off (S3.4)', () => {
    expect(droppedFlavorText(['Sesame oil'], 'Kimchi', { noLonger: true })).toBe(
      "Sesame oil isn't offered for Kimchi any more, so we took it off.",
    );
    expect(droppedFlavorText(['Garlic', 'Basil'], 'Pho', { noLonger: true })).toBe(
      "Garlic and Basil aren't offered for Pho any more, so we took them off.",
    );
  });

  it('never says "any more" for an extra the dish never offered (S1.16)', () => {
    expect(droppedFlavorText(['Strawberry jam'], 'Gimbap')).toBe(
      "Strawberry jam isn't offered for Gimbap, so we took it off.",
    );
  });
});

describe('notices (design 2.4)', () => {
  const at = '2026-11-20T16:00:00.000Z';
  it('says when the store opens', () => {
    expect(storeClosedText({ at, weekday: 'fri', time: '11:00', day: 'today' })).toBe(
      "We're closed right now. You can fill your cart and order from 11 am today.",
    );
    expect(orderingOpensText({ at, weekday: 'fri', time: '11:00', day: 'today' })).toBe(
      'Ordering opens at 11 am',
    );
    expect(orderingOpensText({ at, weekday: 'sat', time: '12:00', day: 'tomorrow' })).toBe(
      'Ordering opens at 12 pm tomorrow',
    );
  });

  it('names a code that ended, in the store time zone, with the new total', () => {
    expect(codeEndedText('KBBQ5', '2026-11-21T02:00:00.000Z', 'America/New_York', 5547)).toBe(
      "KBBQ5 ended at 9:00 pm, so it's no longer applied. Your total is now $55.47.",
    );
  });

  it('gives the phone number when the cart is full', () => {
    expect(cartFullText('items', '(617) 555-0142')).toBe(
      'Your cart is full (50 items). For a bigger order, call us on (617) 555-0142.',
    );
    expect(cartFullText('lines', '(617) 555-0142')).toBe(
      'Your cart is full (25 different dishes). For a bigger order, call us on (617) 555-0142.',
    );
  });
});

describe('delivery (design 2.15, 2.16)', () => {
  it('names the address and its distance, and the edge of the area in words', () => {
    expect(deliveryRowLabel(delivery({}))).toBe('Delivery to Home · 4.3 km');
    expect(
      deliveryRowLabel(delivery({ kind: 'point', address: null, distanceKm: 1.3, feeCents: 264 })),
    ).toBe('Delivery to your address · 1.3 km');
    expect(deliveryRowLabel(delivery({ edge: 'justUnder', distanceKm: 8 }))).toBe(
      'Delivery to Home · just under 8 km',
    );
    expect(
      deliveryRowLabel(
        delivery({ status: 'unknown', kind: 'none', address: null, distanceKm: null }),
      ),
    ).toBe('Delivery');
  });

  it('says why an address outside the area is refused, with the edge in words (S2.8)', () => {
    expect(
      outsideText(
        '1300 Hancock Street',
        delivery({ status: 'outside', distanceKm: 11.4, feeCents: null }),
      ),
    ).toBe(
      "We don't deliver to 1300 Hancock Street yet. It's about 11.4 km away, and we deliver within 8 km.",
    );
    expect(
      outsideText(
        'Quincy Center',
        delivery({ status: 'outside', distanceKm: 8, edge: 'justOver' }),
      ),
    ).toBe(
      "We don't deliver to Quincy Center yet. It's just over 8 km away, and we deliver within 8 km.",
    );
  });
});

/** A side of the compare card whose total already has delivery in it. */
const known = (code: string, totalCents: number): CompareSide => ({
  code,
  totalCents,
  note: null,
  toAdd: { minCents: 0, maxCents: 0 },
});

describe('promo codes (design 2.10 to 2.13)', () => {
  const r9 = {
    code: 'minimumNotReached' as const,
    rule: 'R9' as const,
    minSubtotalCents: 2500,
    eligibleCents: 699,
    shortfallCents: 1801,
    cuisines: ['KOREAN' as const],
  };

  it('says what an applied code saves', () => {
    expect(promoAppliedText({ code: 'KBBQ5', amountCents: 500, freeDelivery: false })).toBe(
      'KBBQ5 applied. You save $5.00.',
    );
    expect(promoAppliedText({ code: 'FREEDELIVERY', amountCents: 414, freeDelivery: true })).toBe(
      'FREEDELIVERY applied. You save $4.14.',
    );
    expect(promoAppliedText({ code: 'FREEDELIVERY', amountCents: 0, freeDelivery: true })).toBe(
      'FREEDELIVERY applied. Delivery will be free.',
    );
  });

  it('says what is missing for a code under its minimum (U3)', () => {
    expect(shortfallText(r9)).toBe('Add $18.01 of Korean dishes');
    expect(shortfallText({ ...r9, cuisines: [], shortfallCents: 801 })).toBe('Add $8.01 more');
    expect(
      noLongerAppliedText('WELCOME10', {
        ...r9,
        cuisines: [],
        minSubtotalCents: 1500,
        shortfallCents: 51,
      }),
    ).toBe(
      'WELCOME10 is no longer applied. It needs a subtotal of $15.00. Add $0.51 more to use it.',
    );
  });

  it('asks before swapping one code for another, with both totals (S4.7)', () => {
    expect(compareText(known('KBBQ5', 5012), known('FREEDELIVERY', 5133))).toBe(
      "Use FREEDELIVERY instead of KBBQ5? With KBBQ5 your total is $50.12. With FREEDELIVERY it's $51.33.",
    );
    expect(compareText(known('A', 100), known('B', 100))).toMatch(/Both give the same total\.$/);
    expect(cheaperSide(known('KBBQ5', 5012), known('FREEDELIVERY', 5133))).toBe('current');
  });

  it('gives the real wait after too many codes (S4.13)', () => {
    expect(tooManyCodesText(600)).toBe('Too many codes tried. You can try again in 10 minutes.');
    expect(tooManyCodesText(60)).toBe('Too many codes tried. You can try again in 1 minute.');
    expect(tooManyCodesText(45)).toBe('Too many codes tried. You can try again in 45 seconds.');
  });
});

// ------------------------------------------------------------------ whole quotes

const quoteOf = (fields: Partial<Quote>): Quote => ({
  quotedAt: '2026-11-21T17:00:00.000Z',
  lines: [],
  itemCount: 3,
  subtotalCents: 4797,
  promo: null,
  delivery: delivery({}),
  tax: { rateBps: 700, cents: 336 },
  tipCents: 0,
  totalCents: 5547,
  totalKind: 'final',
  store: { timeZone: 'America/New_York', isOpen: true, opensAt: null, closesAt: null },
  offers: [],
  checkoutBlockers: [],
  ...fields,
});

const promoOf = (fields: Partial<QuotePromo>): QuotePromo => ({
  code: 'KBBQ5',
  status: 'applied',
  reason: null,
  message: null,
  description: '$5 off Korean dishes over $25',
  kind: 'fixed',
  foodDiscountCents: 500,
  deliveryDiscountCents: 0,
  amountCents: 500,
  freeDelivery: false,
  retryAfterSeconds: null,
  ...fields,
});

const noAddress = delivery({
  kind: 'none',
  address: null,
  status: 'unknown',
  distanceKm: null,
  feeCents: null,
});

describe('the compare card before the address is known (S4.7, D5)', () => {
  // A guest with cart A: KBBQ5 leaves the fee out; FREEDELIVERY makes it free wherever it goes.
  const kbbq5 = compareSide(
    'KBBQ5',
    quoteOf({
      promo: promoOf({}),
      delivery: noAddress,
      totalCents: 4598,
      totalKind: 'beforeDelivery',
    }),
  );
  const freeDelivery = compareSide(
    'FREEDELIVERY',
    quoteOf({
      promo: promoOf({
        code: 'FREEDELIVERY',
        kind: 'freeDelivery',
        freeDelivery: true,
        foodDiscountCents: 0,
        amountCents: 0,
      }),
      delivery: noAddress,
      totalCents: 5133,
      totalKind: 'final',
    }),
  );

  it('says which total leaves delivery out', () => {
    expect(kbbq5).toMatchObject({
      note: 'beforeDelivery',
      toAdd: { minCents: 199, maxCents: 599 },
    });
    expect(freeDelivery).toMatchObject({
      note: 'freeDelivery',
      toAdd: { minCents: 0, maxCents: 0 },
    });
    expect(compareNoteText(kbbq5)).toBe('before delivery');
    expect(compareNoteText(freeDelivery)).toBe('free delivery');
    expect(compareNoteText(known('KBBQ5', 5012))).toBeNull();
  });

  it('calls neither cheaper when the delivery fee decides it, and says so', () => {
    // KBBQ5 costs $47.97 to $51.97 with delivery; FREEDELIVERY costs $51.33.
    expect(cheaperSide(kbbq5, freeDelivery)).toBe('unknown');
    expect(compareText(kbbq5, freeDelivery)).toBe(
      "Use FREEDELIVERY instead of KBBQ5? With KBBQ5 your total is $45.98 before delivery. With FREEDELIVERY it's $51.33 with free delivery. Which one saves more depends on your delivery fee ($1.99 to $5.99).",
    );
  });

  it('still picks one when it is cheaper whatever the fee', () => {
    const big = { ...kbbq5, totalCents: 4400 }; // at most $49.99 with delivery
    expect(cheaperSide(big, freeDelivery)).toBe('current');
    const small = { ...kbbq5, totalCents: 5000 }; // at least $51.99 with delivery
    expect(cheaperSide(small, freeDelivery)).toBe('next');
    expect(compareText(small, freeDelivery)).not.toMatch(/depends on/);
  });

  it('compares two food codes directly: the same fee comes on top of both', () => {
    const other = { ...kbbq5, code: 'TRY5', totalCents: 4620 };
    expect(cheaperSide(kbbq5, other)).toBe('current');
    expect(compareText(kbbq5, other)).toBe(
      "Use TRY5 instead of KBBQ5? With KBBQ5 your total is $45.98 before delivery. With TRY5 it's $46.20 before delivery.",
    );
  });

  it('reads a known address as a final total with nothing to add', () => {
    expect(compareSide('KBBQ5', quoteOf({ promo: promoOf({}), totalCents: 5012 }))).toEqual(
      known('KBBQ5', 5012),
    );
  });
});

describe('the checkout button and its line (design 2.17)', () => {
  const closedQuote = quoteOf({
    store: {
      timeZone: 'America/New_York',
      isOpen: false,
      opensAt: { at: '2026-11-22T17:00:00.000Z', weekday: 'sun', time: '12:00', day: 'today' },
      closesAt: null,
    },
    checkoutBlockers: ['closed'],
  });
  const outsidePoint = delivery({
    kind: 'point',
    address: null,
    status: 'outside',
    distanceKm: 11.4,
    feeCents: null,
  });

  it('shows the amount only when the total is final and nothing blocks it', () => {
    expect(checkoutButtonState(quoteOf({}), 'ready', false)).toEqual({
      reason: null,
      label: 'Go to checkout · $55.47',
      line: null,
    });
    expect(
      checkoutButtonState(
        quoteOf({ delivery: noAddress, totalKind: 'beforeDelivery', totalCents: 5133 }),
        'ready',
        false,
      ).label,
    ).toBe('Go to checkout');
  });

  it('blocks an address outside the area with its reason (S2.8)', () => {
    const outside = quoteOf({
      delivery: outsidePoint,
      totalKind: 'beforeDelivery',
      totalCents: 5133,
      checkoutBlockers: ['outside'],
    });
    expect(checkoutButtonState(outside, 'ready', false)).toEqual({
      reason: 'outside',
      label: 'Go to checkout',
      line: 'Choose an address we deliver to.',
    });
  });

  it('keeps saying when ordering opens while a total updates (F12)', () => {
    expect(checkoutButtonState(closedQuote, 'ready', false).label).toBe('Ordering opens at 12 pm');
    expect(checkoutButtonState(closedQuote, 'updating', false)).toEqual({
      reason: 'updating',
      label: 'Ordering opens at 12 pm',
      line: null,
    });
    expect(checkoutButtonState(closedQuote, 'updating', true).line).toBe('Updating your total…');
  });

  it('gives the outside reason on the line when the store is closed too', () => {
    const both = quoteOf({
      ...closedQuote,
      delivery: outsidePoint,
      checkoutBlockers: ['closed', 'outside'],
    });
    expect(checkoutButtonState(both, 'ready', false)).toEqual({
      reason: 'closed',
      label: 'Ordering opens at 12 pm',
      line: 'Choose an address we deliver to.',
    });
  });

  it('says a failed total failed, never as current', () => {
    expect(checkoutButtonState(null, 'failed', false)).toEqual({
      reason: 'failed',
      label: 'Go to checkout',
      line: "We couldn't update your total. Your cart is safe.",
    });
  });
});
