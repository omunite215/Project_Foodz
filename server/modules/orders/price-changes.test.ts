import { describe, expect, it } from 'vitest';
import type { Quote, QuoteLine } from '@/server/modules/cart/schema';
import { changeReason, priceChanges } from './price-changes';

const line = (
  key: string,
  title: string,
  unit: number,
  extra: Partial<QuoteLine> = {},
): QuoteLine => ({
  key,
  menuItemId: '01933b2e-7c4a-7d10-9b1a-2c3d4e5f6a7b',
  status: 'ok',
  dish: { title, slug: title.toLowerCase(), image: null, cuisine: 'KOREAN' },
  unitPriceCents: unit,
  quantity: 1,
  lineTotalCents: unit,
  inSubtotal: true,
  flavors: [],
  droppedFlavors: [],
  flavorsOffered: [],
  note: null,
  ...extra,
});

const quoteWith = (lines: QuoteLine[], extra: Partial<Quote> = {}) =>
  ({
    lines,
    promo: null,
    delivery: {
      address: { id: 'a', label: 'Work', line1: '1 Faneuil Hall Square' },
      feeCents: 264,
    },
    ...extra,
  }) as unknown as Quote;

describe('what changed between the button and the press (S8.2)', () => {
  it('names a dish whose price moved', () => {
    const changes = priceChanges(
      {
        lines: [
          { key: 'a', unitPriceCents: 1299 },
          { key: 'b', unitPriceCents: 2199 },
        ],
      },
      quoteWith([line('a', 'Gimbap', 1399), line('b', 'Pad Thai', 2199)]),
    );
    expect(changes).toEqual([
      { kind: 'price', key: 'a', dish: 'Gimbap', wasCents: 1299, nowCents: 1399 },
    ]);
    expect(changeReason(changes[0]!)).toBe('Gimbap is now $13.99 (was $12.99)');
  });

  it('names an extra no longer offered, a new delivery fee and a smaller discount', () => {
    const changes = priceChanges(
      { lines: [], deliveryFeeCents: 264, promoAmountCents: 500 },
      quoteWith([line('a', 'Kimchi', 699, { droppedFlavors: ['Sesame oil'] })], {
        delivery: {
          address: { id: 'a', label: 'Work', line1: '1 Faneuil Hall Square' },
          feeCents: 289,
        } as Quote['delivery'],
        promo: { code: 'KBBQ5', amountCents: 400 } as Quote['promo'],
      }),
    );
    expect(changes.map(changeReason)).toEqual([
      "Sesame oil isn't offered for Kimchi any more",
      'delivery to Work is now $2.89 (was $2.64)',
      'KBBQ5 now takes off $4.00 (was $5.00)',
    ]);
  });

  it('says "other" when nothing it was shown explains the change (a tax rate, say)', () => {
    expect(priceChanges(undefined, quoteWith([line('a', 'Gimbap', 1299)]))).toEqual([
      { kind: 'other' },
    ]);
    expect(changeReason({ kind: 'other' })).toBeNull();
  });
});
