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

  it('refuses coordinates that are not real numbers', () => {
    expect(() => photonSearchUrl('x', { lat: Number.NaN, lng: 0 })).toThrow(/expected number/i);
    expect(() => photonSearchUrl('x', { lat: 91, lng: 0 })).toThrow(/too big/i);
  });
});

describe('searchPlaces', () => {
  it('returns parsed suggestions', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ features: [house] }));
    const results = await searchPlaces('12 Peterborough', store, fetchImpl);
    expect(results.map((r) => r.line1)).toEqual(['12 Peterborough Street']);
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
