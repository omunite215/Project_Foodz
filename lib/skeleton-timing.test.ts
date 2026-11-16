import { beforeEach, describe, expect, it } from 'vitest';
import {
  markSkeletonGone,
  markSkeletonVisible,
  SKELETON_MIN_VISIBLE_MS,
  skeletonHoldMs,
} from './skeleton-timing';

describe('skeleton timing', () => {
  beforeEach(() => markSkeletonGone());

  it('holds nothing when no skeleton was shown', () => {
    expect(skeletonHoldMs(1000)).toBe(0);
  });

  it('keeps a skeleton up for at least 300 ms once shown', () => {
    markSkeletonVisible(1000);
    expect(skeletonHoldMs(1000)).toBe(SKELETON_MIN_VISIBLE_MS);
    expect(skeletonHoldMs(1120)).toBe(180);
    expect(skeletonHoldMs(1300)).toBe(0);
    expect(skeletonHoldMs(5000)).toBe(0);
  });

  it('forgets a skeleton that has gone', () => {
    markSkeletonVisible(1000);
    markSkeletonGone();
    expect(skeletonHoldMs(1010)).toBe(0);
  });
});
