import { describe, expect, it } from 'vitest';
import { distanceMeters, movePoint, offsetText, roughMeters } from './map-geometry';

const kitchen = { lat: 42.3505, lng: -71.045 };

describe('movePoint', () => {
  it('moves the given distance in each direction', () => {
    for (const direction of ['up', 'down', 'left', 'right'] as const) {
      const moved = movePoint(kitchen, direction, 10);
      expect(distanceMeters(kitchen, moved)).toBeCloseTo(10, 0);
    }
    expect(movePoint(kitchen, 'up', 10).lat).toBeGreaterThan(kitchen.lat);
    expect(movePoint(kitchen, 'right', 10).lng).toBeGreaterThan(kitchen.lng);
    expect(movePoint(kitchen, 'left', 10).lat).toBe(kitchen.lat);
  });
});

describe('distanceMeters', () => {
  it('matches the seeded edge pins', () => {
    // About 7.9 km and 8.1 km due north of the kitchen (story seed data).
    expect(distanceMeters(kitchen, { lat: 42.4216, lng: -71.045 }) / 1000).toBeCloseTo(7.9, 1);
    expect(distanceMeters(kitchen, { lat: 42.4234, lng: -71.045 }) / 1000).toBeCloseTo(8.1, 1);
  });
});

describe('offsetText', () => {
  it('names the main direction and rounds to 10 m', () => {
    expect(offsetText(kitchen, movePoint(kitchen, 'up', 30))).toBe('30 m up');
    expect(offsetText(kitchen, movePoint(kitchen, 'left', 52))).toBe('50 m left');
    expect(offsetText(kitchen, kitchen)).toBeNull();
  });

  it('rounds the far-away hint', () => {
    expect(roughMeters(396)).toBe('about 400 m');
  });
});
