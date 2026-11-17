'use client';

import { Check } from 'lucide-react';
import type { Route } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { resendVerificationAction } from '@/server/modules/auth/actions';
import { SubmitButton } from '@/components/forms/submit-button';
import { Button } from '@/components/ui/button';
import { callAction } from '@/lib/action-result';
import { announce } from '@/lib/announce';
import { cn } from '@/lib/utils';

export type EmailResultCase =
  | { kind: 'confirmed-new-session' }
  | { kind: 'confirmed-signed-out'; signInHref: Route }
  | { kind: 'already-confirmed'; continueHref: Route }
  | { kind: 'expired-signed-in' }
  | { kind: 'expired-signed-out'; signInHref: Route };

const ILLUSTRATION = {
  mail: { src: '/illustrations/mail-sent.svg', width: 200, height: 180 },
  warning: { src: '/illustrations/warning.svg', width: 200, height: 207 },
};

/** One resend, then "Sent…" in place of the line (S3.5). */
function SendNewLink() {
  const [state, setState] = useState<'idle' | 'busy' | 'sent' | 'failed'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="mt-8">
      {state === 'sent' ? null : (
        <SubmitButton
          type="button"
          pending={state === 'busy'}
          pendingLabel="Sending…"
          className="uppercase"
          onClick={() => {
            void (async () => {
              setState('busy');
              const outcome = await callAction(() => resendVerificationAction({}));
              if (outcome.ok) {
                setState('sent');
                announce('Sent. Check your inbox and spam folder.');
                return;
              }
              setState('failed');
              setMessage(outcome.error.message);
              announce(outcome.error.message);
            })();
          }}
        >
          Send a new link
        </SubmitButton>
      )}
      <p
        className={cn(
          'mt-3 flex min-h-6 items-center justify-center gap-1.5 text-body-5',
          state === 'failed' ? 'text-destructive' : 'text-neutral-3',
        )}
      >
        {state === 'sent' ? (
          <>
            <Check className="size-4 text-brand-strong" aria-hidden />
            Sent. Check your inbox and spam folder.
          </>
        ) : state === 'failed' ? (
          message
        ) : null}
      </p>
    </div>
  );
}

/** The result of opening a confirm-email link (S3.2, S3.5, design 3.7). The h1 takes focus. */
export function EmailResult({ result }: { result: EmailResultCase }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const expired = result.kind === 'expired-signed-in' || result.kind === 'expired-signed-out';
  const art = expired ? ILLUSTRATION.warning : ILLUSTRATION.mail;
  const title = expired
    ? 'This link has expired'
    : result.kind === 'already-confirmed'
      ? 'Your email is already confirmed'
      : 'Email confirmed';
  const line = expired
    ? 'Confirmation links work for 24 hours. We can send you a new one.'
    : result.kind === 'already-confirmed'
      ? null
      : result.kind === 'confirmed-signed-out'
        ? 'Sign in with your new email to carry on.'
        : "You're ready to order.";

  return (
    <div>
      <Image
        src={art.src}
        alt=""
        width={art.width}
        height={art.height}
        unoptimized
        className="mx-auto h-auto w-40 md:w-50"
      />
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="mt-6 font-heading text-h4 text-neutral-2 focus:outline-none md:text-h3"
      >
        {title}
      </h1>
      {line ? <p className="mt-3 text-body-4 text-neutral-3">{line}</p> : null}
      {result.kind === 'expired-signed-in' ? <SendNewLink /> : null}
      {result.kind === 'expired-signed-out' || result.kind === 'confirmed-signed-out' ? (
        <Button asChild size="touch" className="mt-8 uppercase">
          <Link href={result.signInHref}>
            {result.kind === 'expired-signed-out' ? 'Sign in to get a new link' : 'Sign in'}
          </Link>
        </Button>
      ) : null}
      {result.kind === 'confirmed-new-session' ? (
        <Button asChild size="touch" className="mt-8 uppercase">
          <Link href="/menu">Continue to the menu</Link>
        </Button>
      ) : null}
      {result.kind === 'already-confirmed' ? (
        <Button asChild size="touch" className="mt-8 uppercase">
          <Link href={result.continueHref}>Continue</Link>
        </Button>
      ) : null}
    </div>
  );
}
