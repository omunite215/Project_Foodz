import { describe, expect, it } from 'vitest';
import {
  backoffMs,
  type Fix,
  fixQuality,
  HEARTBEAT_MS,
  locationsBody,
  nextBatch,
  pruneQueue,
  QUEUE_MAX,
  QUEUE_MAX_AGE_MS,
  retryAfterSeconds,
  shouldQueue,
  toPoint,
} from './location-queue';

// Route R from the story: about 234 m a step from the kitchen.
const R0 = { lat: 42.3505, lng: -71.045 };
const R1 = { lat: 42.3521, lng: -71.0469 };

const fix = (at: number, point = R0, accuracy = 15): Fix => ({
  ...point,
  accuracy,
  heading: null,
  speed: null,
  at,
});

describe('which fixes are sent (P10.3, P16.5)', () => {
  it('sends the first good fix and never one worse than 500 m', () => {
    expect(shouldQueue(fix(0), null, 0)).toBe(true);
    expect(shouldQueue(fix(0, R0, 600), null, 0)).toBe(false);
  });

  it('sends after 25 m of movement, at most every 4 s', () => {
    const last = toPoint(fix(0));
    expect(shouldQueue(fix(2_000, R1), last, 2_000)).toBe(false);
    expect(shouldQueue(fix(5_000, R1), last, 5_000)).toBe(true);
    expect(shouldQueue(fix(5_000, R0), last, 5_000)).toBe(false);
  });

  it('sends a heartbeat every 30 s while standing still', () => {
    const last = toPoint(fix(0));
    expect(shouldQueue(fix(HEARTBEAT_MS, R0), last, HEARTBEAT_MS)).toBe(true);
  });
});

describe('the queue while the connection is down (P11.3)', () => {
  it('drops points older than 10 minutes, then the oldest beyond 150', () => {
    const now = QUEUE_MAX_AGE_MS + 1_000;
    const old = toPoint(fix(0));
    const fresh = Array.from({ length: QUEUE_MAX + 5 }, (_, index) => toPoint(fix(2_000 + index)));
    const kept = pruneQueue([old, ...fresh], now);
    expect(kept).toHaveLength(QUEUE_MAX);
    expect(kept[0]?.at).toBe(2_005);
  });

  it('sends oldest first, 50 a request', () => {
    const queue = Array.from({ length: 120 }, (_, index) => toPoint(fix(index)));
    expect(nextBatch(queue)).toHaveLength(50);
    expect(nextBatch(queue)[0]?.at).toBe(0);
  });

  it('backs off 2, 4, 8… up to 30 seconds (P11.5)', () => {
    expect([0, 1, 2, 3, 4, 8].map(backoffMs)).toEqual([
      2_000, 4_000, 8_000, 16_000, 30_000, 30_000,
    ]);
  });
});

describe('the points sent', () => {
  it('carries only the schema fields, with finite ranges', () => {
    const point = toPoint({ ...fix(0), heading: Number.NaN, speed: 250, accuracy: 20_000 });
    expect(point).toMatchObject({ heading: null, speed: 100, accuracy: 10_000 });
    expect(locationsBody([point]).points[0]).toEqual({
      lat: R0.lat,
      lng: R0.lng,
      accuracy: 10_000,
      heading: null,
      speed: 100,
      recordedAt: new Date(0).toISOString(),
    });
  });

  it('grades a fix: good to 100 m, weak to 500 m (P9.7)', () => {
    expect(fixQuality(15)).toBe('good');
    expect(fixQuality(300)).toBe('weak');
    expect(fixQuality(800)).toBe('tooCoarse');
  });

  it('reads the wait from Retry-After, then the body', () => {
    expect(retryAfterSeconds('240', null)).toBe(240);
    expect(retryAfterSeconds(null, { retryAfterSeconds: 90 })).toBe(90);
    expect(retryAfterSeconds(null, {})).toBe(60);
  });
});
