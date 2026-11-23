import { DbClient, type StorageApi, type StorageEventApi } from '@tanstack/react-db';
import { describe, expect, it, vi } from 'vitest';
import {
  cartActions,
  cartCollection,
  cartLineId,
  cartMetaCollection,
  cartSessionCheck,
  legacyLineKey,
  MAX_CART_LINES,
  MAX_LINE_QUANTITY,
  sortLines,
} from './cart';

const RAMEN = '0196a1b2-0000-7000-8000-000000000001';
const PHO = '0196a1b2-0000-7000-8000-000000000002';

type Listener = (event: StorageEvent) => void;

/** One fake localStorage shared by several "tabs", like a real browser profile. */
function fakeBrowser() {
  const data = new Map<string, string>();
  const tabs: Array<{ storage: StorageApi; listeners: Set<Listener> }> = [];

  const openTab = () => {
    const listeners = new Set<Listener>();
    const storage: StorageApi = {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, newValue) => {
        const oldValue = data.get(key) ?? null;
        data.set(key, newValue);
        // Browsers tell every other tab about a write, never the tab that made it.
        for (const tab of tabs) {
          if (tab.storage === storage) continue;
          const event = { key, oldValue, newValue, storageArea: tab.storage } as unknown;
          for (const listener of tab.listeners) listener(event as StorageEvent);
        }
      },
      removeItem: (key) => void data.delete(key),
    };
    const storageEvents: StorageEventApi = {
      addEventListener: (_type, listener) => void listeners.add(listener),
      removeEventListener: (_type, listener) => void listeners.delete(listener),
    };
    tabs.push({ storage, listeners });

    const client = new DbClient({ storage, storageEvents });
    return {
      client,
      cart: client.collection(cartCollection),
      meta: client.collection(cartMetaCollection),
      actions: cartActions(client),
    };
  };

  return { data, openTab };
}

