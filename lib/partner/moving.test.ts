import { describe, expect, it } from 'vitest';
import { isMoving, keepRecent, type PartnerFix } from './moving';

const fix = (at: number, lat: number, speed: number | null = null): PartnerFix => ({
  lat,
  lng: -71.05,
  accuracy: 10,
  speed,
  at,
});

describe('moving or stopped (P37.1)', () => {
  it('counts 2 m/s or 20 m in 10 s as moving', () => {
    expect(isMoving([fix(0, 42.35, 3)], 1_000)).toBe(true);
    // About 22 m north in 8 s.
    expect(isMoving([fix(0, 42.35), fix(8_000, 42.3502)], 9_000)).toBe(true);
    expect(isMoving([fix(0, 42.35), fix(8_000, 42.35005)], 9_000)).toBe(false);
  });

  it('is stopped once 10 s pass without movement', () => {
    expect(isMoving([fix(0, 42.35, 4)], 11_000)).toBe(false);
    expect(isMoving([], 5_000)).toBe(false);
  });

  it('keeps only the last 10 seconds', () => {
    const kept = keepRecent([fix(0, 42.35), fix(5_000, 42.35)], fix(12_000, 42.35));
    expect(kept.map((item) => item.at)).toEqual([5_000, 12_000]);
    expect(keepRecent(kept, fix(12_000, 42.35))).toHaveLength(2);
  });
});
