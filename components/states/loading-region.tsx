'use client';

import { type ReactNode, useEffect, useState } from 'react';
import {
  markSkeletonGone,
  markSkeletonVisible,
  SKELETON_DELAY_MS,
  skeletonHoldMs,
} from '@/lib/skeleton-timing';

/**
 * A route's loading skeleton. It appears only once loading has taken longer than 150 ms; until
 * then the same space stays empty, so the page shape is reserved either way. The region is
 * marked busy and carries one label for screen readers.
 */
export function LoadingRegion({ label, children }: { label: string; children: ReactNode }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      markSkeletonVisible();
      setVisible(true);
    }, SKELETON_DELAY_MS);
    return () => {
      clearTimeout(timer);
      markSkeletonGone();
    };
  }, []);

  return (
    <div aria-busy="true" className={visible ? undefined : 'invisible'}>
      <output className="sr-only">{visible ? label : ''}</output>
      {children}
    </div>
  );
}

/**
 * Wraps a page that replaces a skeleton: if the skeleton has been up for less than 300 ms, it
 * stays up for the rest of that time, so nothing flickers. Pages loaded directly (no skeleton)
 * render straight away.
 */
export function HoldSkeleton({ skeleton, children }: { skeleton: ReactNode; children: ReactNode }) {
  const [holdMs] = useState(() => (typeof window === 'undefined' ? 0 : skeletonHoldMs()));
  const [holding, setHolding] = useState(holdMs > 0);

  useEffect(() => {
    if (holdMs <= 0) return undefined;
    const timer = setTimeout(() => setHolding(false), holdMs);
    return () => clearTimeout(timer);
  }, [holdMs]);

  return holding ? <div aria-busy="true">{skeleton}</div> : children;
}
