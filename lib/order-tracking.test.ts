import { describe, expect, it } from 'vitest';
import {
  atKitchenLine,
  cantSeeText,
  codeShown,
  codeSpoken,
  distanceSentence,
  grewALot,
  minutesUntil,
  pausedWords,
  trackingArrival,
} from './order-tracking';

const TZ = 'America/New_York';
// Fri, Nov 20, 2026, 7:42 pm in Boston.
const now = Date.parse('2026-11-21T00:42:00.000Z');
const eta = (minutes: number) => new Date(now + minutes * 60_000).toISOString();
const route = (minutes: number) => ({
  geojson: null,
  distanceM: 1400,
  durationSec: minutes * 60,
  etaAt: eta(minutes),
  estimated: false,
});

describe('customer arrival row (F8 S2)', () => {
  it('rounds minutes up and never says 0 min', () => {
    expect(minutesUntil(eta(3.2), now)).toBe(4);
    expect(minutesUntil(eta(0.1), now)).toBe(1);
    expect(minutesUntil(eta(0), now)).toBeNull();
    expect(minutesUntil(eta(-2), now)).toBeNull();
  });

  it('reads the estimate with its clock time', () => {
    const row = trackingArrival({
      tracking: { route: route(4), almost: false },
      courierFirst: 'Luis',
      freshness: 'live',
      serverNowMs: now,
      timeZone: TZ,
    });
    expect(row?.kind).toBe('eta');
    expect(row?.headline).toBe('Arriving in about 4 min · 7:46 pm');
    expect(row?.spoken).toBe('Arriving in about 4 minutes, at 7:46 pm');
  });

  it('says almost there, arriving soon, and when it can not see him', () => {
    const base = { courierFirst: 'Luis', serverNowMs: now, timeZone: TZ };
    expect(
      trackingArrival({ ...base, tracking: { route: route(1), almost: true }, freshness: 'live' })
        ?.headline,
    ).toBe('Luis is almost there.');
    const overdue = trackingArrival({
      ...base,
      tracking: { route: route(-3), almost: false },
      freshness: 'recent',
    });
    expect(overdue?.headline).toBe('Arriving soon');
    expect(overdue?.note).toContain('later than we said');
    expect(
      trackingArrival({ ...base, tracking: { route: route(4), almost: true }, freshness: 'stale' })
        ?.headline,
    ).toBe(cantSeeText('Luis'));
    expect(cantSeeText('Luis')).toBe(
      "We can't see Luis's location right now. Your order is still on its way.",
    );
  });

  it('notices an estimate that grew by 5 minutes or more', () => {
    expect(grewALot(null, eta(10))).toBe(false);
    expect(grewALot(eta(4), eta(9))).toBe(true);
    expect(grewALot(eta(4), eta(8))).toBe(false);
    expect(grewALot(eta(9), eta(4))).toBe(false);
  });
});

describe('map and code words', () => {
  it('words the distance for the text twin', () => {
    expect(distanceSentence('Luis', 900)).toBe('Luis is about 900 m away.');
    expect(distanceSentence('Luis', 1420)).toBe('Luis is about 1.4 km away.');
    expect(distanceSentence('Luis', 40)).toBe('Luis is very close.');
    expect(distanceSentence('Luis', null)).toBe('Luis is on the way.');
  });

  it('shows and speaks the code digit by digit', () => {
    expect(codeShown('4821')).toBe('4 8 2 1');
    expect(codeSpoken('4821')).toBe('4, 8, 2, 1.');
  });

  it('keeps capitals and words the paused line', () => {
    expect(atKitchenLine('Luis')).toBe('Luis is at the kitchen picking up your order.');
    expect(pausedWords(eta(9), TZ)).toBe('Location paused · last seen 7:51 pm');
  });
});
