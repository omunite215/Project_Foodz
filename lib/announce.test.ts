import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { announce, createAnnouncementQueue, GATHER_MS, subscribeToAnnouncements } from './announce';

describe('announce', () => {
  it('tells listeners whether a message is assertive', () => {
    const heard: [string, boolean][] = [];
    const stop = subscribeToAnnouncements((message, options) =>
      heard.push([message, Boolean(options.assertive)]),
    );
    announce('Order 1042 moved to Preparing');
    announce('Order 1046 was cancelled.', { assertive: true });
    stop();
    announce('not heard');
    expect(heard).toEqual([
      ['Order 1042 moved to Preparing', false],
      ['Order 1046 was cancelled.', true],
    ]);
  });
});

describe('the announcement queue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads messages that come within 50 ms together, once each, in order', () => {
    const written: string[] = [];
    const queue = createAnnouncementQueue((text) => written.push(text));
    queue.push('Order 1042 moved to Preparing');
    queue.push('Order 1043 moved to Ready');
    queue.push('Order 1042 moved to Preparing');
    vi.advanceTimersByTime(GATHER_MS);
    expect(written.at(-1)).toBe('Order 1042 moved to Preparing Order 1043 moved to Ready');
  });

  it('clears the region first, so a repeated message is read again', () => {
    const written: string[] = [];
    const queue = createAnnouncementQueue((text) => written.push(text));
    queue.push('Sound on');
    vi.advanceTimersByTime(GATHER_MS);
    queue.push('Sound on');
    vi.advanceTimersByTime(GATHER_MS);
    expect(written).toEqual(['', 'Sound on', '', 'Sound on']);
  });

  it('drops what is waiting when stopped', () => {
    const written: string[] = [];
    const queue = createAnnouncementQueue((text) => written.push(text));
    queue.push('Live updates paused');
    queue.stop();
    vi.advanceTimersByTime(GATHER_MS * 2);
    expect(written).toEqual(['']);
  });
});
