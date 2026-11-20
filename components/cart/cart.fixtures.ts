import type { Quote, QuoteLine, QuoteOffer, QuotePromo } from '@/server/modules/cart/schema';
import { gimbap, OFFER_ENDS_AT, padThai } from '@/components/storefront.fixtures';

/*
 * Sample quotes for Storybook, matching the worked quotes at 7 % (F3 design, "Story changes"):
 * cart A is 2 × Gimbap and 1 × Pad Thai, $47.97 of food. Only stories import this module.
 */

const line = (
  key: string,
  dish: typeof gimbap,
  quantity: number,
  fields: Partial<QuoteLine> = {},
): QuoteLine => ({
  key,
  menuItemId: dish.id,
  status: 'ok',
  dish: { title: dish.title, slug: dish.slug, image: dish.image, cuisine: dish.cuisine },
  unitPriceCents: dish.priceCents,
  quantity,
  lineTotalCents: dish.priceCents * quantity,
  inSubtotal: true,
  flavors: [],
  droppedFlavors: [],
  flavorsOffered: ['Gochujang', 'Sesame oil'],
  note: null,
  ...fields,
});

const offers: QuoteOffer[] = [
  {
    code: 'KBBQ5',
    description: '$5 off Korean dishes over $25',
    kind: 'fixed',
    campaignTitle: 'Korean BBQ weekend',
    endsAt: OFFER_ENDS_AT,
    status: 'applied',
    reason: null,
    message: null,
    amountCents: 500,
  },
  {
    code: 'FREEDELIVERY',
    description: 'Free delivery on orders over $30',
    kind: 'freeDelivery',
    campaignTitle: 'Free delivery',
    endsAt: new Date(Date.now() + 200 * 24 * 3600 * 1000).toISOString(),
    status: 'applied',
    reason: null,
    message: null,
    amountCents: 414,
  },
];

/** Q2: Dana, her default address 4.3 km away, no code: $55.47. */
export const quoteQ2: Quote = {
  quotedAt: new Date().toISOString(),
  lines: [line('a1', gimbap, 2), line('b2', padThai, 1, { flavorsOffered: ['Thai basil'] })],
  itemCount: 3,
  subtotalCents: 4797,
  promo: null,
  delivery: {
    kind: 'saved',
    address: {
      id: '0196a1b2-0000-7000-8000-0000000000aa',
      label: 'Home',
      line1: '12 Peterborough Street',
    },
    status: 'inside',
    distanceKm: 4.3,
    radiusKm: 8,
    edge: null,
    feeCents: 414,
    feeRange: { minCents: 199, maxCents: 599 },
    missingAddress: false,
  },
  tax: { rateBps: 700, cents: 336 },
  tipCents: 0,
  totalCents: 5547,
  totalKind: 'final',
  store: { timeZone: 'America/New_York', isOpen: true, opensAt: null, closesAt: null },
  offers,
  checkoutBlockers: [],
};

/** Q1: a guest, no address yet: $51.33 before delivery. */
export const quoteQ1: Quote = {
  ...quoteQ2,
  delivery: {
    ...quoteQ2.delivery,
    kind: 'none',
    address: null,
    status: 'unknown',
    distanceKm: null,
    feeCents: null,
  },
  totalCents: 5133,
  totalKind: 'beforeDelivery',
};

const applied = (fields: Partial<QuotePromo>): QuotePromo => ({
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

/** Q4: KBBQ5 applied: $50.12. */
export const quoteQ4: Quote = {
  ...quoteQ2,
  promo: applied({}),
  tax: { rateBps: 700, cents: 301 },
  totalCents: 5012,
};

/** Q5: FREEDELIVERY applied: delivery free (was $4.14), $51.33. */
export const quoteQ5: Quote = {
  ...quoteQ2,
  promo: applied({
    code: 'FREEDELIVERY',
    description: 'Free delivery on orders over $30',
    kind: 'freeDelivery',
    foodDiscountCents: 0,
    deliveryDiscountCents: 414,
    amountCents: 414,
    freeDelivery: true,
  }),
  totalCents: 5133,
};

/** Dana's saved address is now outside the area. */
export const quoteOutside: Quote = {
  ...quoteQ2,
  delivery: { ...quoteQ2.delivery, status: 'outside', distanceKm: 11.5, feeCents: null },
  totalCents: 5133,
  totalKind: 'beforeDelivery',
  checkoutBlockers: ['outside'],
};

/** A sold-out dish in the cart blocks checkout. */
export const quoteSoldOut: Quote = { ...quoteQ2, checkoutBlockers: ['soldOut'] };

/** The store is closed until 11 am tomorrow. */
export const quoteClosed: Quote = {
  ...quoteQ2,
  store: {
    timeZone: 'America/New_York',
    isOpen: false,
    opensAt: { at: OFFER_ENDS_AT, weekday: 'sat', time: '11:00', day: 'tomorrow' },
    closesAt: null,
  },
  checkoutBlockers: ['closed'],
};

export const offersFixture = offers;