describe('cart', () => {
  it('adds a line and saves it to storage', () => {
    const browser = fakeBrowser();
    const { cart, actions } = browser.openTab();

    actions.add({ menuItemId: RAMEN, flavors: ['spicy'], quantity: 2 });

    expect([...cart.values()]).toMatchObject([
      { id: cartLineId(RAMEN, ['spicy']), menuItemId: RAMEN, flavors: ['spicy'], quantity: 2 },
    ]);
    expect(browser.data.get('foodz.cart.v1')).toContain(RAMEN);
  });

  it('merges the same dish and flavors into one line, whatever the flavor order', () => {
    const { cart, actions } = fakeBrowser().openTab();

    actions.add({ menuItemId: RAMEN, flavors: ['spicy', 'egg'] });
    actions.add({ menuItemId: RAMEN, flavors: ['egg', 'spicy'], quantity: 2 });
    actions.add({ menuItemId: RAMEN, flavors: [] });

    expect(cart.size).toBe(2);
    expect(cart.get(cartLineId(RAMEN, ['egg', 'spicy']))?.quantity).toBe(3);
  });

  it('keeps the note for the kitchen with the line', () => {
    const browser = fakeBrowser();
    const { cart, actions } = browser.openTab();

    actions.add({ menuItemId: RAMEN, flavors: ['spicy'], note: '  No onions, please  ' });

    expect([...cart.values()]).toMatchObject([
      { menuItemId: RAMEN, flavors: ['spicy'], quantity: 1, note: 'No onions, please' },
    ]);
    expect(browser.data.get('foodz.cart.v1')).toContain('No onions, please');
    expect(
      browser.openTab().cart.get(cartLineId(RAMEN, ['spicy'], 'No onions, please')),
    ).toMatchObject({ note: 'No onions, please' });
  });

  it('never overwrites a note: a different note is a separate line', () => {
    const { cart, actions } = fakeBrowser().openTab();

    actions.add({ menuItemId: RAMEN, note: 'Extra sauce' });
    actions.add({ menuItemId: RAMEN, note: 'Extra sauce', quantity: 2 });
    actions.add({ menuItemId: RAMEN, note: 'No egg | no sauce' });
    actions.add({ menuItemId: RAMEN });

    expect(cart.size).toBe(3);
    expect(cart.get(cartLineId(RAMEN, [], 'Extra sauce'))).toMatchObject({
      note: 'Extra sauce',
      quantity: 3,
    });
    expect(cart.get(cartLineId(RAMEN, [], 'No egg | no sauce'))?.note).toBe('No egg | no sauce');
    expect(cart.get(cartLineId(RAMEN))?.note).toBeUndefined();
  });

  it('treats a blank note as no note', () => {
    const { cart, actions } = fakeBrowser().openTab();

    actions.add({ menuItemId: PHO, note: '   ' });
    actions.add({ menuItemId: PHO });

    expect(cart.size).toBe(1);
    expect(cart.get(cartLineId(PHO))).toMatchObject({ quantity: 2 });
    expect(cart.get(cartLineId(PHO))).not.toHaveProperty('note');
  });

  it('rejects a note over 200 characters instead of cutting it short', () => {
    const { cart, actions } = fakeBrowser().openTab();

    expect(() => actions.add({ menuItemId: PHO, note: 'x'.repeat(201) })).toThrow(
      /validation failed/,
    );
    actions.add({ menuItemId: PHO, note: 'x'.repeat(200) });
    expect(cart.size).toBe(1);
  });

  it('caps quantities and removes a line set below one', () => {
    const { cart, actions } = fakeBrowser().openTab();
    const id = cartLineId(PHO);

    actions.add({ menuItemId: PHO, quantity: 500 });
    expect(cart.get(id)?.quantity).toBe(MAX_LINE_QUANTITY);

    actions.setQuantity(id, 3.7);
    expect(cart.get(id)?.quantity).toBe(3);

    actions.setQuantity(id, 0);
    expect(cart.has(id)).toBe(false);
  });

  it('ignores changes to lines that are not in the cart', () => {
    const { cart, actions } = fakeBrowser().openTab();

    actions.setQuantity('missing', 2);
    actions.remove('missing');
    actions.clear();

    expect(cart.size).toBe(0);
  });

  it('rejects lines that fail the schema', () => {
    const { cart, actions } = fakeBrowser().openTab();

    expect(() => actions.add({ menuItemId: 'not-a-uuid' })).toThrow(/validation failed/);
    expect(cart.size).toBe(0);
  });

  it('restores the cart after a reload', () => {
    const browser = fakeBrowser();
    browser.openTab().actions.add({ menuItemId: RAMEN, quantity: 2 });

    const reloaded = browser.openTab();

    expect(reloaded.cart.get(cartLineId(RAMEN))?.quantity).toBe(2);
  });

  it('starts empty when the saved cart is corrupt', () => {
    const browser = fakeBrowser();
    browser.data.set('foodz.cart.v1', '{not json');

    const { cart, actions } = browser.openTab();
    expect(cart.size).toBe(0);

    actions.add({ menuItemId: RAMEN });
    expect(cart.size).toBe(1);
  });

  it('drops saved lines that fail the schema and keeps the rest', () => {
    const browser = fakeBrowser();
    const good = { id: cartLineId(PHO), menuItemId: PHO, flavors: [], quantity: 2 };
    const tampered = { id: cartLineId(RAMEN), menuItemId: RAMEN, flavors: [], quantity: 999 };
    browser.data.set(
      'foodz.cart.v1',
      JSON.stringify({
        [`s:${good.id}`]: { versionKey: 'a', data: good },
        [`s:${tampered.id}`]: { versionKey: 'b', data: tampered },
        's:wrong-key': { versionKey: 'c', data: good },
      }),
    );

    const { cart } = browser.openTab();

    expect([...cart.keys()]).toEqual([good.id]);
  });

  it('keeps open tabs in sync', async () => {
    const browser = fakeBrowser();
    const first = browser.openTab();
    const second = browser.openTab();

    first.actions.add({ menuItemId: PHO });
    // Browsers deliver storage events to other tabs asynchronously.
    await vi.waitFor(() => expect(second.cart.get(cartLineId(PHO))?.quantity).toBe(1));

    second.actions.clear();
    await vi.waitFor(() => expect(first.cart.size).toBe(0));
  });

  it('gives each server render its own cart', () => {
    // No storage: the collection falls back to memory, which must not leak between clients.
    const one = new DbClient().collection(cartCollection);
    const other = new DbClient().collection(cartCollection);

    one.insert({ id: 'x', menuItemId: RAMEN, flavors: [], quantity: 1, key: 'a', addedAt: 0 });

    expect(other.size).toBe(0);
  });
});

