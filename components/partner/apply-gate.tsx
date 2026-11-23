'use client';

import { Lock, MailCheck } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useId, useState } from 'react';
import { resendVerificationAction } from '@/server/modules/auth/actions';
import type { PartnerState } from '@/server/modules/partners/schema';
import { SignOutDialog, useSignOut } from '@/components/layout/sign-out';
import { Button } from '@/components/ui/button';
import { clockTimeAfter, resendCountdownText } from '@/lib/account-text';
import { callAction } from '@/lib/action-result';
import { announce } from '@/lib/announce';
import { cn } from '@/lib/utils';
import { IconDisc, PartnerFrame, PlainHeader } from './shell';

/*
 * The gates before the form (F6 design 3, P1.4, P1.6): an unconfirmed email, a staff account and
 * the shared demo customer. One centred block, no dock. The masked address comes from the server.
 */

type Gate = Extract<PartnerState, { screen: 'gate' }>;

const COOLDOWN_SECONDS = 60;
const SENT_TEXT = 'Sent. Check your inbox and spam folder.';
const RESEND_FAILED = "We couldn't send the link. Try again in a minute.";

function ResendLink() {
  const statusId = useId();
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState<{ tone: 'success' | 'error' | 'neutral'; text: string } | null>(
    null,
  );
  const [restUntil, setRestUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (restUntil === null) return undefined;
    const timer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= restUntil) setRestUntil(null);
    }, 1000);
    return () => clearInterval(timer);
  }, [restUntil]);
  const resting = restUntil !== null && now < restUntil;
  const countdown =
    resting && restUntil !== null && restUntil - now <= COOLDOWN_SECONDS * 1000
      ? `${resendCountdownText((restUntil - now) / 1000)}.`
      : null;
  const line = [text?.text, countdown].filter(Boolean).join(' ') || null;

  const resend = async () => {
    if (busy) return;
    if (resting) {
      if (line) announce(line);
      return;
    }
    setBusy(true);
    const outcome = await callAction(() =>
      resendVerificationAction({ callbackUrl: '/partner/apply' }),
    );
    setBusy(false);
    if (outcome.ok) {
      setText({ tone: 'success', text: SENT_TEXT });
      announce(SENT_TEXT);
      setNow(Date.now());
      setRestUntil(Date.now() + COOLDOWN_SECONDS * 1000);
      return;
    }
    const error = outcome.error;
    if (error.code === 'RATE_LIMITED' && error.retryAfterSeconds) {
      const message =
        error.retryAfterSeconds > COOLDOWN_SECONDS
          ? `You've asked for several links. You can ask again at ${clockTimeAfter(error.retryAfterSeconds)}.`
          : error.message;
      setText({ tone: 'neutral', text: message });
      setNow(Date.now());
      setRestUntil(Date.now() + error.retryAfterSeconds * 1000);
      announce(message);
      return;
    }
    const message =
      error.code === 'OFFLINE' || error.code === 'TIMEOUT' ? error.message : RESEND_FAILED;
    setText({ tone: 'error', text: message });
    announce(message);
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="kitchen"
        aria-disabled={busy || resting || undefined}
        aria-describedby={line ? statusId : undefined}
        onClick={() => void resend()}
        className={cn(resting && !busy && 'cursor-not-allowed bg-muted text-muted-foreground')}
      >
        Send the link again
      </Button>
      <p
        id={statusId}
        className={cn(
          'min-h-6 text-body-5',
          text?.tone === 'error' ? 'text-destructive' : 'text-foreground',
        )}
      >
        {line}
      </p>
    </>
  );
}

function DemoSignOut() {
  const signOut = useSignOut();
  return (
    <>
      <Button type="button" variant="outline" size="kitchen" onClick={() => signOut.request()}>
        Sign out
      </Button>
      <SignOutDialog state={signOut} />
    </>
  );
}

export function ApplyGate({ state }: { state: Gate }) {
  const content = {
    emailNotConfirmed: {
      icon: MailCheck,
      title: 'Confirm your email first',
      line: `We sent a link to ${state.email?.masked ?? 'your email'}. Open it on this phone, then come back here.`,
      action: <ResendLink />,
    },
    staff: {
      icon: Lock,
      title: "Staff accounts can't apply to deliver",
      line: 'Apply with a personal account instead.',
      action: (
        <Button asChild variant="outline" size="kitchen">
          <Link href="/admin">Back to staff tools</Link>
        </Button>
      ),
    },
    demoCustomer: {
      icon: Lock,
      title: "The demo account can't apply",
      line: 'Sign in as the demo partner to see the partner app.',
      action: <DemoSignOut />,
    },
  }[state.gate];

  return (
    <PartnerFrame header={<PlainHeader />}>
      <div className="mx-auto max-w-sm pt-12 text-center">
        <IconDisc icon={content.icon} />
        <h1 className="mt-6 font-heading text-title-1 text-strong">{content.title}</h1>
        <p className="mt-3 text-body-4 text-muted-foreground [overflow-wrap:anywhere]">
          {content.line}
        </p>
        <div className="mt-8 flex flex-col gap-3">{content.action}</div>
      </div>
    </PartnerFrame>
  );
}
