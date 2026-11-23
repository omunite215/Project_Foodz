'use client';

import { type RefObject, useCallback, useLayoutEffect, useRef } from 'react';
import { Flip, flipFrom } from '@/lib/motion';

/**
 * Cards travelling between columns (F5 motion table, design open item 6): positions are
 * captured before the board's data changes, and played from once the new layout is drawn.
 * Cards closing a gap or making room slide too. Reduced motion: nothing travels.
 */
export function useBoardFlip(container: RefObject<HTMLElement | null>) {
  const captured = useRef<Flip.FlipState | null>(null);

  const capture = useCallback(() => {
    const root = container.current;
    if (!root) return;
    captured.current = Flip.getState(root.querySelectorAll('[data-flip-id]'));
  }, [container]);

  // After every render: plays only when positions were captured before a change.
  useLayoutEffect(() => {
    const state = captured.current;
    if (!state) return;
    captured.current = null;
    flipFrom(state, { targets: container.current?.querySelectorAll('[data-flip-id]') });
  });

  return capture;
}
