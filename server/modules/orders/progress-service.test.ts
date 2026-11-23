import { describe, expect, it } from 'vitest';
import { reorderOf, type ReorderSource } from './progress-service';

const ZONE = 'America/New_York';
// 7:30 pm in Boston.
const NOW = new Date('2026-11-21T00:30:00.000Z');
const GIMBAP = { id: 'dish-gimbap', title: 'Gimbap', isAvailable: true, flavors: ['Gochujang'] };
const PAD_THAI = { id: 'dish-pad-thai', title: 'Pad Thai', isAvailable: true, flavors: [] };

function source(extra: Partial<ReorderSource> = {}): ReorderSource {
  return {
    id: 'order-1046',
    number: '1046',
    cancelCode: null,
    cancelLineIds: [],
    cancelledAt: null,
    items: [
      {
        id: 'line-a',
        title: 'Gimbap',
        quantity: 2,
        flavors: ['Gochujang', 'Extra egg'],
        note: 'No cucumber please',
        menuItem: GIMBAP,
      },
      { id: 'line-b', title: 'Pad Thai', quantity: 1, flavors: [], note: null, menuItem: PAD_THAI },
    ],
    ...extra,
  };
}

describe('order again (S7.5, U24)', () => {
  it("gives today's dishes with the extras still offered, never a price", () => {
    const result = reorderOf(source(), NOW, ZONE);
    expect(result).toEqual({
      orderId: 'order-1046',
      number: '1046',
      lines: [
        {
          menuItemId: 'dish-gimbap',
          title: 'Gimbap',
          quantity: 2,
          flavors: ['Gochujang'],
          note: 'No cucumber please',
        },
        { menuItemId: 'dish-pad-thai', title: 'Pad Thai', quantity: 1, flavors: [] },
      ],
      addedQuantity: 3,
      leftOut: [{ kind: 'extraDropped', dish: 'Gimbap', extra: 'Extra egg' }],
    });
    expect(JSON.stringify(result)).not.toMatch(/Cents|code|tip|address/i);
  });

  it('leaves out sold-out dishes', () => {
    const result = reorderOf(
      source({
        items: [
          {
            id: 'line-b',
            title: 'Pad Thai',
            quantity: 1,
            flavors: [],
            note: null,
            menuItem: { ...PAD_THAI, isAvailable: false },
          },
        ],
      }),
      NOW,
      ZONE,
    );
    expect(result).toMatchObject({
      lines: [],
      addedQuantity: 0,
      leftOut: [{ kind: 'soldOut', dish: 'Pad Thai' }],
    });
  });

  it('leaves out what the kitchen ran out of the same store day, and only then', () => {
    const refused = source({
      cancelCode: 'dish-unavailable',
      cancelLineIds: ['line-b'],
      cancelledAt: new Date('2026-11-20T23:50:00.000Z'),
      items: [
        source().items[0]!,
        {
          id: 'line-b',
          title: 'Pad Thai',
          quantity: 1,
          flavors: [],
          note: null,
          menuItem: { ...PAD_THAI, isAvailable: false },
        },
      ],
    });
    expect(reorderOf(refused, NOW, ZONE).leftOut).toContainEqual({
      kind: 'kitchenRanOut',
      dish: 'Pad Thai',
    });
    expect(reorderOf(refused, NOW, ZONE).leftOut).not.toContainEqual(
      expect.objectContaining({ kind: 'soldOut' }),
    );
    // The next day the dish is back unless it is sold out.
    const nextDay = new Date('2026-11-22T00:30:00.000Z');
    const available = {
      ...refused,
      items: [refused.items[0]!, { ...refused.items[1]!, menuItem: PAD_THAI }],
    };
    expect(reorderOf(available, nextDay, ZONE).lines.map((line) => line.title)).toEqual([
      'Gimbap',
      'Pad Thai',
    ]);
  });
});
