// @vitest-environment jsdom
import { DbClient, DbProvider, type StorageApi, type StorageEventApi } from '@tanstack/react-db';
import { createElement, Fragment, use } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { cartActions, useCart } from './cart';

const RAMEN = '0196a1b2-0000-7000-8000-000000000001';

function fakeStorage(): { storage: StorageApi; storageEvents: StorageEventApi } {
  const data = new Map<string, string>();
  return {
    storage: {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => void data.set(key, value),
      removeItem: (key) => void data.delete(key),
    },
    storageEvents: { addEventListener() {}, removeEventListener() {} },
  };
}

/** Like the header's bag: the cart's state is an attribute, which hydration does not correct. */
function Bag() {
  const { itemCount, isReady } = useCart();
  return createElement('button', { 'aria-label': isReady ? `Cart, ${itemCount}` : 'Cart' });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Draws the bag on the "server", then hydrates it in the browser. A sibling holds the first
 * hydration attempt for `holdMs`, as a script or data chunk still on its way does, so React
 * renders the bag again once it arrives.
 */
async function hydrateBag(browser: ReturnType<typeof fakeStorage>, holdMs: number) {
  const { promise: chunk, resolve: arrive } = Promise.withResolvers<void>();
  let inBrowser = false;
  function Late() {
    if (inBrowser) use(chunk);
    return null;
  }
  const page = (client: DbClient) =>
    createElement(
      DbProvider,
      { client },
      createElement(Fragment, null, createElement(Bag), createElement(Late)),
    );

  const container = document.createElement('div');
  container.innerHTML = renderToString(page(new DbClient(fakeStorage())));
  document.body.append(container);
  inBrowser = true;
  const hydrationErrors: unknown[] = [];
  hydrateRoot(container, page(new DbClient(browser)), {
    onRecoverableError: (error) => hydrationErrors.push(error),
  });
  await sleep(holdMs);
  arrive();
  await sleep(300);
  return {
    label: container.querySelector('button')?.getAttribute('aria-label'),
    hydrationErrors,
  };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('the cart after hydration', () => {
  it('counts once the page has hydrated, also when hydration had to wait', async () => {
    // Long enough for the first attempt's query to be collected, which loads the saved cart
    // before the bag is drawn again.
    for (const holdMs of [0, 400]) {
      expect(await hydrateBag(fakeStorage(), holdMs)).toEqual({
        label: 'Cart, 0',
        hydrationErrors: [],
      });
    }
  });

  it('shows a saved cart after hydration without a mismatch', async () => {
    const browser = fakeStorage();
    cartActions(new DbClient(browser)).add({ menuItemId: RAMEN, quantity: 2 });
    expect(await hydrateBag(browser, 400)).toEqual({ label: 'Cart, 2', hydrationErrors: [] });
  });
});
