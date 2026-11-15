import {
  collectionOptions,
  type DbClient,
  localStorageCollectionOptions,
  type Parser,
  type StorageApi,
  type StorageEventApi,
  useDbClient,
  useLiveQuery,
} from '@tanstack/react-db';
import { z } from 'zod';

/*
 * The cart lives in the browser: saved in localStorage and kept in sync across tabs. It holds
 * only what the customer picked (item, flavors, quantity), never prices. Totals always come
 * from the server.
 *
 * Components use the hooks at the bottom of this file and never TanStack DB directly, so the
 * storage engine can change without touching the UI.
 */

export const MAX_LINE_QUANTITY = 20;

export const cartLineSchema = z.object({
  id: z.string().min(1),
  menuItemId: z.uuid(),
  flavors: z.array(z.string().min(1).max(40)).max(5),
  quantity: z.int().min(1).max(MAX_LINE_QUANTITY),
  note: z.string().max(200).optional(),
});

export type CartLine = z.infer<typeof cartLineSchema>;

export interface NewCartLine {
  menuItemId: string;
  flavors?: readonly string[];
  quantity?: number;
}

/** The same dish with the same flavors is one line. */
export function cartLineId(menuItemId: string, flavors: readonly string[] = []) {
  return [menuItemId, ...flavors.toSorted()].join('|');
}

const clampQuantity = (quantity: number) =>
  Math.min(MAX_LINE_QUANTITY, Math.max(1, Math.trunc(quantity)));

const storedLineSchema = z.object({ versionKey: z.string(), data: cartLineSchema });

/**
 * Anyone can edit localStorage, so the saved cart is checked line by line on load. Lines that
 * fail the schema are dropped instead of breaking every page that shows the cart.
 */
const savedCartParser: Parser = {
  stringify: (value) => JSON.stringify(value),
  parse(raw) {
    let saved: unknown;
    try {
      saved = JSON.parse(raw);
    } catch {
      return {};
    }
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {};
    return Object.fromEntries(
      Object.entries(saved).filter(([key, entry]) => {
        const line = storedLineSchema.safeParse(entry);
        return line.success && key.replace(/^s:/, '') === line.data.data.id;
      }),
    );
  },
};

export const cartCollection = collectionOptions('cart', (client) =>
  localStorageCollectionOptions({
    id: 'cart',
    storageKey: 'foodz.cart.v1',
    schema: cartLineSchema,
    getKey: (line) => line.id,
    parser: savedCartParser,
    // Load saved lines as soon as the collection exists, so actions never see an empty cart.
    startSync: true,
    // Both default to the window; tests pass their own.
    storage: client.getDependency<StorageApi>('storage'),
    storageEventApi: client.getDependency<StorageEventApi>('storageEvents'),
  }),
);

export function cartActions(client: DbClient) {
  const cart = client.collection(cartCollection);

  return {
    add({ menuItemId, flavors = [], quantity = 1 }: NewCartLine) {
      const id = cartLineId(menuItemId, flavors);
      if (cart.has(id)) {
        cart.update(id, (line) => {
          line.quantity = clampQuantity(line.quantity + quantity);
        });
      } else {
        cart.insert({
          id,
          menuItemId,
          flavors: flavors.toSorted(),
          quantity: clampQuantity(quantity),
        });
      }
    },

    /** A quantity below 1 removes the line. */
    setQuantity(id: string, quantity: number) {
      if (!cart.has(id)) return;
      if (quantity < 1) {
        cart.delete(id);
        return;
      }
      cart.update(id, (line) => {
        line.quantity = clampQuantity(quantity);
      });
    },

    remove(id: string) {
      if (cart.has(id)) cart.delete(id);
    },

    clear() {
      const ids = [...cart.keys()];
      if (ids.length > 0) cart.delete(ids);
    },
  };
}

export type CartActions = ReturnType<typeof cartActions>;

export function useCart() {
  const { data, isReady } = useLiveQuery({ query: (q) => q.from({ line: cartCollection }) });
  const lines: CartLine[] = data ?? [];
  return {
    lines,
    itemCount: lines.reduce((total, line) => total + line.quantity, 0),
    isReady,
  };
}

export function useCartActions(): CartActions {
  return cartActions(useDbClient());
}