describe('cart lines keep their key and place (F3 S1.5, S1.7)', () => {
  it('gives each new line its own short key and keeps the order they were added in', () => {
    const { actions, cart } = fakeBrowser().openTab();
    actions.add({ menuItemId: RAMEN });
    actions.add({ menuItemId: PHO });
    actions.add({ menuItemId: RAMEN, note: 'Extra egg' });

    const lines = sortLines([...cart.values()]);
    expect(lines.map((line) => line.menuItemId)).toEqual([RAMEN, PHO, RAMEN]);
    const keys = lines.map((line) => line.key);
    expect(new Set(keys).size).toBe(3);
    for (const key of keys) expect(key).toMatch(/^[a-z0-9]{1,24}$/);
  });

  it('gives lines saved before keys existed a stable key and their saved order', () => {
    const browser = fakeBrowser();
    const first = { id: cartLineId(PHO), menuItemId: PHO, flavors: [], quantity: 1 };
    const second = { id: cartLineId(RAMEN), menuItemId: RAMEN, flavors: [], quantity: 2 };
    browser.data.set(
      'foodz.cart.v1',
      JSON.stringify({
        [`s:${first.id}`]: { versionKey: 'a', data: first },
        [`s:${second.id}`]: { versionKey: 'b', data: second },
      }),
    );

    const lines = sortLines([...browser.openTab().cart.values()]);
    expect(lines.map((line) => line.id)).toEqual([first.id, second.id]);
    expect(lines[0]?.key).toBe(legacyLineKey(first.id));
    expect(browser.openTab().cart.get(first.id)?.key).toBe(legacyLineKey(first.id));
  });

  it('edits a line in place, keeping its key and position', () => {
    const { actions, cart } = fakeBrowser().openTab();
    actions.add({ menuItemId: RAMEN, quantity: 2 });
    actions.add({ menuItemId: PHO });
    const before = cart.get(cartLineId(RAMEN))!;

    const outcome = actions.edit(before.id, { flavors: ['spicy'], note: 'No cucumber' });

    const id = cartLineId(RAMEN, ['spicy'], 'No cucumber');
    expect(outcome).toEqual({ kind: 'updated', id });
    expect(cart.has(before.id)).toBe(false);
    expect(cart.get(id)).toMatchObject({ key: before.key, addedAt: before.addedAt, quantity: 2 });
    expect(sortLines([...cart.values()]).map((line) => line.menuItemId)).toEqual([RAMEN, PHO]);
    expect(actions.edit(id, { flavors: ['spicy'], note: ' No cucumber ' })).toEqual({
      kind: 'unchanged',
      id,
    });
  });

  it('merges an edit that matches another line into the older one, up to 20', () => {
    const { actions, cart } = fakeBrowser().openTab();
    actions.add({ menuItemId: RAMEN, flavors: ['spicy'], quantity: 15 });
    actions.add({ menuItemId: RAMEN, quantity: 8 });
    const older = cart.get(cartLineId(RAMEN, ['spicy']))!;

    const outcome = actions.edit(cartLineId(RAMEN), { flavors: ['spicy'] });

    expect(outcome).toEqual({ kind: 'merged', id: older.id, quantity: 20, capped: true });
    expect(cart.size).toBe(1);
    expect(cart.get(older.id)).toMatchObject({ key: older.key, addedAt: older.addedAt });
  });

  it('puts a removed line back exactly as it was (S1.8)', () => {
    const { actions, cart } = fakeBrowser().openTab();
    actions.add({ menuItemId: PHO });
    actions.add({ menuItemId: RAMEN, flavors: ['egg'], quantity: 3, note: 'Hot' });
    actions.add({ menuItemId: PHO, note: 'Mild' });
    const id = cartLineId(RAMEN, ['egg'], 'Hot');
    const before = cart.get(id);

    const removed = actions.remove(id);
    expect(cart.has(id)).toBe(false);
    expect(actions.restore(removed!)).toBe(true);

    expect(cart.get(id)).toEqual(before);
    expect(sortLines([...cart.values()])[1]?.id).toBe(id);
  });
});

