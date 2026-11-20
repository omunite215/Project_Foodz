import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { PrismaClient } from '@/server/db/generated/client';
import { redis } from '@/server/redis';
import { seedCatalog } from '../../prisma/seeding';

/*
 * Checking an address from the cart without saving it (F3 U2): open to signed-out visitors,
 * limited per network, nothing stored. Photon is stubbed; the delivery check is real PostGIS.
 */

const caller = vi.hoisted(() => ({ ip: '' }));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-forwarded-for': caller.ip }),
  cookies: async () => ({ get: () => undefined, getAll: () => [], has: () => false }),
}));

const { guestAddressSearchAction, guestDeliveryCheckAction } =
  await import('@/server/modules/addresses/actions');

const newCaller = () => {
  caller.ip = `guest-${crypto.randomUUID()}`;
};

const PINS = {
  peterborough: { lat: 42.3467, lng: -71.0972 },
  edgeInside: { lat: 42.4216, lng: -71.045 },
  edgeOutside: { lat: 42.4234, lng: -71.045 },
  // About 8.04 km north of the kitchen: outside, though it rounds to 8.0 km.
  justOver: { lat: 42.42285, lng: -71.045 },
  quincy: { lat: 42.2513, lng: -71.0036 },
};

let migrator: PrismaClient;

beforeAll(async () => {
  migrator = new PrismaClient({
    adapter: new PrismaPg({ connectionString: inject('migratorUrl') }),
  });
  await migrator.$transaction((tx) => seedCatalog(tx, { now: new Date() }), { timeout: 60_000 });
}, 120_000);

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await migrator.$disconnect();
  await redis.quit();
});

describe('the guest delivery check', () => {
  it('gives the distance and the fee a cart would charge, and saves nothing', async () => {
    newCaller();
    const before = await migrator.address.count();
    const home = (
      await guestDeliveryCheckAction({ ...PINS.peterborough, line1: '12 Peterborough Street' })
    )?.data;
    expect(home).toMatchObject({
      deliverable: true,
      distanceKm: 4.3,
      radiusKm: 8,
      feeCents: 414,
      feeRange: { minCents: 199, maxCents: 599 },
      edge: null,
      storeStreet: '88 Harbor Street',
      message: 'We deliver here · about 4.3 km from our kitchen',
    });
    expect((await guestDeliveryCheckAction(PINS.edgeInside))?.data).toMatchObject({
      deliverable: true,
      distanceKm: 7.9,
      feeCents: 594,
    });
    expect(await migrator.address.count()).toBe(before);
  });

  it('says plainly when an address is outside, and "just over" at the edge (S2.8, B3)', async () => {
    newCaller();
    const quincy = (await guestDeliveryCheckAction({ ...PINS.quincy, line1: 'Quincy Center' }))
      ?.data;
    expect(quincy).toMatchObject({ deliverable: false, feeCents: null, edge: null });
    expect(quincy?.message).toMatch(
      /^Sorry, we don't deliver to Quincy Center yet\. It's about 11\.\d km from our kitchen at 88 Harbor Street, and we deliver within 8 km\.$/,
    );
    expect((await guestDeliveryCheckAction(PINS.edgeOutside))?.data).toMatchObject({
      deliverable: false,
      distanceKm: 8.1,
      edge: null,
    });
    const edge = (await guestDeliveryCheckAction({ ...PINS.justOver, line1: 'The edge' }))?.data;
    expect(edge).toMatchObject({
      deliverable: false,
      distanceKm: 8,
      edge: 'justOver',
      feeCents: null,
    });
    expect(edge?.message).toBe(
      "Sorry, we don't deliver to The edge yet. It's just over 8 km from our kitchen at 88 Harbor Street, and we deliver within 8 km.",
    );
  });

  it('refuses malformed input without detail', async () => {
    newCaller();
    for (const input of [
      { lat: 91, lng: 0 },
      { lat: '42.3', lng: -71 },
      { lat: 42.3, lng: -71, line1: 'a\u0000b' },
      { lat: 42.3, lng: -71, userId: 'x' },
    ]) {
      const result = await guestDeliveryCheckAction(input as never);
      expect(result?.data).toBeUndefined();
      expect(result?.validationErrors).toBeDefined();
    }
  });

  it('is limited to 30 checks a minute per network', async () => {
    newCaller();
    for (let i = 0; i < 30; i++) {
      expect((await guestDeliveryCheckAction(PINS.peterborough))?.serverError).toBeUndefined();
    }
    const refused = (await guestDeliveryCheckAction(PINS.peterborough))?.serverError;
    expect(refused).toMatchObject({ code: 'RATE_LIMITED' });
    expect(refused?.message).toMatch(/^Too many address checks from this network\. Try again in /);
    newCaller();
    expect((await guestDeliveryCheckAction(PINS.peterborough))?.data?.deliverable).toBe(true);
  });
});

describe('the guest address search', () => {
  it('asks Photon on its fixed host for a signed-out visitor', async () => {
    newCaller();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({
        features: [
          {
            geometry: { coordinates: [-71.0983681, 42.3434343] },
            properties: {
              osm_type: 'N',
              osm_id: 1,
              countrycode: 'US',
              housenumber: '12',
              street: 'Peterborough Street',
              city: 'Boston',
              state: 'Massachusetts',
              postcode: '02215',
            },
          },
        ],
      }),
    );
    const results = (await guestAddressSearchAction({ query: '12 Peterborough' }))?.data;
    expect(results).toEqual([
      expect.objectContaining({ line1: '12 Peterborough Street', city: 'Boston, MA 02215' }),
    ]);
    const [url] = fetchSpy.mock.calls[0]!;
    expect(url instanceof URL ? url.origin : '').toBe('https://photon.komoot.io');
  });

  it('says when the search is down, refuses short queries, and is limited per network', async () => {
    newCaller();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('network'));
    expect(
      (await guestAddressSearchAction({ query: '12 Peterborough' }))?.serverError,
    ).toMatchObject({
      code: 'UNAVAILABLE',
    });
    expect((await guestAddressSearchAction({ query: 'ab' }))?.validationErrors).toBeDefined();

    newCaller();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ features: [] }));
    for (let i = 0; i < 30; i++) {
      expect((await guestAddressSearchAction({ query: 'Harbor Street' }))?.data).toEqual([]);
    }
    expect((await guestAddressSearchAction({ query: 'Harbor Street' }))?.serverError?.code).toBe(
      'RATE_LIMITED',
    );
  });
});
