'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { type ReactNode, useRef } from 'react';
import { announce } from '@/lib/announce';
import { useMotion } from '@/lib/motion';

/** Moves focus first, then announces, so the message is read after the field's name (design 2.6). */
export function focusThenAnnounce(target: string | HTMLElement | null, message?: string) {
  requestAnimationFrame(() => {
    const element = typeof target === 'string' ? document.getElementById(target) : (target ?? null);
    element?.focus();
    if (element instanceof HTMLInputElement && element.dataset.selectOnFocus !== undefined) {
      element.select();
    }
    if (message) announce(message);
  });
}

/** After a submit with errors: the first invalid field takes focus; its error is read with it. */
export function focusFirstInvalid(form: HTMLFormElement | null, frames = 10) {
  requestAnimationFrame(() => {
    const field = form?.querySelector<HTMLElement>('[aria-invalid="true"]');
    // The errors appear with the next render; look again for a few frames.
    if (field) field.focus();
    else if (frames > 0) focusFirstInvalid(form, frames - 1);
  });
}

/**
 * A server message with one phrase in it turned into a link ("…or reset your password."). The
 * text stays exactly as the server wrote it.
 */
export function MessageWithLink({
  text,
  phrase,
  href,
  onNavigate,
}: {
  text: string;
  phrase: string;
  href: Route;
  onNavigate?: () => void;
}) {
  const index = text.toLowerCase().indexOf(phrase.toLowerCase());
  if (index < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, index)}
      <Link href={href} onClick={onNavigate}>
        {text.slice(index, index + phrase.length)}
      </Link>
      {text.slice(index + phrase.length)}
    </>
  );
}

/** Content that replaces a form after an action: it rises 8 px and fades in (opacity only under reduced motion). */
export function FadeIn({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useMotion(
    (motion) => {
      if (!ref.current) return;
      motion.from(ref.current, {
        y: 8,
        opacity: 0,
        duration: motion.reduced ? 0.15 : 0.2,
        ease: 'power2.out',
      });
    },
    { scope: ref },
  );
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}

/**
 * Submits after checking every field again: a value may have changed since its last check (typed
 * without leaving the field, then Enter), and a stale error would otherwise block the submit.
 */
export async function submitChecked(form: {
  validate: (cause: 'submit') => unknown;
  handleSubmit: () => Promise<void>;
}) {
  await form.validate('submit');
  await form.handleSubmit();
}
