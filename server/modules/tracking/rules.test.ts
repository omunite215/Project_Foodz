import { describe, expect, it } from 'vitest';
import {
  almostThere,
  attentionOf,
  codeAllowed,
  type DeliveryFacts,
  deliveryLineState,
  demoRunVerdict,
  distanceM,
  drawCode,
  etaShiftWorthPushing,
  freshnessOf,
  historyDue,
  mapStateOf,
  needsFarConfirm,
  noAnswerClock,
  offRoute,
  roundCoordinate,
  stageOf,
  straightLineEstimate,
  supportMayConfirm,
  trackingTimings,
  triesLeft,
  vehicleSeconds,
} from './rules';
import { TRACKING_DEFAULTS } from './schema';

const now = new Date('2026-11-21T00:46:00.000Z'); // Fri, Nov 20, 7:46 pm in Boston
const ago = (seconds: number) => new Date(now.getTime() - seconds * 1000).toISOString();
// Route R (F6): the kitchen R0 to Priya's door R6.
const R0 = { lat: 42.3505, lng: -71.045 };
const R3 = { lat: 42.3553, lng: -71.0506 };
const R6 = { lat: 42.36, lng: -71.0562 };

describe('test timings (L13.1)', () => {
  it('uses the story values unless the test-only flag is on', () => {
    expect(trackingTimings({ TRACKING_ETA_SECONDS: '5' })).toEqual(TRACKING_DEFAULTS);
    expect(
      trackingTimings({ FOODZ_TEST_TIMING: '1', TRACKING_ETA_SECONDS: '5', DEMO_RUN_SPEED: '300' }),
    ).toMatchObject({
      etaSeconds: 5,
      demoSpeedKmh: 300,
    });
    expect(
      trackingTimings({
        FOODZ_TEST_TIMING: '1',
        FOODZ_DEPLOYMENT: 'production',
        TRACKING_ETA_SECONDS: '5',
      }),
    ).toEqual(TRACKING_DEFAULTS);
  });
});

describe('freshness and cadence (L5, U9, L8)', () => {
  it.each([
    [10, 'live'],
    [35, 'recent'],
    [50, 'hollow'],
    [180, 'stale'],
    [700, 'red'],
  ] as const)('reads a point %i s old as %s', (seconds, freshness) => {
    expect(freshnessOf(ago(seconds), now)).toBe(freshness);
  });

  it('rounds coordinates to 5 decimals and keeps one history row per 15 s', () => {
    expect(roundCoordinate(42.3553219)).toBe(42.35532);
    expect(historyDue(ago(14), now)).toBe(false);
    expect(historyDue(ago(15), now)).toBe(true);
    expect(historyDue(null, now)).toBe(true);
  });
});

describe('the estimate (L4, U24)', () => {
  it('falls back to the straight line at 20 km/h, 15 for a bicycle, flagged as estimated', () => {
    const scooter = straightLineEstimate(R0, R6, 'SCOOTER', now);
    expect(scooter.distanceM).toBeGreaterThan(1300);
    expect(scooter.distanceM).toBeLessThan(1500);
    expect(scooter.estimated).toBe(true);
    const bike = straightLineEstimate(R0, R6, 'BICYCLE', now);
    expect(bike.durationSec).toBeGreaterThan(scooter.durationSec);
    expect(vehicleSeconds(300, 'BICYCLE')).toBe(390);
    expect(vehicleSeconds(300, 'CAR')).toBe(300);
  });

  it('re-plans 150 m off the route, and pushes a shift of 5 minutes or more', () => {
    const route: [number, number][] = [
      [R0.lng, R0.lat],
      [R3.lng, R3.lat],
      [R6.lng, R6.lat],
    ];
    expect(offRoute(R3, route)).toBe(false);
    expect(offRoute({ lat: R3.lat + 0.003, lng: R3.lng }, route)).toBe(true);
    expect(offRoute(R3, null)).toBe(false);
    expect(etaShiftWorthPushing(ago(0), new Date(now.getTime() + 299_000).toISOString())).toBe(
      false,
    );
    expect(etaShiftWorthPushing(ago(0), new Date(now.getTime() + 300_000).toISOString())).toBe(
      true,
    );
  });
});

describe('stages and geofences (U7, U8, U21)', () => {
  it('maps delivery statuses to stages, and asks before 300 m', () => {
    expect([
      stageOf('ASSIGNED'),
      stageOf('AT_RESTAURANT'),
      stageOf('PICKED_UP'),
      stageOf('DELIVERED'),
    ]).toEqual(['toKitchen', 'atKitchen', 'delivering', null]);
    expect(needsFarConfirm(1200)).toBe(true);
    expect(needsFarConfirm(250)).toBe(false);
    expect(needsFarConfirm(null)).toBe(false);
  });

  it('says almost there within 200 m or 2 minutes (R5)', () => {
    // R5 is about 240 m out ("0.2 km"): almost there by the 2-minute rule, not the distance.
    const r5 = Math.round(distanceM({ lat: 42.3584, lng: -71.0543 }, R6));
    expect(almostThere(r5, null)).toBe(false);
    expect(almostThere(r5, 50)).toBe(true);
    expect(almostThere(150, null)).toBe(true);
    expect(almostThere(900, 110)).toBe(true);
    expect(almostThere(900, 240)).toBe(false);
  });
});

