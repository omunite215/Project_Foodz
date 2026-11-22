import { describe, expect, it, vi } from 'vitest';
import { GeoUnavailableError, parsePhotonResponse, photonSearchUrl, searchPlaces } from './geo';

const store = { lat: 42.3505, lng: -71.045 };

const feature = (properties: Record<string, unknown>, coordinates = [-71.0983681, 42.3434343]) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates },
  properties: { countrycode: 'US', city: 'Boston', state: 'Massachusetts', ...properties },
});

const house = feature({
  osm_type: 'N',
  osm_id: 1,
  housenumber: '12',
  street: 'Peterborough Street',
  postcode: '02215',
});
const street = feature({
  osm_type: 'W',
  osm_id: 8651552,
  name: 'Peterborough Street',
  postcode: '02215',
});

/** One segment of a street-only result. */
const segment = (osm_id: number, lng: number, extra: Record<string, unknown> = {}) =>
  feature({ osm_type: 'W', osm_id, name: 'Peterborough Street', ...extra }, [lng, 42.3434]);

/** "12 Main Street" in a given town and place. */
const main = (osm_id: number, city: string, lng: number) =>
  feature({ osm_type: 'N', osm_id, housenumber: '12', street: 'Main Street', city }, [lng, 42.37]);

describe('parsePhotonResponse', () => {
  it('builds street, city and ZIP lines', () => {
    expect(parsePhotonResponse({ features: [house, street] })).toEqual([
      {
        id: 'N1',
        line1: '12 Peterborough Street',
        city: 'Boston, MA 02215',
        placeName: null,
        hasHouseNumber: true,
        lat: 42.3434343,
        lng: -71.0983681,
      },
      {
        id: 'W8651552',
        line1: 'Peterborough Street',
        city: 'Boston, MA 02215',
        placeName: null,
        hasHouseNumber: false,
        lat: 42.3434343,
        lng: -71.0983681,
      },
    ]);
  });

  it('keeps a named place with its street', () => {
    const [place] = parsePhotonResponse({
      features: [
        feature({
          osm_type: 'W',
          osm_id: 2,
          name: 'Faneuil Hall',
          street: 'Faneuil Hall Square',
          housenumber: '1',
        }),
      ],
    });
    expect(place).toMatchObject({ line1: '1 Faneuil Hall Square', placeName: 'Faneuil Hall' });
  });

  it('keeps US results only, skips malformed ones and stops at five', () => {
    const london = feature({
      osm_type: 'N',
      osm_id: 3,
      countrycode: 'GB',
      street: 'Downing Street',
      housenumber: '10',
      city: 'London',
    });
    const broken = { properties: { countrycode: 'US' }, geometry: { coordinates: ['x', 1] } };
    const outOfRange = feature({ osm_type: 'N', osm_id: 4, street: 'A' }, [-500, 42]);
    const many = Array.from({ length: 9 }, (_, i) =>
      feature({
        osm_type: 'N',
        osm_id: 100 + i,
        street: 'Main Street',
        housenumber: String(i + 1),
      }),
    );
    const results = parsePhotonResponse({ features: [london, broken, outOfRange, ...many] });
    expect(results).toHaveLength(5);
    expect(results.every((r) => r.line1.endsWith('Main Street'))).toBe(true);
  });

  it('shows one suggestion for map objects that are the same address', () => {
    // A building, its entrances and an address point: same label, a few metres apart.
    const faneuil = [0, 1, 2, 3, 4].map((i) =>
      feature(
        {
          osm_type: i ? 'N' : 'W',
          osm_id: 500 + i,
          housenumber: '1',
          street: 'Faneuil Hall Square',
          postcode: '02109',
        },
        [-71.0548 + i * 0.0001, 42.36],
      ),
    );
    expect(parsePhotonResponse({ features: faneuil }, { near: store })).toHaveLength(1);
  });

  it('merges street segments of one street, keeping the fuller city line', () => {
    const results = parsePhotonResponse(
      { features: [segment(1, -71.0983), segment(2, -71.095, { postcode: '02215' })] },
      { near: store },
    );
    expect(results).toEqual([
      expect.objectContaining({ id: 'W2', line1: 'Peterborough Street', city: 'Boston, MA 02215' }),
    ]);
  });

  it('keeps the same street and number in towns or places far apart', () => {
    expect(
      parsePhotonResponse({
        features: [
          main(1, 'Boston', -71.06),
          main(2, 'Cambridge', -71.1),
          main(3, 'Boston', -71.0),
        ],
      }),
    ).toHaveLength(3);
  });

  it('drops results far from the store and keeps nearby towns outside the delivery area', () => {
    const aurora = feature(
      {
        osm_type: 'W',
        osm_id: 9,
        housenumber: '13732',
        street: 'East Quincy Avenue',
        city: 'Aurora',
        state: 'Colorado',
      },
      [-104.8, 39.64],
    );
    const quincy = feature(
      {
        osm_type: 'N',
        osm_id: 10,
        housenumber: '1',
        street: 'Quincy Center Plaza',
        city: 'Quincy',
        postcode: '02169',
      },
      [-71.0036, 42.2513],
    );
    expect(
      parsePhotonResponse({ features: [aurora, quincy] }, { near: store }).map((r) => r.city),
    ).toEqual(['Quincy, MA 02169']);
  });

  it('returns nothing for a body that is not a feature list', () => {
    expect(parsePhotonResponse(null)).toEqual([]);
    expect(parsePhotonResponse({ features: 'x' })).toEqual([]);
    expect(parsePhotonResponse('<html>')).toEqual([]);
  });
});

