import { describe, expect, it } from 'vitest';
import { oneReadAtATime } from './one-read-at-a-time';

function deferredReads() {
  const pending: (() => void)[] = [];
  let count = 0;
  const read = () => {
    count += 1;
    return new Promise<void>((resolve) => pending.push(resolve));
  };
  const finishNext = async () => {
    pending.shift()?.();
    // Lets the loop see the settled read and start the next one.
    await Promise.resolve();
    await Promise.resolve();
  };
  return { read, finishNext, reads: () => count };
}

describe('one read at a time (F7 S4.1)', () => {
  it('turns a burst of requests during a read into one more read after it', async () => {
    const reads = deferredReads();
    const request = oneReadAtATime(reads.read);
    const first = request();
    void request();
    void request();
    void request();
    expect(reads.reads()).toBe(1);
    await reads.finishNext();
    expect(reads.reads()).toBe(2);
    await reads.finishNext();
    await first;
    expect(reads.reads()).toBe(2);
  });

  it('reads again for a request after the last read finished, and survives a failed read', async () => {
    let calls = 0;
    const request = oneReadAtATime(async () => {
      calls += 1;
      if (calls === 1) throw new Error('offline');
    });
    await request();
    await request();
    expect(calls).toBe(2);
  });
});
