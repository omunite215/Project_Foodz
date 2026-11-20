import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

/**
 * False in the server's HTML and while the page hydrates; true once the page's own scripts are
 * running. Components rendered later in the browser get true on their first render.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
