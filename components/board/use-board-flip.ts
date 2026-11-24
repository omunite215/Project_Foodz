'use client';

import { type RefObject, useCallback, useLayoutEffect, useRef } from 'react';
import { Flip, flipFrom, prefersReducedMotion } from '@/lib/motion';

type Captured =
  | { kind: 'flip'; state: Flip.FlipState }
  | { kind: 'columns'; columns: Map<string, string>; at: number };

/** Where each card sits: its id and the id of the column section around it. */
function columnsOf(root: HTMLElement): Map<string, string> {
  const columns = new Map<string, string>();
  for (const item of root.querySelectorAll<HTMLElement>('[data-flip-id]')) {
    const id = item.dataset.flipId;
    const column = item.closest('section')?.id;
    if (id && column) columns.set(id, column);
  }
  return columns;
}

/**
 * Cards travelling between columns (F5 motion table, design open item 6): positions are
 * captured before the board's data changes, and played from once the new layout is drawn.
 * Cards closing a gap or making room slide too. Reduced motion: nothing travels; the cards
 * that changed column are handed to `onMovedStill`, which outlines them so the eye can find
 * where the ticket went (D20).
 */
export function useBoardFlip(
  container: RefObject<HTMLElement | null>,
  onMovedStill: (ids: string[]) => void,
) {
  const captured = useRef<Captured | null>(null);

  const capture = useCallback(() => {
    const root = container.current;
    // Phones show one column at a time: a card moving to another tab doesn't travel.
    if (!root || window.matchMedia('(max-width: 47.98rem)').matches) return;
    captured.current = prefersReducedMotion()
      ? { kind: 'columns', columns: columnsOf(root), at: Date.now() }
      : { kind: 'flip', state: Flip.getState(root.querySelectorAll('[data-flip-id]')) };
  }, [container]);

  // After every render: plays only when positions were captured before a change.
  useLayoutEffect(() => {
    const before = captured.current;
    const root = container.current;
    if (!before || !root) return;
    if (before.kind === 'flip') {
      captured.current = null;
      flipFrom(before.state, { targets: root.querySelectorAll('[data-flip-id]') });
      return;
    }
    const moved: string[] = [];
    for (const [id, column] of columnsOf(root)) {
      const was = before.columns.get(id);
      if (was && was !== column) moved.push(id);
    }
    // The data can land a render or two after the capture; give it a moment.
    if (moved.length === 0 && Date.now() - before.at < 1_000) return;
    captured.current = null;
    if (moved.length > 0) onMovedStill(moved);
  });

  return capture;
}
