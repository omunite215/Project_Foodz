import { describe, expect, it } from 'vitest';
import { parseNeighborhood, ridePoints, routingProvider } from './routing';

describe('routing (F8 contract §1, lead decision 1)', () => {
  it('uses the straight line unless a self-hosted OSRM is named', () => {
    expect(routingProvider({})).toEqual({ kind: 'straight' });
    expect(routingProvider({ OSRM_URL: 'https://osrm.internal' })).toEqual({ kind: 'straight' });
    expect(routingProvider({ ROUTING_PROVIDER: 'osrm' })).toEqual({ kind: 'straight' });
    expect(
      routingProvider({ ROUTING_PROVIDER: 'osrm', OSRM_URL: 'https://osrm.internal/' }),
    ).toEqual({
      kind: 'osrm',
      base: 'https://osrm.internal',
    });
    expect(routingProvider({ ROUTING_PROVIDER: 'osrm', OSRM_URL: 'file:///etc/passwd' })).toEqual({
      kind: 'straight',
    });
  });

  it('reads the neighborhood from a reverse geocode, and nothing odd', () => {
    expect(
      parseNeighborhood({ features: [{ properties: { district: 'Downtown', city: 'Boston' } }] }),
    ).toBe('Downtown');
    expect(parseNeighborhood({ features: [{ properties: { suburb: 'Fenway' } }] })).toBe('Fenway');
    expect(parseNeighborhood({ features: [{ properties: { city: 'Boston' } }] })).toBeNull();
    expect(parseNeighborhood({ features: [{ properties: { district: '<script>' } }] })).toBeNull();
    expect(parseNeighborhood('nope')).toBeNull();
  });

  it('spaces the demo ride one point per step and ends at the door', () => {
    const route: [number, number][] = [
      [-71.045, 42.3505],
      [-71.0562, 42.36],
    ];
    const points = ridePoints(route, 30, 4);
    expect(points.length).toBeGreaterThan(30);
    expect(points.at(-1)).toEqual({ lat: 42.36, lng: -71.0562 });
  });
});
