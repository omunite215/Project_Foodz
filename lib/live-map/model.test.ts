import { describe, expect, it } from 'vitest';
import type { OpsMapCourier } from '@/server/modules/tracking/schema';
import { applyPosition, firstViewPoints, type OpsMapData } from './model';

const luis: OpsMapCourier = {
  partnerId: 'p1',
  fullName: 'Luis Moreno',
  shortName: 'Luis M.',
  vehicle: 'SCOOTER',
  vehicleWords: 'Scooter · 7KT 342',
  plate: '7KT 342',
  state: 'toKitchen',
  words: 'To kitchen · 1042',
  orderId: 'o1',
  orderNumber: '1042',
  point: { lat: 42.35, lng: -71.05 },
  heading: null,
  at: '2026-11-21T00:40:00.000Z',
  freshness: 'live',
  phone: null,
};

const data: OpsMapData = {
  asOf: '2026-11-21T00:40:05.000Z',
  pool: 'REAL',
  couriers: [luis],
  deliveries: [],
  readyWithoutCourier: [],
  demoRun: null,
  receivedAt: 0,
};

describe('a courier moves on the live map (A46.3)', () => {
  it('moves him, takes the new state and words', () => {
    const next = applyPosition(data, {
      partnerId: 'p1',
      lat: 42.36,
      lng: -71.05,
      heading: 90,
      state: 'delivering',
      at: '2026-11-21T00:40:10.000Z',
    });
    expect(next?.couriers[0]).toMatchObject({
      point: { lat: 42.36, lng: -71.05 },
      heading: 90,
      state: 'delivering',
      words: 'Delivering 1042',
      freshness: 'live',
    });
  });

  it('ignores an older point and a courier it does not know', () => {
    const older = applyPosition(data, {
      partnerId: 'p1',
      lat: 1,
      lng: 1,
      heading: null,
      state: 'free',
      at: '2026-11-21T00:39:00.000Z',
    });
    expect(older?.couriers[0]?.point).toEqual({ lat: 42.35, lng: -71.05 });
    expect(
      applyPosition(data, {
        partnerId: 'p2',
        lat: 1,
        lng: 1,
        heading: null,
        state: 'free',
        at: '2026-11-21T00:41:00.000Z',
      }),
    ).toBeNull();
  });
});

describe("the camera's first view (design 3.3)", () => {
  it('fits the kitchen, every courier with a point and every drop-off', () => {
    const kitchen = { lat: 42.3505, lng: -71.045 };
    const points = firstViewPoints(
      kitchen,
      [luis, { ...luis, partnerId: 'p2', point: null }],
      [{ dropoffPoint: { lat: 42.36, lng: -71.0547 } }],
    );
    expect(points).toEqual([kitchen, { lat: 42.35, lng: -71.05 }, { lat: 42.36, lng: -71.0547 }]);
  });

  it('still fits the kitchen when nobody is out', () => {
    expect(firstViewPoints({ lat: 42.3505, lng: -71.045 }, [], [])).toHaveLength(1);
    expect(firstViewPoints(null, [], [])).toEqual([]);
  });
});
