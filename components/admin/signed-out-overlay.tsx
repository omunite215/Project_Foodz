'use client';

import { LogOut } from 'lucide-react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { authPageHref, returnPathFor } from '@/lib/auth-links';

/** "Sign in again" back to this address with its filters (design 1.5, 1.7): a full page load. */
export function useSignInAgainHref(): string {
  const pathname = usePathname();
  const search = useSearchParams();
  return authPageHref('/sign-in', returnPathFor(pathname, search));
}

/**
 * The signed-out state (F5 design 1.7, A1.7, A12.9): the board behind is inert and dimmed, old
 * cards stay faintly visible but never presented as live, and focus moves to the heading — the
 * one time the board moves focus by itself, because everything behind it is gone.
 */
export function SignedOutOverlay() {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const href = useSignInAgainHref();

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-neutral-8/85 p-4">
      <section
        aria-labelledby="signed-out-title"
        className="w-full max-w-sm rounded-2xl border border-neutral-6 bg-white p-6 text-center shadow-raised"
      >
        <span
          aria-hidden
          className="mx-auto flex size-16 items-center justify-center rounded-full bg-neutral-7"
        >
          <LogOut className="size-8 text-neutral-3" />
        </span>
        <h2
          ref={headingRef}
          id="signed-out-title"
          tabIndex={-1}
          className="mt-4 font-heading text-title-2 text-neutral-2 outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring focus-visible:outline-solid"
        >
          You&apos;ve been signed out
        </h2>
        <p className="mt-2 text-body-4 text-neutral-3">Sign in again to keep the board live.</p>
        <Button asChild size="kitchen" className="mt-6 w-full">
          {/* A full page load: the board starts fresh after signing in. */}
          <a href={href}>Sign in again</a>
        </Button>
      </section>
    </div>
  );
}
