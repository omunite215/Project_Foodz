import { useSyncExternalStore } from 'react';

/*
 * Whether the cart is open in this tab, and what opened it (F3 design 2.2). The header's bag owns
 * the dialog; "View cart" on the dish page and the taste picker open it from here, and get the
 * focus back when it closes (D3). Each tab has its own; the lines sync through the data layer.
 */

let open = false;
let opener: HTMLElement | null = null;
const listeners = new Set<() => void>();

const notify = () => {
  for (const listener of listeners) listener();
};

/** Opens the cart; focus returns to `from` when it closes. */
export function openCart(from?: HTMLElement | null) {
  opener = from ?? null;
  if (open) return;
  open = true;
  notify();
}

export function closeCart() {
  if (!open) return;
  open = false;
  notify();
}

/** The element to focus when the cart closes, once (null: the header's bag). */
export function takeCartOpener(): HTMLElement | null {
  const element = opener;
  opener = null;
  return element;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useCartOpen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => open,
    () => false,
  );
}
