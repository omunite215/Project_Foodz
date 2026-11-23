import type { OrderSummary, OrderView } from '@/server/modules/orders/schema';
import type { SavedCardDto } from '@/server/modules/payments/schema';

/*
 * Orders as the server describes them (F4 contract 3), for stories and unit tests: Priya's cart A
 * to Work, 1.3 km, with the story's worked totals.
 */

const PLACED_AT = '2026-11-20T00:02:00.000Z';

export function orderViewFixture(overrides: Partial<OrderView> = {}): OrderView {
  return {
    id: '7b0a1c2e-4d5f-4a6b-8c9d-0e1f2a3b4c5d',
    number: '1042',
    createdAt: PLACED_AT,
    placedAt: PLACED_AT,
    status: 'PLACED',
    cancelReason: null,
    cancellable: true,
    payable: false,
    expiresAt: null,
    payment: { method: 'cash', status: 'UNPAID', card: null, decline: null },
    lines: [
      {
        title: 'Gimbap',
        flavors: ['Gochujang'],
        note: 'No cucumber please',
        quantity: 2,
        unitPriceCents: 1299,
        lineTotalCents: 2598,
      },
      {
        title: 'Pad Thai',
        flavors: [],
        note: null,
        quantity: 1,
        unitPriceCents: 2199,
        lineTotalCents: 2199,
      },
    ],
    kitchenNote: 'More spicy',
    breakdown: {
      subtotalCents: 4797,
      promo: null,
      deliveryFeeCents: 264,
      deliveryDiscountCents: 0,
      tax: { rateBps: 700, cents: 336 },
      tipCents: 0,
      tipChoice: 'none',
      totalCents: 5397,
    },
    refunds: { refundedCents: 0, entries: [] },
    dispute: { status: 'NONE', openedAt: null, closedAt: null },
    delivery: {
      label: 'Work',
      line1: '1 Faneuil Hall Square',
      line2: 'Apt 4',
      city: 'Boston, MA 02109',
      instructions: 'Buzzer 3, leave at the door',
      distanceKm: 1.3,
    },
    contact: { name: 'Priya Patel', firstName: 'Priya', phoneDisplay: '(617) 555-0123' },
    arrival: {
      fromMinutes: 33,
      toMinutes: 43,
      from: '2026-11-20T00:35:00.000Z',
      to: '2026-11-20T00:45:00.000Z',
    },
    timeline: [{ kind: 'placed', at: PLACED_AT, amountCents: null }],
    flags: { revivedAfterLatePayment: false, lateRefund: false, mismatchRefund: false },
    store: { phone: '(617) 555-0142', timeZone: 'America/New_York' },
    progress: {
      asOf: PLACED_AT,
      version: 1,
      steps: null,
      arrival: null,
      placedWaiting: 'none',
      deliveredAt: null,
      cashCollected: false,
      cancellation: null,
      live: true,
      refreshAt: null,
    },
    ...overrides,
  };
}

export const VISA = {
  brand: 'visa',
  last4: '4242',
  label: 'Visa •••• 4242',
  spoken: 'Visa ending in 4242',
};

/** A paid card order (15 % tip, T3). */
export const paidCardOrder = (overrides: Partial<OrderView> = {}) =>
  orderViewFixture({
    payment: { method: 'card', status: 'PAID', card: VISA, decline: null },
    breakdown: {
      subtotalCents: 4797,
      promo: null,
      deliveryFeeCents: 264,
      deliveryDiscountCents: 0,
      tax: { rateBps: 700, cents: 336 },
      tipCents: 720,
      tipChoice: '15',
      totalCents: 6117,
    },
    ...overrides,
  });

export function orderSummaryFixture(overrides: Partial<OrderSummary> = {}): OrderSummary {
  return {
    id: '7b0a1c2e-4d5f-4a6b-8c9d-0e1f2a3b4c5d',
    number: '1042',
    createdAt: PLACED_AT,
    dishes: [
      { title: 'Gimbap', quantity: 2 },
      { title: 'Pad Thai', quantity: 1 },
    ],
    moreCount: 0,
    totalCents: 5397,
    status: 'PLACED',
    statusWord: 'placed',
    method: 'cash',
    moneyFlag: null,
    arrival: null,
    reorderable: false,
    collected: false,
    ...overrides,
  };
}

export function savedCardFixture(overrides: Partial<SavedCardDto> = {}): SavedCardDto {
  return {
    id: 'pm_card_visa_4242',
    brand: 'visa',
    brandLabel: 'Visa',
    last4: '4242',
    expMonth: 12,
    expYear: 2034,
    expired: false,
    label: 'Visa •••• 4242',
    spoken: 'Visa ending in 4242',
    expiry: '12/34',
    lastUsedAt: '2026-11-18T23:00:00.000Z',
    ...overrides,
  };
}

/** The six steps with `current` at `at` (F5 design 6.4); earlier steps done a minute apart. */
export function stepsAt(
  current: 'placed' | 'accepted' | 'preparing' | 'ready' | 'pickedUp' | 'delivered',
  { collected = false }: { collected?: boolean } = {},
): NonNullable<OrderView['progress']['steps']> {
  const keys = ['placed', 'accepted', 'preparing', 'ready', 'pickedUp', 'delivered'] as const;
  const index = keys.indexOf(current);
  return keys.map((key, position) => ({
    key,
    state:
      position < index
        ? 'done'
        : position === index
          ? key === 'delivered'
            ? 'done'
            : 'current'
          : 'upcoming',
    at:
      position <= index ? new Date(Date.parse(PLACED_AT) + position * 60_000).toISOString() : null,
    collected: key === 'pickedUp' && collected,
  }));
}
