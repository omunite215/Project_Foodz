import { DbClient, type StorageApi, type StorageEventApi } from '@tanstack/react-db';
import { describe, expect, it, vi } from 'vitest';
import { cartActions, cartCollection, cartLineId, MAX_LINE_QUANTITY } from './cart';

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
    return { cart: client.collection(cartCollection), actions: cartActions(client) };
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

    one.insert({ id: 'x', menuItemId: RAMEN, flavors: [], quantity: 1 });

    expect(other.size).toBe(0);
  });
});
