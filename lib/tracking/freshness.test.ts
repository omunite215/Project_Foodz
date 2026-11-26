import { describe, expect, it } from 'vitest';
import {
  ageSeconds,
  ageWords,
  freshnessFor,
  isHollow,
  isStale,
  noLocationWords,
  staffUpdatedWords,
  updatedWords,
} from './freshness';

const at = '2026-11-20T19:40:00.000Z';
const plus = (seconds: number) => Date.parse(at) + seconds * 1000;

describe('freshness (L5)', () => {
  it('counts whole seconds on the server clock', () => {
    expect(ageSeconds(at, plus(41.9))).toBe(41);
    expect(ageSeconds(at, plus(-5))).toBe(0);
    expect(ageSeconds(null, plus(10))).toBeNull();
    expect(ageSeconds('not a date', plus(10))).toBeNull();
  });

  it('follows one rule: live, recent, hollow, stale, red', () => {
    expect(freshnessFor(0)).toBe('live');
    expect(freshnessFor(29)).toBe('live');
    expect(freshnessFor(30)).toBe('recent');
    expect(freshnessFor(45)).toBe('hollow');
    expect(freshnessFor(119)).toBe('hollow');
    expect(freshnessFor(120)).toBe('stale');
    expect(freshnessFor(600)).toBe('red');
    expect(freshnessFor(null)).toBe('red');
    expect(isStale('stale')).toBe(true);
    expect(isStale('hollow')).toBe(false);
    expect(isHollow('hollow')).toBe(true);
    expect(isHollow('recent')).toBe(false);
  });

  it('says "Live", then 10-second steps, then minutes', () => {
    expect(updatedWords(12).text).toBe('Live');
    expect(updatedWords(30).text).toBe('Updated 30 s ago');
    expect(updatedWords(47).text).toBe('Updated 40 s ago');
    expect(updatedWords(59).spoken).toBe('Updated 50 seconds ago');
    expect(updatedWords(61).text).toBe('Updated 1 min ago');
    expect(updatedWords(61).spoken).toBe('Updated 1 minute ago');
    expect(updatedWords(150).text).toBe('Updated 2 min ago');
    expect(ageWords(5).text).toBe('10 s');
  });

  it('gives staff the seconds and the no-location label', () => {
    expect(staffUpdatedWords(3).text).toBe('Updated just now');
    expect(staffUpdatedWords(12).text).toBe('Updated 12 s ago');
    expect(staffUpdatedWords(12).spoken).toBe('Updated 12 seconds ago');
    expect(staffUpdatedWords(190).text).toBe('Updated 3 min ago');
    expect(staffUpdatedWords(null).text).toBe('No location yet');
    expect(noLocationWords(45)).toBe('No location · 45 s');
    expect(noLocationWords(75)).toBe('No location · 1 min');
    expect(noLocationWords(200)).toBe('No location · 3 min');
  });
});
