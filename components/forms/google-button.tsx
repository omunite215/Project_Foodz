'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

/** Google's multicolour "G", per its sign-in branding guidelines. Decorative: the text names it. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="size-5" aria-hidden>
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

/**
 * "Continue with Google" (design 2.9). Rendered only when the server says Google is set up. The
 * server cleans both return addresses; a refusal comes back on `errorPage` as `?error=`.
 */
export function GoogleButton({
  callbackUrl,
  errorPage,
  label = 'Continue with Google',
  onFailure,
}: {
  callbackUrl: string;
  errorPage: string;
  label?: string;
  onFailure: () => void;
}) {
  const [pending, setPending] = useState(false);

  return (
    <Button
      type="button"
      variant="outline"
      size="touch"
      aria-disabled={pending || undefined}
      onClick={() => {
        void (async () => {
          if (pending) return;
          setPending(true);
          try {
            const response = await fetch('/api/auth/sign-in/social', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                provider: 'google',
                callbackURL: callbackUrl,
                errorCallbackURL: errorPage,
              }),
            });
            const body: unknown = await response.json();
            const url =
              body && typeof body === 'object' && 'url' in body && typeof body.url === 'string'
                ? body.url
                : null;
            if (!response.ok || !url?.startsWith('https://')) throw new Error('No Google address');
            window.location.assign(url);
          } catch {
            setPending(false);
            onFailure();
          }
        })();
      }}
      className="w-full border-neutral-6 bg-white text-neutral-2 hover:bg-neutral-7"
    >
      {pending ? <Spinner className="size-5" /> : <GoogleMark />}
      {label}
    </Button>
  );
}

/** The "or" between Google and the email form. */
export function OrDivider() {
  return (
    <div className="my-6 flex items-center gap-4 text-body-5 text-muted-foreground">
      <span className="h-px flex-1 bg-neutral-6" aria-hidden />
      or
      <span className="h-px flex-1 bg-neutral-6" aria-hidden />
    </div>
  );
}