describe('the delivery code (L6, P42)', () => {
  it('never draws 0000, a repeated digit or a run', () => {
    expect(['0000', '7777', '1234', '9876', '12a4', '123'].map(codeAllowed)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(codeAllowed('4071')).toBe(true);
    const draws = [0, 1111, 4071];
    expect(drawCode(() => draws.shift() ?? 5)).toBe('4071');
  });

  it('counts down five tries', () => {
    expect([0, 1, 4, 5, 7].map(triesLeft)).toEqual([5, 4, 1, 0, 0]);
  });
});

describe('nobody at the door (P43, A50.3)', () => {
  it('runs a 5-minute clock, then lets SUPPORT confirm', () => {
    expect(noAnswerClock(ago(48), now)).toEqual({
      waiting: true,
      secondsLeft: 252,
      reportable: false,
    });
    expect(noAnswerClock(ago(300), now).reportable).toBe(true);
    expect(supportMayConfirm({ locked: false, noAnswerSince: ago(120), now })).toBe(false);
    expect(supportMayConfirm({ locked: false, noAnswerSince: ago(301), now })).toBe(true);
    expect(supportMayConfirm({ locked: true, noAnswerSince: null, now })).toBe(true);
  });
});

describe('the board and the map (A46, A48, A49)', () => {
  const base: DeliveryFacts = {
    orderId: 'o1042',
    orderNumber: '1042',
    status: 'PICKED_UP',
    lastPointAt: ago(5),
    distanceToDoorM: 900,
    durationSec: 240,
    noAnswerSince: null,
    lockedAt: null,
    problem: null,
  };

  it.each([
    [{}, 'onTheWay', 'neutral'],
    [{ distanceToDoorM: 150 }, 'almost', 'positive'],
    [{ lastPointAt: ago(180) }, 'noLocation', 'amber'],
    [{ lastPointAt: ago(720) }, 'noLocation', 'red'],
    [{ noAnswerSince: ago(120) }, 'noAnswer', 'amber'],
    [{ noAnswerSince: ago(320) }, 'noAnswer', 'red'],
    [{ lockedAt: ago(30) }, 'locked', 'red'],
    [{ problem: { kind: 'address' as const, at: ago(30) } }, 'problem', 'amber'],
  ])('reads %j as %s (%s)', (change, state, tone) => {
    expect(deliveryLineState({ ...base, ...change }, now)).toEqual({ state, tone });
  });

  it('lists stuck deliveries oldest first', () => {
    const items = attentionOf(
      [
        { ...base, orderId: 'a', orderNumber: '1043', lockedAt: ago(60) },
        { ...base, orderId: 'b', orderNumber: '1044', noAnswerSince: ago(200) },
        { ...base, orderId: 'c', orderNumber: '1045', lastPointAt: ago(700) },
        { ...base, orderId: 'd', orderNumber: '1046' },
      ],
      now,
    );
    expect(items.map((item) => [item.orderNumber, item.kind])).toEqual([
      ['1045', 'no-location'],
      ['1044', 'no-answer'],
      ['1043', 'locked'],
    ]);
  });

  it('puts problems before the stage on the map (D29)', () => {
    const facts = {
      deliveryStatus: 'PICKED_UP',
      hasOpenOffer: false,
      noAnswerSince: null,
      locked: false,
      problem: false,
    };
    expect(mapStateOf(facts)).toBe('delivering');
    expect(mapStateOf({ ...facts, locked: true })).toBe('locked');
    expect(mapStateOf({ ...facts, deliveryStatus: null, hasOpenOffer: true })).toBe('offered');
    expect(mapStateOf({ ...facts, deliveryStatus: null })).toBe('free');
  });
});

describe('the demo run (L10.2)', () => {
  it('runs one at a time and six an hour', () => {
    expect(demoRunVerdict({ running: null, startsInLastHour: [], now })).toEqual({ ok: true });
    expect(
      demoRunVerdict({ running: { endsAt: ago(-240) }, startsInLastHour: [], now }),
    ).toMatchObject({
      ok: false,
      why: 'busy',
    });
    const six = [3000, 2500, 2000, 1500, 1000, 500].map(ago);
    expect(demoRunVerdict({ running: null, startsInLastHour: six, now })).toEqual({
      ok: false,
      why: 'limit',
      nextAt: new Date(now.getTime() - 3000_000 + 3_600_000).toISOString(),
    });
  });
});