describe('photonSearchUrl', () => {
  it('always targets the fixed host with the query encoded', () => {
    const url = photonSearchUrl('12 Peterborough St & https://evil.example/', store);
    expect(url.origin).toBe('https://photon.komoot.io');
    expect(url.pathname).toBe('/api/');
    expect(url.searchParams.get('q')).toBe('12 Peterborough St & https://evil.example/');
    expect(url.searchParams.getAll('layer')).toEqual(['house', 'street']);
    expect(url.searchParams.get('lat')).toBe('42.35050');
  });

  it('limits the search to a box around the store', () => {
    const [west, south, east, north] = (
      photonSearchUrl('main st', store).searchParams.get('bbox') ?? ''
    )
      .split(',')
      .map(Number);
    expect(south).toBeCloseTo(store.lat - 40 / 111.32, 3);
    expect(north).toBeCloseTo(store.lat + 40 / 111.32, 3);
    expect(west).toBeLessThan(-71.5);
    expect(east).toBeGreaterThan(-70.6);
    // Aurora, Colorado is far outside.
    expect(-104.8).toBeLessThan(west!);
  });

  it('refuses coordinates that are not real numbers', () => {
    expect(() => photonSearchUrl('x', { lat: Number.NaN, lng: 0 })).toThrow(/expected number/i);
    expect(() => photonSearchUrl('x', { lat: 91, lng: 0 })).toThrow(/too big/i);
  });
});

describe('searchPlaces', () => {
  it('returns parsed suggestions near the store', async () => {
    const far = feature(
      { osm_type: 'N', osm_id: 77, housenumber: '12', street: 'Peterborough Street' },
      [-104.8, 39.64],
    );
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ features: [far, house] }));
    const results = await searchPlaces('12 Peterborough', store, fetchImpl);
    expect(results.map((r) => r.id)).toEqual(['N1']);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url instanceof URL ? url.href : '').toMatch(/^https:\/\/photon\.komoot\.io\/api\/\?/);
    expect(init?.redirect).toBe('error');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('reports the service as unavailable on errors, bad status or timeouts', async () => {
    const failing = [
      vi.fn<typeof fetch>().mockRejectedValue(new TypeError('network')),
      vi.fn<typeof fetch>().mockResolvedValue(new Response('busy', { status: 503 })),
      vi.fn<typeof fetch>().mockResolvedValue(new Response('not json')),
      vi.fn<typeof fetch>().mockRejectedValue(new DOMException('timed out', 'TimeoutError')),
    ];
    for (const fetchImpl of failing) {
      await expect(searchPlaces('x y z', store, fetchImpl)).rejects.toBeInstanceOf(
        GeoUnavailableError,
      );
    }
  });
});
