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

/** Messages this close together are read as one, in the order they came. */
export const ANNOUNCEMENT_GATHER_MS = 50;

/**
 * How long a message stays in the region once it has been handed to screen readers. They queue
 * what they were given, so emptying it doesn't cut the reading short; it only stops someone
 * browsing the page later from meeting words that no longer hold ("4 dishes" after Clear all).
 */
export const ANNOUNCEMENT_CLEAR_MS = 7000;

/**
 * What the live region holds over time. `show` is called with '' first (so a repeated message
 * is read again), then with every message gathered in the next 50 ms, then with '' again once
 * it has been read.
 */
export function announcementQueue(show: (text: string) => void) {
  let gather: ReturnType<typeof setTimeout> | undefined;
  let clear: ReturnType<typeof setTimeout> | undefined;
  let pending: string[] = [];
  return {
    push(message: string) {
      // One change can say two things ("KBBQ5 applied…" and the new total): replacing the
      // first with the second would lose it, so both are read together.
      if (message && !pending.includes(message)) pending.push(message);
      show('');
      clearTimeout(gather);
      clearTimeout(clear);
      gather = setTimeout(() => {
        show(pending.join(' '));
        pending = [];
        clear = setTimeout(() => show(''), ANNOUNCEMENT_CLEAR_MS);
      }, ANNOUNCEMENT_GATHER_MS);
    },
    dispose() {
      clearTimeout(gather);
      clearTimeout(clear);
    },
  };
}
