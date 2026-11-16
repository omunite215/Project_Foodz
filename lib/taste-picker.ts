import { z } from 'zod';

/*
 * The Home "What's your taste?" picker: rows of dish + quantity that go into the cart together.
 * It asks for nothing else; sign-in and checkout collect names, addresses and payment.
 */

export const MAX_TASTE_QUANTITY = 20;
export const NO_DISH_MESSAGE = 'Choose at least one dish';

export const tasteRowSchema = z.object({
  /** Identifies the row while rows are added and removed. */
  key: z.string(),
  /** Empty until a dish is chosen ("Choose a dish"). */
  dishId: z.string(),
  quantity: z.int().min(1).max(MAX_TASTE_QUANTITY),
});
export type TasteRow = z.infer<typeof tasteRowSchema>;

/** Rows left on "Choose a dish" are ignored, as long as one row has a dish. */
export const tastePickerSchema = z
  .object({ rows: z.array(tasteRowSchema).min(1) })
  .superRefine((value, context) => {
    if (!value.rows.some((row) => row.dishId !== '')) {
      context.addIssue({ code: 'custom', message: NO_DISH_MESSAGE, path: ['rows', 0, 'dishId'] });
    }
  });
export type TastePickerValues = z.infer<typeof tastePickerSchema>;

let rowCount = 0;

export const newTasteRow = (): TasteRow => {
  rowCount += 1;
  return { key: `row-${rowCount}`, dishId: '', quantity: 1 };
};

type ChosenRow = Pick<TasteRow, 'dishId' | 'quantity'>;

export interface TasteLine {
  dishId: string;
  quantity: number;
}

/** The chosen dishes, one line per dish (the same dish in two rows is added up, up to 20). */
export function tasteLines(rows: readonly ChosenRow[]): TasteLine[] {
  const lines = new Map<string, number>();
  for (const row of rows) {
    if (!row.dishId) continue;
    lines.set(row.dishId, (lines.get(row.dishId) ?? 0) + row.quantity);
  }
  return [...lines].map(([dishId, quantity]) => ({
    dishId,
    quantity: Math.min(MAX_TASTE_QUANTITY, quantity),
  }));
}

/** The subtotal in cents, before delivery and tax; dishes without a known price count as 0. */
export function tasteSubtotalCents(
  rows: readonly ChosenRow[],
  priceById: ReadonlyMap<string, number>,
): number {
  return tasteLines(rows).reduce(
    (total, line) => total + (priceById.get(line.dishId) ?? 0) * line.quantity,
    0,
  );
}

/** "Kimchi just sold out and wasn't added." / "Kimchi and Gimbap just sold out and weren't added." */
export function soldOutText(names: readonly string[]): string | null {
  if (names.length === 0) return null;
  const list =
    names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`;
  return `${list} just sold out and ${names.length === 1 ? "wasn't" : "weren't"} added.`;
}
