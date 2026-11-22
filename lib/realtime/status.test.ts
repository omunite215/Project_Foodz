import { describe, expect, it } from 'vitest';
import { isSocketState, realtimeStatusOf, subscriptionErrorStatus } from './status';

describe('realtime status', () => {
  it('is connected only when subscribed on a live socket', () => {
    expect(realtimeStatusOf('connected', { kind: 'subscribed' }, true)).toBe('connected');
    expect(realtimeStatusOf('connected', { kind: 'pending' }, true)).toBe('reconnecting');
    expect(realtimeStatusOf('connecting', { kind: 'subscribed' }, true)).toBe('reconnecting');
  });

  it('keeps trying after a drop', () => {
    expect(realtimeStatusOf('unavailable', { kind: 'subscribed' }, true)).toBe('reconnecting');
    expect(realtimeStatusOf('disconnected', { kind: 'subscribed' }, true)).toBe('reconnecting');
  });

  it('is unavailable when it never reached the server, is not supported, or is refused', () => {
    expect(realtimeStatusOf('unavailable', { kind: 'pending' }, false)).toBe('unavailable');
    expect(realtimeStatusOf('failed', { kind: 'pending' }, false)).toBe('unavailable');
    expect(realtimeStatusOf('connected', { kind: 'refused', status: 403 }, true)).toBe(
      'unavailable',
    );
  });

  it('is signed out when the subscription is refused with 401 (A12.9)', () => {
    expect(realtimeStatusOf('connected', { kind: 'refused', status: 401 }, true)).toBe('signedOut');
  });

  it('reads the status pusher-js reports with a subscription error', () => {
    expect(subscriptionErrorStatus({ type: 'AuthError', error: 'x', status: 401 })).toBe(401);
    expect(subscriptionErrorStatus({ status: '401' })).toBeNull();
    expect(subscriptionErrorStatus(null)).toBeNull();
  });

  it('recognises socket states', () => {
    expect(isSocketState('connected')).toBe(true);
    expect(isSocketState('nope')).toBe(false);
  });
});
