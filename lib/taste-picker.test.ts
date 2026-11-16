import { describe, expect, it } from 'vitest';
import {
  newTasteRow,
  NO_DISH_MESSAGE,
  soldOutText,
  tasteLines,
  tastePickerSchema,
  tasteSubtotalCents,
} from './taste-picker';

const GIMBAP = 'gimbap-id';
const KIMCHI = 'kimchi-id';
const prices = new Map([
  [GIMBAP, 1299],
  [KIMCHI, 699],
]);

describe('taste picker', () => {
  it('asks for at least one dish, on the first row', () => {
    const result = tastePickerSchema.safeParse({ rows: [{ key: 'a', dishId: '', quantity: 1 }] });

    expect(result.success).toBe(false);
    expect(result.error?.issues).toMatchObject([
      { message: NO_DISH_MESSAGE, path: ['rows', 0, 'dishId'] },
    ]);
  });

  it('ignores empty rows when another row has a dish', () => {
    const rows = [
      { key: 'a', dishId: '', quantity: 3 },
      { key: 'b', dishId: GIMBAP, quantity: 2 },
    ];

    expect(tastePickerSchema.safeParse({ rows }).success).toBe(true);
    expect(tasteLines(rows)).toEqual([{ dishId: GIMBAP, quantity: 2 }]);
  });

  it('keeps quantities between 1 and 20', () => {
    expect(
      tastePickerSchema.safeParse({ rows: [{ key: 'a', dishId: GIMBAP, quantity: 0 }] }).success,
    ).toBe(false);
    expect(
      tastePickerSchema.safeParse({ rows: [{ key: 'a', dishId: GIMBAP, quantity: 21 }] }).success,
    ).toBe(false);
  });

  it('gives every new row its own key', () => {
    expect(newTasteRow().key).not.toBe(newTasteRow().key);
  });

  it('adds up the same dish chosen twice, up to 20', () => {
    expect(
      tasteLines([
        { dishId: KIMCHI, quantity: 15 },
        { dishId: KIMCHI, quantity: 10 },
        { dishId: GIMBAP, quantity: 1 },
      ]),
    ).toEqual([
      { dishId: KIMCHI, quantity: 20 },
      { dishId: GIMBAP, quantity: 1 },
    ]);
  });

  it('works out the subtotal from real prices', () => {
    expect(tasteSubtotalCents([{ dishId: GIMBAP, quantity: 2 }], prices)).toBe(2598);
    expect(
      tasteSubtotalCents(
        [
          { dishId: GIMBAP, quantity: 1 },
          { dishId: KIMCHI, quantity: 3 },
          { dishId: '', quantity: 5 },
        ],
        prices,
      ),
    ).toBe(1299 + 3 * 699);
    expect(tasteSubtotalCents([{ dishId: '', quantity: 1 }], prices)).toBe(0);
  });

  it('names dishes that sold out before they could be added', () => {
    expect(soldOutText([])).toBeNull();
    expect(soldOutText(['Kimchi'])).toBe("Kimchi just sold out and wasn't added.");
    expect(soldOutText(['Kimchi', 'Gimbap', 'Bulgogi'])).toBe(
      "Kimchi, Gimbap and Bulgogi just sold out and weren't added.",
    );
  });
});
