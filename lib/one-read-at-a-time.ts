/**
 * One read at a time. A request while a read runs asks for one more read after it, however
 * many requests arrive, so a burst of realtime messages costs two reads instead of a queue of
 * them. Next.js sends a page's server actions one after another: without this, the read that
 * matters (a courier taken off, F7 S4.1) waits behind every read queued before it.
 */
export function oneReadAtATime(read: () => Promise<unknown>): () => Promise<void> {
  let running: Promise<void> | null = null;
  let again = false;

  const loop = async (): Promise<void> => {
    again = false;
    // A failed read is the caller's to report; the next request reads again.
    await read().catch(() => undefined);
    if (again) return loop();
    running = null;
    return undefined;
  };

  return function request() {
    if (running) {
      again = true;
      return running;
    }
    running = loop();
    return running;
  };
}
