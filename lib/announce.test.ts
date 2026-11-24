import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ANNOUNCEMENT_CLEAR_MS,
  ANNOUNCEMENT_GATHER_MS,
  announce,
  announcementQueue,
  createAnnouncementQueue,
  GATHER_MS,
  subscribeToAnnouncements,
} from './announce';

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

/** A live region that records everything it was given to show. */
function region() {
  const shown: string[] = [];
  const queue = announcementQueue((text) => shown.push(text));
  return { shown, queue, last: () => shown.at(-1) };
}

describe('the live region over time', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads messages that arrive together as one, in order', () => {
    const { queue, last } = region();
    queue.push('KBBQ5 applied. You save $5.00.');
    queue.push('Total $50.12');
    vi.advanceTimersByTime(ANNOUNCEMENT_GATHER_MS);
    expect(last()).toBe('KBBQ5 applied. You save $5.00. Total $50.12');
  });

  it('empties itself once the message has been read, so stale words are not left behind', () => {
    const { queue, last } = region();
    queue.push('4 dishes between $6 and $15');
    vi.advanceTimersByTime(ANNOUNCEMENT_GATHER_MS);
    expect(last()).toBe('4 dishes between $6 and $15');
    vi.advanceTimersByTime(ANNOUNCEMENT_CLEAR_MS - 1);
    expect(last()).toBe('4 dishes between $6 and $15');
    vi.advanceTimersByTime(1);
    expect(last()).toBe('');
  });

  it('keeps a newer message for its full time, and reads a repeated message again', () => {
    const { queue, shown, last } = region();
    queue.push('Code copied');
    vi.advanceTimersByTime(ANNOUNCEMENT_GATHER_MS + ANNOUNCEMENT_CLEAR_MS - 10);
    queue.push('Code copied');
    vi.advanceTimersByTime(ANNOUNCEMENT_GATHER_MS);
    expect(shown.slice(-3)).toEqual(['Code copied', '', 'Code copied']);
    vi.advanceTimersByTime(ANNOUNCEMENT_CLEAR_MS - 1);
    expect(last()).toBe('Code copied');
  });

  it('stops when the region goes away', () => {
    const { queue, shown } = region();
    queue.push('Bulgogi added to your cart.');
    queue.dispose();
    vi.advanceTimersByTime(ANNOUNCEMENT_GATHER_MS + ANNOUNCEMENT_CLEAR_MS);
    expect(shown).toEqual(['']);
  });
});
