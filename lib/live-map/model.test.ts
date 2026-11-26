import { describe, expect, it } from 'vitest';
import type { OpsMapCourier } from '@/server/modules/tracking/schema';
import { applyPosition, firstViewPoints, hiddenLabels, type OpsMapData, stackOrder } from './model';

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

describe('stacking at the door (review S5, design 3.3)', () => {
  it('draws couriers above drop-off pins, the selected one on top', () => {
    expect(stackOrder({ kind: 'courier', id: 'grace' }, ['luis', 'grace'], ['1042'])).toEqual([
      { kind: 'courier', id: 'grace' },
      { kind: 'courier', id: 'luis' },
      { kind: 'delivery', id: '1042' },
    ]);
    expect(stackOrder({ kind: 'delivery', id: '1043' }, ['luis'], ['1042', '1043'])).toEqual([
      { kind: 'courier', id: 'luis' },
      { kind: 'delivery', id: '1043' },
      { kind: 'delivery', id: '1042' },
    ]);
  });

  it("hides a drop-off chip under a courier's label, and keeps the selected one", () => {
    const label = { id: 'courier:luis', left: 40, top: 10, right: 200, bottom: 34, keep: false };
    const chip = { id: 'delivery:1042', left: 30, top: 20, right: 80, bottom: 44, keep: false };
    const far = { id: 'delivery:1043', left: 400, top: 20, right: 450, bottom: 44, keep: false };
    expect(hiddenLabels([label, chip, far])).toEqual(new Set(['delivery:1042']));
    expect(hiddenLabels([label, { ...chip, keep: true }])).toEqual(new Set());
  });
});
