'use client';

import { useSyncExternalStore } from 'react';

/*
 * Orders that arrived while the tab was hidden (A3.1). Kept outside the board's state, so the
 * count survives anything that draws the board again, and cleared only when the tab is seen.
 */

let unseen = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function addUnseen(count: number) {
  if (count <= 0) return;
  unseen += count;
  emit();
}

export function clearUnseen() {
  if (unseen === 0) return;
  unseen = 0;
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useUnseen(): number {
  return useSyncExternalStore(
    subscribe,
    () => unseen,
    () => 0,
  );
}
