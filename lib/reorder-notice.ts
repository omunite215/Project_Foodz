import { useSyncExternalStore } from 'react';

/*
 * What "Order again" left out (F5 design 8 step 3), for the cart's notice: one sentence per
 * dish or extra. It stays until dismissed or the cart closes; this tab only.
 */

let leftOut: readonly string[] = [];
const listeners = new Set<() => void>();
const notify = () => {
  for (const listener of listeners) listener();
};

export function setReorderLeftOut(sentences: readonly string[]): void {
  leftOut = sentences;
  notify();
}

export function clearReorderLeftOut(): void {
  if (leftOut.length === 0) return;
  leftOut = [];
  notify();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const NONE: readonly string[] = [];

export function useReorderLeftOut(): readonly string[] {
  return useSyncExternalStore(
    subscribe,
    () => leftOut,
    () => NONE,
  );
}
