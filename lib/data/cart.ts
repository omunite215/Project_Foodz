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
import { useEffect, useRef } from 'react';
import { z } from 'zod';

/*
 * The cart lives in the browser: saved in localStorage and kept in sync across tabs. It holds
 * only what the customer picked (item, flavors, quantity, a note for the kitchen), never prices. Totals always come
 * from the server.
 *
 * Components use the hooks at the bottom of this file and never TanStack DB directly, so the
 * storage engine can change without touching the UI.
 */

export const MAX_LINE_QUANTITY = 20;
export const MAX_NOTE_LENGTH = 200;

export const cartLineSchema = z.object({
  id: z.string().min(1),
  menuItemId: z.uuid(),
  flavors: z.array(z.string().min(1).max(40)).max(5),
  quantity: z.int().min(1).max(MAX_LINE_QUANTITY),
  note: z.string().min(1).max(MAX_NOTE_LENGTH).optional(),
});

export type CartLine = z.infer<typeof cartLineSchema>;

export interface NewCartLine {
  menuItemId: string;
  flavors?: readonly string[];
  quantity?: number;
  /** For the kitchen, up to 200 characters. Blank notes are not kept. */
  note?: string;
}

/** Surrounding spaces are dropped; an empty note is no note. */
export function cleanNote(note: string | undefined): string | undefined {
  const trimmed = note?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * The same dish with the same flavors and the same note is one line. A different note makes a
 * separate line, so adding the dish again never overwrites what was asked of the kitchen.
 */
export function cartLineId(menuItemId: string, flavors: readonly string[] = [], note?: string) {
  const id = [menuItemId, ...flavors.toSorted()].join('|');
  const kept = cleanNote(note);
  return kept ? `${id}#${encodeURIComponent(kept)}` : id;
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
    add({ menuItemId, flavors = [], quantity = 1, note }: NewCartLine) {
      const kept = cleanNote(note);
      const id = cartLineId(menuItemId, flavors, kept);
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
          ...(kept ? { note: kept } : {}),
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

// ------------------------------------------------------------------ cart and sessions (S5.10)

/*
 * A cart filled or kept while signed in belongs to that session on this device: when the session
 * ends (signed out here or elsewhere, a reset, deletion, suspension, 7 idle days) the cart is
 * emptied the next time the site loads. A guest cart is never touched. The session is
 * identified by an opaque key from the server, never by its token.
 */

export const CART_SESSION_STORAGE_KEY = 'foodz.cart.session';

export interface CartSessionCheck {
  /** The cart was kept for a session that has ended: empty it and say so. */
  emptyCart: boolean;
  /** The session the cart belongs to from now on (null: a guest cart). */
  owner: string | null;
}

export function cartSessionCheck(
  saved: string | null,
  current: string | null,
  hasItems: boolean,
): CartSessionCheck {
  return { emptyCart: saved !== null && saved !== current && hasItems, owner: current };
}

function readCartOwner(): string | null {
  try {
    return window.localStorage.getItem(CART_SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeCartOwner(owner: string | null) {
  try {
    if (owner) window.localStorage.setItem(CART_SESSION_STORAGE_KEY, owner);
    else window.localStorage.removeItem(CART_SESSION_STORAGE_KEY);
  } catch {
    // Storage blocked: the cart is simply not tied to the session.
  }
}

/**
 * Ties the cart to the signed-in session. Calls `onEmptied` once when a cart kept for a session
 * that has since ended was emptied, and `onSessionEnded` once when this device's session ended
 * some other way than signing out here (another device, a reset, deletion, 7 idle days) and
 * nobody is signed in now.
 */
export function useCartSession(
  sessionKey: string | null,
  onEmptied: () => void,
  onSessionEnded?: () => void,
) {
  const { isReady, itemCount } = useCart();
  const actions = useCartActions();
  const latest = useRef({ itemCount, actions, onEmptied, onSessionEnded });
  useEffect(() => {
    latest.current = { itemCount, actions, onEmptied, onSessionEnded };
  });

  useEffect(() => {
    if (!isReady) return;
    const {
      itemCount: count,
      actions: cart,
      onEmptied: emptied,
      onSessionEnded: ended,
    } = latest.current;
    const saved = readCartOwner();
    const check = cartSessionCheck(saved, sessionKey, count > 0);
    writeCartOwner(check.owner);
    if (check.emptyCart) {
      cart.clear();
      emptied();
    }
    // Signing out here forgets the owner first, so only an ending elsewhere gets this far.
    if (saved !== null && sessionKey === null) ended?.();
  }, [isReady, sessionKey]);
}

/** Signing out on purpose: the cart on this device is emptied (every tab follows). */
export function useEndCartSession() {
  const actions = useCartActions();
  return () => {
    writeCartOwner(null);
    actions.clear();
  };
}
