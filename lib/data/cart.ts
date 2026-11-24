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
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { z } from 'zod';
import { forgetCheckout } from '@/lib/checkout-storage';
import { clearPendingFavorite, clearPendingPromo } from '@/lib/sign-in-reason';
import { useHydrated } from '@/lib/use-hydrated';
import { type CartDishActions, useCartDishActions } from './cart-dishes';
import { setCheckedAddress } from './checked-address';

/*
 * The cart lives in the browser: saved in localStorage and kept in sync across tabs. It holds
 * only what the customer picked (item, flavors, quantity, a note for the kitchen), never prices. Totals always come
 * from the server.
 *
 * Next to the lines it keeps the cart's promo code and chosen saved address (F3 B15, D18): the
 * code only, never an amount, and the address id only.
 *
 * Components use the hooks at the bottom of this file and never TanStack DB directly, so the
 * storage engine can change without touching the UI.
 */

export const MAX_LINE_QUANTITY = 20;
export const MAX_CART_LINES = 25;
export const MAX_CART_ITEMS = 50;
export const MAX_NOTE_LENGTH = 200;
export const MAX_FLAVORS = 5;
export const MAX_CODE_LENGTH = 32;

const LINE_KEY = /^[a-z0-9]{1,24}$/;

export const cartLineSchema = z.object({
  id: z.string().min(1),
  menuItemId: z.uuid(),
  flavors: z.array(z.string().min(1).max(40)).max(MAX_FLAVORS),
  quantity: z.int().min(1).max(MAX_LINE_QUANTITY),
  note: z.string().min(1).max(MAX_NOTE_LENGTH).optional(),
  /**
   * The line's own short key, kept for its whole life (also when its flavors or note change, which
   * changes `id`). The quote is sent this key, never the id, which holds the note.
   */
  key: z.string().regex(LINE_KEY),
  /** Lines show in the order they were added; an edited line keeps its place. */
  addedAt: z.int().min(0),
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

/** A new line's key: 13 random base-36 characters. */
export function newLineKey(): string {
  const [a = 0, b = 0] = crypto.getRandomValues(new Uint32Array(2));
  return `${a.toString(36)}${b.toString(36)}`.slice(0, 13) || '0';
}

/** FNV-1a, for the keys of lines saved before keys existed: the same id always gives the same key. */
function fnv(text: string, seed: number): string {
  let hash = seed;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

export const legacyLineKey = (id: string) => `${fnv(id, 0x811c9dc5)}${fnv(id, 0x01000193)}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const storedLineSchema = z.object({ versionKey: z.string(), data: cartLineSchema });

/** Lines saved by the first version of the cart have no key or order yet: give them one. */
function upgradeSavedLine(entry: unknown, index: number): unknown {
  if (!isRecord(entry) || !isRecord(entry.data) || typeof entry.data.id !== 'string') return entry;
  return { ...entry, data: { key: legacyLineKey(entry.data.id), addedAt: index, ...entry.data } };
}

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
    if (!isRecord(saved)) return {};
    const kept: Record<string, unknown> = {};
    Object.entries(saved).forEach(([key, entry], index) => {
      const line = storedLineSchema.safeParse(upgradeSavedLine(entry, index));
      if (line.success && key.replace(/^s:/, '') === line.data.data.id) kept[key] = line.data;
    });
    return kept;
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

// ------------------------------------------------------------------ the cart's code and address

const META_ID = 'meta';

export const cartMetaSchema = z.object({
  id: z.literal(META_ID),
  /** The applied code, as the server normalised it ("KBBQ5"); checked again in every quote. */
  code: z.string().min(1).max(MAX_CODE_LENGTH).regex(/^\S+$/u).nullable(),
  /** The saved address chosen with "Change"; null means the default one. */
  addressId: z.uuid().nullable(),
  /**
   * The order that just emptied the cart (F4 B16): the cart says so until she dismisses it or
   * adds a dish. It belongs to the session, like the rest of the meta.
   */
  placed: z
    .object({ orderId: z.uuid(), number: z.string().min(1).max(20) })
    .nullable()
    .optional(),
});
export type CartMeta = z.infer<typeof cartMetaSchema>;

const storedMetaSchema = z.object({ versionKey: z.string(), data: cartMetaSchema });

const savedMetaParser: Parser = {
  stringify: (value) => JSON.stringify(value),
  parse(raw) {
    try {
      const saved: unknown = JSON.parse(raw);
      if (!isRecord(saved)) return {};
      const meta = storedMetaSchema.safeParse(saved[`s:${META_ID}`]);
      return meta.success ? { [`s:${META_ID}`]: meta.data } : {};
    } catch {
      return {};
    }
  },
};

export const cartMetaCollection = collectionOptions('cartMeta', (client) =>
  localStorageCollectionOptions({
    id: 'cartMeta',
    storageKey: 'foodz.cart.meta.v1',
    schema: cartMetaSchema,
    getKey: (meta) => meta.id,
    parser: savedMetaParser,
    startSync: true,
    storage: client.getDependency<StorageApi>('storage'),
    storageEventApi: client.getDependency<StorageEventApi>('storageEvents'),
  }),
);

const NO_META: Omit<CartMeta, 'id'> = { code: null, addressId: null, placed: null };

// ------------------------------------------------------------------ actions

export type AddOutcome =
  /** `quantity` is what the line holds now. */
  | { kind: 'added'; id: string; quantity: number }
  /** The line already holds 20: nothing was added (S1.11). */
  | { kind: 'lineFull'; id: string }
  /** 50 items or 25 lines: nothing was added (S1.12). */
  | { kind: 'cartFull'; limit: 'items' | 'lines' };

export type EditOutcome =
  | { kind: 'unchanged'; id: string }
  | { kind: 'updated'; id: string }
  /** The edit made it the same as another line; the older line kept its place (S1.7). */
  | { kind: 'merged'; id: string; quantity: number; capped: boolean };

const itemsIn = (lines: Iterable<CartLine>) => {
  let total = 0;
  for (const line of lines) total += line.quantity;
  return total;
};

export function cartActions(client: DbClient) {
  const cart = client.collection(cartCollection);
  const meta = client.collection(cartMetaCollection);

  const nextAddedAt = () => {
    let latest = 0;
    for (const line of cart.values()) latest = Math.max(latest, line.addedAt);
    return Math.max(Date.now(), latest + 1);
  };

  const writeMeta = (change: Partial<Omit<CartMeta, 'id'>>) => {
    const current = meta.get(META_ID);
    if (current) {
      meta.update(META_ID, (draft) => {
        if ('code' in change) draft.code = change.code ?? null;
        if ('addressId' in change) draft.addressId = change.addressId ?? null;
        if ('placed' in change) draft.placed = change.placed ?? null;
      });
    } else {
      meta.insert({ id: META_ID, ...NO_META, ...change });
    }
  };

  return {
    add({ menuItemId, flavors = [], quantity = 1, note }: NewCartLine): AddOutcome {
      if (meta.get(META_ID)?.placed) writeMeta({ placed: null });
      const kept = cleanNote(note);
      const id = cartLineId(menuItemId, flavors, kept);
      const items = itemsIn(cart.values());
      const existing = cart.get(id);
      if (existing) {
        if (existing.quantity >= MAX_LINE_QUANTITY) return { kind: 'lineFull', id };
        const next = clampQuantity(existing.quantity + quantity);
        if (items - existing.quantity + next > MAX_CART_ITEMS) {
          return { kind: 'cartFull', limit: 'items' };
        }
        cart.update(id, (line) => {
          line.quantity = next;
        });
        return { kind: 'added', id, quantity: next };
      }
      if (cart.size >= MAX_CART_LINES) return { kind: 'cartFull', limit: 'lines' };
      const wanted = clampQuantity(quantity);
      if (items + wanted > MAX_CART_ITEMS) return { kind: 'cartFull', limit: 'items' };
      cart.insert({
        id,
        menuItemId,
        flavors: flavors.toSorted(),
        quantity: wanted,
        ...(kept ? { note: kept } : {}),
        key: newLineKey(),
        addedAt: nextAddedAt(),
      });
      return { kind: 'added', id, quantity: wanted };
    },

    /** A quantity below 1 removes the line; the cart never holds more than 50 items. */
    setQuantity(id: string, quantity: number) {
      const line = cart.get(id);
      if (!line) return;
      if (quantity < 1) {
        cart.delete(id);
        return;
      }
      const room = MAX_CART_ITEMS - (itemsIn(cart.values()) - line.quantity);
      const next = Math.min(clampQuantity(quantity), Math.max(line.quantity, room));
      if (next === line.quantity) return;
      cart.update(id, (draft) => {
        draft.quantity = next;
      });
    },

    /** Removes a line and hands it back, so it can be put back exactly (S1.8). */
    remove(id: string): CartLine | undefined {
      const line = cart.get(id);
      if (!line) return undefined;
      // A plain copy of the line's own fields, without the collection's bookkeeping.
      const copy = cartLineSchema.parse(line);
      cart.delete(id);
      return copy;
    },

    /** Puts a removed line back with its flavors, note, quantity and place. */
    restore(line: CartLine): boolean {
      const existing = cart.get(line.id);
      if (existing) {
        cart.update(line.id, (draft) => {
          draft.quantity = clampQuantity(existing.quantity + line.quantity);
        });
        return true;
      }
      if (cart.size >= MAX_CART_LINES || itemsIn(cart.values()) + line.quantity > MAX_CART_ITEMS) {
        return false;
      }
      cart.insert(line);
      return true;
    },

    /** New flavors or note for a line, in the same place; merges into a matching line (S1.7). */
    edit(id: string, change: { flavors: readonly string[]; note?: string }): EditOutcome {
      const line = cart.get(id);
      if (!line) return { kind: 'unchanged', id };
      const kept = cleanNote(change.note);
      const flavors = change.flavors.toSorted();
      const nextId = cartLineId(line.menuItemId, flavors, kept);
      if (nextId === id) return { kind: 'unchanged', id };

      const other = cart.get(nextId);
      if (other) {
        const older = other.addedAt <= line.addedAt ? other : line;
        const total = other.quantity + line.quantity;
        const quantity = Math.min(MAX_LINE_QUANTITY, total);
        cart.delete(id);
        cart.update(nextId, (draft) => {
          draft.quantity = quantity;
          draft.key = older.key;
          draft.addedAt = older.addedAt;
        });
        return { kind: 'merged', id: nextId, quantity, capped: total >= MAX_LINE_QUANTITY };
      }
      cart.delete(id);
      cart.insert({
        id: nextId,
        menuItemId: line.menuItemId,
        flavors,
        quantity: line.quantity,
        ...(kept ? { note: kept } : {}),
        key: line.key,
        addedAt: line.addedAt,
      });
      return { kind: 'updated', id: nextId };
    },

    /** Empties the cart and its code (every tab follows). */
    clear() {
      const ids = [...cart.keys()];
      if (ids.length > 0) cart.delete(ids);
      if (meta.get(META_ID)?.code) writeMeta({ code: null });
    },

    setCode(code: string | null) {
      if ((meta.get(META_ID)?.code ?? null) !== code) writeMeta({ code });
    },

    setAddressId(addressId: string | null) {
      if ((meta.get(META_ID)?.addressId ?? null) !== addressId) writeMeta({ addressId });
    },

    /** The order that emptied the cart (B16), or null once she has seen it. */
    setPlaced(placed: { orderId: string; number: string } | null) {
      if ((meta.get(META_ID)?.placed ?? null) !== placed) writeMeta({ placed });
    },

    /** Forgets the code and the chosen address: they belonged to the session that ended. */
    forgetMeta() {
      if (meta.has(META_ID)) meta.delete(META_ID);
    },
  };
}

export type CartActions = ReturnType<typeof cartActions>;

/** Lines in the order they were added. */
export const sortLines = (lines: readonly CartLine[]) =>
  lines.toSorted((a, b) => a.addedAt - b.addedAt || a.id.localeCompare(b.id));

/*
 * The server draws the page without the browser's cart, so while the page hydrates these hooks
 * give what the server had (no lines, not ready, no code) even when the saved cart has already
 * loaded, as it has when hydration is retried. React keeps the server's attributes where a
 * hydrating render differs, so the header would go on saying "Cart" with no count. Once
 * hydrated, the cart shows; on later pages it shows on the first render.
 */

export function useCart() {
  const hydrated = useHydrated();
  const { data, isReady } = useLiveQuery({ query: (q) => q.from({ line: cartCollection }) });
  const lines: CartLine[] = hydrated ? sortLines(data ?? []) : [];
  return {
    lines,
    itemCount: itemsIn(lines),
    isReady: hydrated && isReady,
  };
}

/** The cart's code and chosen address. */
export function useCartMeta(): Omit<CartMeta, 'id'> {
  const hydrated = useHydrated();
  const { data } = useLiveQuery({ query: (q) => q.from({ meta: cartMetaCollection }) });
  const row = hydrated ? data?.[0] : undefined;
  return row ? { code: row.code, addressId: row.addressId, placed: row.placed ?? null } : NO_META;
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
  const dishActions = useCartDishActions();
  const queryClient = useQueryClient();
  const latest = useRef({
    itemCount,
    actions,
    dishActions,
    onEmptied,
    onSessionEnded,
    queryClient,
  });
  useEffect(() => {
    latest.current = { itemCount, actions, dishActions, onEmptied, onSessionEnded, queryClient };
  });

  useEffect(() => {
    if (!isReady) return;
    const {
      itemCount: count,
      actions: cart,
      dishActions: dishes,
      onEmptied: emptied,
      onSessionEnded: ended,
      queryClient: queries,
    } = latest.current;
    const saved = readCartOwner();
    const check = cartSessionCheck(saved, sessionKey, count > 0);
    writeCartOwner(check.owner);
    // The chosen saved address, and what the ended session left in this browser, go with it.
    if (saved !== null && saved !== sessionKey) {
      cart.forgetMeta();
      forgetSessionTraces(dishes);
      queries.removeQueries(ORDER_QUERIES);
    }
    if (check.emptyCart) {
      cart.clear();
      emptied();
    }
    // Signing out here forgets the owner first, so only an ending elsewhere gets this far.
    if (saved !== null && sessionKey === null) ended?.();
  }, [isReady, sessionKey]);
}

/**
 * The demo visitor signs out to create an account (F4 D29): the cart built in this tab holds
 * nothing personal, so it stays, as a guest cart. Only the demo account's chosen address goes.
 */
export function useKeepCartAsGuest() {
  const actions = useCartActions();
  return () => {
    writeCartOwner(null);
    actions.setAddressId(null);
    setCheckedAddress(null);
  };
}

/** Signing out on purpose: the cart on this device is emptied (every tab follows). */
export function useEndCartSession() {
  const actions = useCartActions();
  const dishes = useCartDishActions();
  const queryClient = useQueryClient();
  return () => {
    writeCartOwner(null);
    actions.clear();
    actions.forgetMeta();
    forgetSessionTraces(dishes);
    queryClient.removeQueries(ORDER_QUERIES);
  };
}

/**
 * What a session leaves in this browser beyond the cart: the address checked without saving
 * it, the dish names and photos kept for the cart, and a code or heart waiting for sign-in.
 * On a shared device the next person must find none of it (F3 security S2).
 */
function forgetSessionTraces(dishes: Pick<CartDishActions, 'keepOnly'>) {
  setCheckedAddress(null);
  dishes.keepOnly(new Set());
  clearPendingPromo();
  clearPendingFavorite();
  forgetCheckout();
}

/** Her orders, as cached for the cart's unpaid-order notice and the like, go with the session. */
const ORDER_QUERIES = { queryKey: ['orders'] } as const;
