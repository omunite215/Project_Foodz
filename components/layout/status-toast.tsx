'use client';

import { X } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { FormAlert } from '@/components/forms/form-alert';
import { Button } from '@/components/ui/button';
import { announce } from '@/lib/announce';
import { useMotion } from '@/lib/motion';

/*
 * A message that isn't tied to a field (F3 design 1.4): a heart that couldn't be saved, the
 * favorites limit, the session ended elsewhere. It floats over the page, so it never moves the
 * layout. One at a time; it stays until dismissed, the next message or the next page, and is
 * never a timed fade. Its words are announced once.
 */

export interface StatusMessage {
  variant: 'error' | 'info' | 'warning';
  text: string;
  link?: { href: Route; label: string };
}

type Listener = (message: StatusMessage | null) => void;
const listeners = new Set<Listener>();

export function showStatusToast(message: StatusMessage): void {
  for (const listener of listeners) listener(message);
  announce(message.text);
}

export function dismissStatusToast(): void {
  for (const listener of listeners) listener(null);
}

export function StatusToast() {
  const [message, setMessage] = useState<StatusMessage | null>(null);
  const pathname = usePathname();
  const shownOn = useRef(pathname);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const listener: Listener = (next) => {
      shownOn.current = window.location.pathname;
      setMessage(next);
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  // A new page clears it.
  useEffect(() => {
    if (pathname !== shownOn.current) setMessage(null);
  }, [pathname]);

  useMotion(
    (motion) => {
      if (!message || !ref.current) return;
      motion.from(ref.current, {
        y: 8,
        opacity: 0,
        duration: motion.reduced ? 0.12 : 0.2,
        ease: 'power2.out',
      });
    },
    { scope: ref, dependencies: [message] },
  );

  if (!message) return null;
  return (
    <div ref={ref} className="fixed inset-x-4 bottom-4 z-40 md:right-6 md:left-auto md:w-[400px]">
      <div className="relative">
        <FormAlert variant={message.variant} className="pr-14 shadow-raised">
          {message.text}
          {message.link ? (
            <>
              {' '}
              <Link href={message.link.href} onClick={() => setMessage(null)}>
                {message.link.label}
              </Link>
            </>
          ) : null}
        </FormAlert>
        <Button
          type="button"
          variant="ghost"
          size="icon-touch"
          aria-label="Dismiss"
          onClick={() => setMessage(null)}
          className="absolute top-1.5 right-1.5 text-neutral-1 hover:bg-white/60"
        >
          <X className="size-5" aria-hidden />
        </Button>
      </div>
    </div>
  );
}
