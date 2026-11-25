import { describe, expect, it } from 'vitest';
import {
  clampPan,
  fittedSize,
  needsFreshLink,
  panStep,
  rotateQuarter,
  zoomIn,
  zoomOut,
  zoomText,
} from './viewer';

describe('the document viewer', () => {
  it('zooms between 100% and 300%', () => {
    expect(zoomIn(1)).toBe(2);
    expect(zoomIn(3)).toBe(3);
    expect(zoomOut(2)).toBe(1);
    expect(zoomOut(1)).toBe(1);
    expect(zoomText(2)).toBe('200%');
  });

  it('turns a quarter at a time', () => {
    expect(rotateQuarter(0)).toBe(90);
    expect(rotateQuarter(270)).toBe(0);
  });

  it('fits the image, swapping its sides when turned', () => {
    expect(fittedSize({ width: 1586, height: 1000 }, { width: 800, height: 800 }, 0)).toEqual({
      width: 800,
      height: (800 / 1586) * 1000,
    });
    const turned = fittedSize({ width: 1586, height: 1000 }, { width: 800, height: 800 }, 90);
    expect(turned.height).toBeCloseTo(800);
    expect(fittedSize({ width: 0, height: 0 }, { width: 800, height: 800 }, 0)).toEqual({
      width: 0,
      height: 0,
    });
  });

  it('keeps the pan inside the image', () => {
    const fitted = { width: 800, height: 500 };
    const canvas = { width: 800, height: 600 };
    expect(clampPan({ x: 500, y: 500 }, fitted, canvas, 1)).toEqual({ x: 0, y: 0 });
    expect(clampPan({ x: 5000, y: -5000 }, fitted, canvas, 2)).toEqual({ x: 400, y: -200 });
  });

  it('steps further with Shift', () => {
    expect(panStep(false)).toBe(40);
    expect(panStep(true)).toBe(120);
  });

  it('renews a link with under 30 seconds left', () => {
    const now = Date.parse('2026-11-20T23:00:00Z');
    expect(needsFreshLink('2026-11-20T23:04:00Z', now)).toBe(false);
    expect(needsFreshLink('2026-11-20T23:00:20Z', now)).toBe(true);
    expect(needsFreshLink(null, now)).toBe(true);
  });
});