describe('cart limits (F3 S1.6, S1.11, S1.12)', () => {
  it('adds nothing to a line that already holds 20', () => {
    const { actions, cart } = fakeBrowser().openTab();
    actions.add({ menuItemId: PHO, quantity: 19 });
    expect(actions.add({ menuItemId: PHO, quantity: 3 })).toMatchObject({
      kind: 'added',
      quantity: 20,
    });
    expect(actions.add({ menuItemId: PHO })).toEqual({ kind: 'lineFull', id: cartLineId(PHO) });
    expect(cart.get(cartLineId(PHO))?.quantity).toBe(20);
  });

  it('stops at 50 items, also through the stepper', () => {
    const { actions, cart } = fakeBrowser().openTab();
    actions.add({ menuItemId: PHO, quantity: 20 });
    actions.add({ menuItemId: RAMEN, quantity: 20 });
    actions.add({ menuItemId: PHO, note: 'a', quantity: 9 });

    expect(actions.add({ menuItemId: RAMEN, note: 'b', quantity: 2 })).toEqual({
      kind: 'cartFull',
      limit: 'items',
    });
    actions.setQuantity(cartLineId(PHO, [], 'a'), 15);
    expect(cart.get(cartLineId(PHO, [], 'a'))?.quantity).toBe(10);
    expect([...cart.values()].reduce((sum, line) => sum + line.quantity, 0)).toBe(50);
  });

  it('stops at 25 different lines', () => {
    const { actions, cart } = fakeBrowser().openTab();
    for (let index = 0; index < MAX_CART_LINES; index += 1) {
      expect(actions.add({ menuItemId: PHO, note: `n${index}` }).kind).toBe('added');
    }
    expect(actions.add({ menuItemId: RAMEN })).toEqual({ kind: 'cartFull', limit: 'lines' });
    expect(cart.size).toBe(MAX_CART_LINES);
  });
});

describe("the cart's code and address (F3 B15, D18)", () => {
  it('keeps the code with the cart, synced to other tabs, and empties it with the cart', async () => {
    const browser = fakeBrowser();
    const first = browser.openTab();
    const second = browser.openTab();
    const metaOf = (tab: ReturnType<typeof browser.openTab>) => tab.meta.get('meta');

    first.actions.add({ menuItemId: PHO });
    first.actions.setCode('KBBQ5');
    first.actions.setAddressId('0196a1b2-0000-7000-8000-0000000000aa');
    await vi.waitFor(() => expect(metaOf(second)?.code).toBe('KBBQ5'));

    second.actions.clear();
    await vi.waitFor(() => expect(metaOf(first)?.code).toBeNull());
    expect(metaOf(first)?.addressId).toBe('0196a1b2-0000-7000-8000-0000000000aa');
    first.actions.forgetMeta();
    expect(metaOf(first)).toBeUndefined();
  });

  it('ignores a tampered saved code', () => {
    const browser = fakeBrowser();
    browser.data.set(
      'foodz.cart.meta.v1',
      JSON.stringify({
        's:meta': { versionKey: 'x', data: { id: 'meta', code: '<b>', addressId: 'no' } },
      }),
    );
    expect(browser.openTab().meta.size).toBe(0);
  });
});

describe('cart and sessions (S5.10)', () => {
  it('never touches a guest cart', () => {
    expect(cartSessionCheck(null, null, true)).toEqual({ emptyCart: false, owner: null });
  });

  it('keeps a guest cart on sign-in and ties it to the session', () => {
    expect(cartSessionCheck(null, 'session-a', true)).toEqual({
      emptyCart: false,
      owner: 'session-a',
    });
  });

  it('keeps the cart while the same session lasts', () => {
    expect(cartSessionCheck('session-a', 'session-a', true)).toEqual({
      emptyCart: false,
      owner: 'session-a',
    });
  });

  it('empties the cart once the session has ended', () => {
    expect(cartSessionCheck('session-a', null, true)).toEqual({ emptyCart: true, owner: null });
    expect(cartSessionCheck('session-a', 'session-b', true)).toEqual({
      emptyCart: true,
      owner: 'session-b',
    });
  });

  it('has nothing to empty in an empty cart', () => {
    expect(cartSessionCheck('session-a', null, false)).toEqual({ emptyCart: false, owner: null });
  });
});
