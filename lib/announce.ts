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
export const GATHER_MS = 50;

/**
 * Gathers messages for one live region: messages within 50 ms are read together (one change
 * can say two things, "KBBQ5 applied…" and the new total), a repeat in the same batch is read
 * once, and the region is cleared first so the same message said twice is read twice.
 */
export function createAnnouncementQueue(
  write: (text: string) => void,
  timers: Pick<typeof globalThis, 'setTimeout' | 'clearTimeout'> = globalThis,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: string[] = [];
  return {
    push(message: string) {
      if (message && !pending.includes(message)) pending.push(message);
      write('');
      timers.clearTimeout(timer);
      timer = timers.setTimeout(() => {
        write(pending.join(' '));
        pending = [];
      }, GATHER_MS);
    },
    stop() {
      timers.clearTimeout(timer);
      pending = [];
    },
  };
}
