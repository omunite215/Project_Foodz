/*
 * The site's live regions (rendered by LiveAnnouncer in the root layout). Anything that changes
 * without moving focus, like "Bulgogi added to your cart.", is announced through them: the
 * polite region for almost everything, the assertive one only for news a person must hear at
 * once (F5: a staff cancellation).
 */

export interface AnnounceOptions {
  /** Interrupts what the screen reader is saying. Use only where the design asks for it. */
  assertive?: boolean;
}

type Listener = (message: string, options: AnnounceOptions) => void;

const listeners = new Set<Listener>();

/** Reads a message to screen readers, once, without moving focus. */
export function announce(message: string, options: AnnounceOptions = {}): void {
  for (const listener of listeners) listener(message, options);
}

export function subscribeToAnnouncements(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Messages this close together are read as one, in the order they came. */
export const ANNOUNCEMENT_GATHER_MS = 50;
export const GATHER_MS = ANNOUNCEMENT_GATHER_MS;

/**
 * How long a message stays in the region once it has been handed to screen readers. They queue
 * what they were given, so emptying it doesn't cut the reading short; it only stops someone
 * browsing the page later from meeting words that no longer hold ("4 dishes" after Clear all).
 */
export const ANNOUNCEMENT_CLEAR_MS = 7000;

/**
 * What one live region holds over time. `write` is called with '' first (so a repeated message
 * is read again), then with every message gathered in the next 50 ms (one change can say two
 * things, "KBBQ5 applied…" and the new total, and a repeat in the same batch is read once), then
 * with '' again once it has been read.
 */
export function createAnnouncementQueue(
  write: (text: string) => void,
  timers: Pick<typeof globalThis, 'setTimeout' | 'clearTimeout'> = globalThis,
) {
  let gather: ReturnType<typeof setTimeout> | undefined;
  let clear: ReturnType<typeof setTimeout> | undefined;
  let pending: string[] = [];
  const stop = () => {
    timers.clearTimeout(gather);
    timers.clearTimeout(clear);
    pending = [];
  };
  return {
    push(message: string) {
      if (message && !pending.includes(message)) pending.push(message);
      write('');
      timers.clearTimeout(gather);
      timers.clearTimeout(clear);
      gather = timers.setTimeout(() => {
        write(pending.join(' '));
        pending = [];
        clear = timers.setTimeout(() => write(''), ANNOUNCEMENT_CLEAR_MS);
      }, ANNOUNCEMENT_GATHER_MS);
    },
    stop,
    dispose: stop,
  };
}

/** The polite region's queue (the name F3 and F4 use). */
export const announcementQueue = (show: (text: string) => void) => createAnnouncementQueue(show);
