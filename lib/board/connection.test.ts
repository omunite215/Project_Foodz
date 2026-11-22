import { describe, expect, it } from 'vitest';
import {
  connectionBanner,
  type ConnectionInput,
  connectionKind,
  liveChipState,
  refreshInterval,
} from './connection';

const base: ConnectionInput = {
  configured: true,
  realtime: 'connected',
  online: true,
  signedOut: false,
  everConnected: true,
  droppedAt: null,
  startedAt: 0,
  catchingUp: false,
  now: 100_000,
};

const kind = (change: Partial<ConnectionInput>) => connectionKind({ ...base, ...change });

describe('the board connection (design 2.12)', () => {
  it('is live while connected', () => {
    expect(kind({})).toBe('live');
    expect(refreshInterval('live')).toBe(60_000);
  });

  it('changes nothing for a drop under 5 seconds, pauses until 30, then warns', () => {
    const dropped = { realtime: 'reconnecting' as const, droppedAt: 100_000 };
    expect(kind({ ...dropped, now: 104_999 })).toBe('live');
    expect(kind({ ...dropped, now: 105_000 })).toBe('paused');
    expect(kind({ ...dropped, now: 129_999 })).toBe('paused');
    expect(kind({ ...dropped, now: 130_000 })).toBe('outOfDate');
    expect(refreshInterval('paused')).toBe(10_000);
  });

  it('says "Reconnecting…" until the fresh copy arrives after a reconnect (A12.3)', () => {
    expect(kind({ catchingUp: true })).toBe('catchingUp');
    expect(liveChipState('catchingUp')).toBe('reconnecting');
    expect(connectionBanner('catchingUp')).toBeNull();
  });

  it('polls every 10 seconds when realtime is not set up or refused (A12.6)', () => {
    expect(kind({ configured: false })).toBe('polling');
    expect(kind({ realtime: 'unavailable' })).toBe('polling');
    expect(refreshInterval('polling')).toBe(10_000);
    expect(connectionBanner('polling')).toBe('noRealtime');
    expect(liveChipState('polling')).toBe('notLive');
  });

  it('gives a first connection 10 seconds before calling it unavailable', () => {
    const starting = { realtime: 'reconnecting' as const, everConnected: false, startedAt: 95_000 };
    expect(kind(starting)).toBe('live');
    expect(kind({ ...starting, startedAt: 90_000 })).toBe('polling');
  });

  it('puts offline and signed out first', () => {
    expect(kind({ online: false })).toBe('offline');
    expect(kind({ online: false, signedOut: true })).toBe('signedOut');
    expect(kind({ realtime: 'signedOut' })).toBe('signedOut');
    expect(refreshInterval('offline')).toBe(false);
    expect(connectionBanner('offline')).toBe('offline');
    expect(liveChipState('signedOut')).toBe('signedOut');
  });
});
