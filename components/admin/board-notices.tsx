'use client';

import { X } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { FormAlert } from '@/components/forms/form-alert';
import { Button } from '@/components/ui/button';
import { announce } from '@/lib/announce';
import { useMotion } from '@/lib/motion';

/*
 * Short-lived board notices (F5 design 1.6): a cancelled card (A3.7), a refused move (A4.6), a
 * device that won't keep the screen on. Each stays 8 seconds, longer while hovered or focused;
 * at most three, the oldest leaving first. Their words are announced once and they never take
 * focus; Escape dismisses the focused one.
 */

export interface BoardNotice {
  id: number;
  text: string;
  variant: 'info' | 'error' | 'warning';
}

export const NOTICE_MS = 8_000;
const MAX_NOTICES = 3;

let notices: BoardNotice[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => {
  for (const listener of listeners) listener();
};

export function showBoardNotice(
  text: string,
  {
    variant = 'info',
    assertive = false,
  }: { variant?: BoardNotice['variant']; assertive?: boolean } = {},
): void {
  notices = [...notices, { id: nextId++, text, variant }].slice(-MAX_NOTICES);
  emit();
  announce(text, { assertive });
}

export function dismissBoardNotice(id: number): void {
  notices = notices.filter((notice) => notice.id !== id);
  emit();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const EMPTY: BoardNotice[] = [];

function Notice({ notice }: { notice: BoardNotice }) {
  const ref = useRef<HTMLDivElement>(null);
  const [held, setHeld] = useState(false);

  // Held while hovered or focused (design 1.6): the timer waits.
  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const hold = () => setHeld(true);
    const release = (event: Event) => {
      const next = event instanceof FocusEvent ? event.relatedTarget : null;
      if (next instanceof Node && element.contains(next)) return;
      setHeld(false);
    };
    element.addEventListener('pointerenter', hold);
    element.addEventListener('pointerleave', release);
    element.addEventListener('focusin', hold);
    element.addEventListener('focusout', release);
    return () => {
      element.removeEventListener('pointerenter', hold);
      element.removeEventListener('pointerleave', release);
      element.removeEventListener('focusin', hold);
      element.removeEventListener('focusout', release);
    };
  }, []);

  useEffect(() => {
    if (held) return undefined;
    const timer = setTimeout(() => dismissBoardNotice(notice.id), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [held, notice.id]);

  useMotion(
    (motion) => {
      if (!ref.current) return;
      motion.from(ref.current, {
        y: 8,
        opacity: 0,
        duration: motion.reduced ? 0.12 : 0.2,
        ease: 'power2.out',
      });
    },
    { scope: ref },
  );

  return (
    <div ref={ref} className="relative">
      <FormAlert variant={notice.variant} className="pr-14 shadow-raised">
        {notice.text}
      </FormAlert>
      <Button
        type="button"
        variant="ghost"
        size="icon-touch"
        aria-label="Dismiss"
        onClick={() => dismissBoardNotice(notice.id)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') dismissBoardNotice(notice.id);
        }}
        className="absolute top-1.5 right-1.5 text-neutral-1 hover:bg-white/60"
      >
        <X className="size-5" aria-hidden />
      </Button>
    </div>
  );
}

export function BoardNotices() {
  const current = useSyncExternalStore(
    subscribe,
    () => notices,
    () => EMPTY,
  );
  if (current.length === 0) return null;
  return (
    <div className="fixed inset-x-4 bottom-4 z-40 flex flex-col gap-2 md:right-6 md:bottom-6 md:left-auto md:w-[400px]">
      {current.map((notice) => (
        <Notice key={notice.id} notice={notice} />
      ))}
    </div>
  );
}
