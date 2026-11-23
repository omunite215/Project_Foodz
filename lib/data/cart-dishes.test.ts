import { DbClient, type StorageApi } from '@tanstack/react-db';
import { describe, expect, it } from 'vitest';
import { cartDishActions, cartDishesCollection, wereOffered } from './cart-dishes';

const GIMBAP = '0196a1b2-0000-7000-8000-000000000001';
const KIMCHI = '0196a1b2-0000-7000-8000-000000000002';

function tab(data = new Map<string, string>()) {
  const storage: StorageApi = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
  const client = new DbClient({
    storage,
    storageEvents: { addEventListener: () => {}, removeEventListener: () => {} },
  });
  return {
    data,
    dishes: client.collection(cartDishesCollection),
    actions: cartDishActions(client),
  };
}

const gimbap = { id: GIMBAP, title: 'Gimbap', slug: 'gimbap', image: '/Menu/Korean/gimbap.svg' };

describe('the cart display cache (F3 S2.10, B8)', () => {
  it('remembers what was shown when a dish was added, across a reload', () => {
    const { data, actions } = tab();
    actions.remember({ ...gimbap, priceCents: 1299 });
    expect(tab(data).dishes.get(GIMBAP)).toMatchObject({ ...gimbap, priceCents: 1299 });
  });

  it('keeps the last shown price until the new one is acknowledged', () => {
    const { dishes, actions } = tab();
    actions.remember({ ...gimbap, priceCents: 1299 });

    actions.learn([{ ...gimbap, title: 'Gimbap Roll', unitPriceCents: 1399, flavorsOffered: [] }]);
    expect(dishes.get(GIMBAP)).toMatchObject({ title: 'Gimbap Roll', priceCents: 1299 });

    actions.acknowledgePrices(new Map([[GIMBAP, 1399]]));
    expect(dishes.get(GIMBAP)?.priceCents).toBe(1399);
  });

  it('takes the quoted price for a dish it has never seen', () => {
    const { dishes, actions } = tab();
    actions.learn([
      {
        id: KIMCHI,
        title: 'Kimchi',
        slug: 'kimchi',
        image: null,
        unitPriceCents: 699,
        flavorsOffered: [],
      },
    ]);
    expect(dishes.get(KIMCHI)?.priceCents).toBe(699);
  });

  it('knows whether an extra the server took off was ever offered (S1.16, S3.4)', () => {
    const { data, dishes, actions } = tab();
    actions.remember({ ...gimbap, priceCents: 1299, flavorsOffered: ['Gochujang', 'Sesame oil'] });
    expect(wereOffered(dishes.get(GIMBAP), ['Sesame oil'])).toBe(true);
    expect(wereOffered(dishes.get(GIMBAP), ['Strawberry jam'])).toBe(false);
    expect(wereOffered(dishes.get(GIMBAP), ['Sesame oil', 'Strawberry jam'])).toBe(false);

    // A quote refreshes the list; it survives a reload with the rest of the entry.
    actions.learn([{ ...gimbap, unitPriceCents: 1299, flavorsOffered: ['Gochujang'] }]);
    const reloaded = tab(data).dishes.get(GIMBAP);
    expect(reloaded?.flavorsOffered).toEqual(['Gochujang']);
    expect(wereOffered(reloaded, ['Sesame oil'])).toBe(false);

    // An entry saved before the list existed knows nothing, so it never claims "any more".
    actions.remember({ id: KIMCHI, title: 'Kimchi', slug: 'kimchi', image: null, priceCents: 699 });
    expect(wereOffered(dishes.get(KIMCHI), ['Sesame oil'])).toBe(false);
  });

  it('keeps only dishes still in the cart', () => {
    const { dishes, actions } = tab();
    actions.remember({ ...gimbap, priceCents: 1299 });
    actions.remember({ id: KIMCHI, title: 'Kimchi', slug: 'kimchi', image: null, priceCents: 699 });
    actions.keepOnly(new Set([KIMCHI]));
    expect([...dishes.keys()]).toEqual([KIMCHI]);
  });

  it('never keeps a photo from another site, even if storage is edited', () => {
    const data = new Map<string, string>();
    data.set(
      'foodz.cart.dishes.v1',
      JSON.stringify({
        [`s:${GIMBAP}`]: {
          versionKey: 'a',
          data: { ...gimbap, image: 'https://evil.example/x.png', priceCents: 1 },
        },
      }),
    );
    const { dishes, actions } = tab(data);
    expect(dishes.size).toBe(0);
    actions.remember({ ...gimbap, image: '//evil.example/x.png', priceCents: 1299 });
    expect(dishes.size).toBe(0);
  });
});
