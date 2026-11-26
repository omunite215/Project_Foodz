import { describe, expect, it } from 'vitest';
import { plainHeaderClass, statusHeaderClass } from './shell-classes';

const POSITIONS = ['static', 'relative', 'absolute', 'fixed', 'sticky'];
const positionsOf = (className: string) =>
  className.split(/\s+/).filter((name) => POSITIONS.includes(name));

describe('partner headers (review S1)', () => {
  it('keep the status header stuck to the top, online and offline', () => {
    expect(positionsOf(statusHeaderClass(true))).toEqual(['sticky']);
    expect(positionsOf(statusHeaderClass(false))).toEqual(['sticky']);
    expect(statusHeaderClass(true)).toContain('top-0');
  });

  it('keep the plain header stuck to the top', () => {
    expect(positionsOf(plainHeaderClass)).toEqual(['sticky']);
  });
});
