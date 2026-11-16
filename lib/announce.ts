/*
 * One polite live region for the whole site (rendered by LiveAnnouncer in the layout). Anything
 * that changes without moving focus, like "Bulgogi added to your cart.", is announced through it.
 */

type Listener = (message: string) => void;

const listeners = new Set<Listener>();

/** Reads a message to screen readers, once, without moving focus. */
export function announce(message: string): void {
  for (const listener of listeners) listener(message);
}

export function subscribeToAnnouncements(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
