'use client';

import { CircleExclamationPoint, MailExclamationPoint, Users } from 'lucide-react';
import { type ReactNode, type Ref, useEffect, useId, useRef, useState } from 'react';
import { resendVerificationAction } from '@/server/modules/auth/actions';
import { FormAlert } from '@/components/forms/form-alert';
import { StatusLine } from '@/components/forms/status-line';
import { BLOCKED_BUTTON_CLASS, useSlowPending } from '@/components/forms/submit-button';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { callAction } from '@/lib/action-result';
import { clockTimeAfter, resendCountdownText } from '@/lib/account-text';
import { announce } from '@/lib/announce';
import { SLOW_PRESS, SLOW_PRESS_OFFLINE } from '@/lib/checkout-text';
import { useHydrated } from '@/lib/use-hydrated';
import { cn } from '@/lib/utils';

/*
 * The pay bar (F4 design 2.16, 2.17, D5, D22, D28): pinned to the bottom below 1024 px, the end of
 * the form from there. The button carries the amount the server worked out. A blocked button
 * stays focusable and says why beside it; a press that may still be going through is never
 * offered again: after 15 s the button gives way to a status panel.
 */

export const PAY_REASON_ID = 'pay-reason';
export const PAY_STATUS_ID = 'pay-status';

export type PayBarContent =
  | {
      kind: 'button';
      label: string;
      /** The press is on its way: the label after 300 ms. */
      pendingLabel: string | null;
      blocked: boolean;
      /** Blocked, but only grey after 300 ms (updating the total). */
      greyLater?: boolean;
      reason: ReactNode;
      reasonTone?: 'neutral' | 'error';
      reasonSpinner?: boolean;
      /** Repeated aloud when a blocked button is pressed. */
      reasonText: string | null;
    }
  | { kind: 'status'; offline: boolean; checking: boolean; onCheck: () => void }
  | { kind: 'email'; email: string }
  | { kind: 'demo'; onCreateAccount: () => void };

export interface PayBarProps {
  content: PayBarContent;
  onPay: () => void;
  /** "Your order wasn't sent. Nothing was charged." above the button. */
  notice: ReactNode;
  noticeRef?: Ref<HTMLDivElement>;
  statusRef?: Ref<HTMLDivElement>;
  gateRef?: Ref<HTMLParagraphElement>;
  buttonRef?: Ref<HTMLButtonElement>;
  /** A text field has focus on a touch phone: the pinned bar steps out of the way (D5). */
  typing: boolean;
}

const COOLDOWN_SECONDS = 60;
const SENT_TEXT = 'Sent. Check your inbox and spam folder.';
const RESEND_FAILED = "We couldn't send the link. Try again in a minute.";

function EmailGate({ email, gateRef }: { email: string; gateRef?: Ref<HTMLParagraphElement> }) {
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
    const outcome = await callAction(() => resendVerificationAction({ callbackUrl: '/checkout' }));
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
      <div
        id="pay-gate"
        className="flex flex-col gap-3 rounded-xl bg-tag-6-bg p-4 text-body-5 text-neutral-1 md:flex-row md:items-center"
      >
        <MailExclamationPoint className="hidden size-5 shrink-0 text-tag-6 md:block" aria-hidden />
        <p ref={gateRef} tabIndex={-1} className="flex-1 outline-none [overflow-wrap:anywhere]">
          Confirm your email to place your order. We sent a link to {email}.
        </p>
        <Button
          type="button"
          variant="outline"
          size="touch"
          aria-disabled={busy || resting || undefined}
          aria-describedby={resting && line ? statusId : undefined}
          onClick={() => {
            void resend();
          }}
          className={cn('bg-white', resting && !busy && BLOCKED_BUTTON_CLASS)}
        >
          Resend link
        </Button>
      </div>
      <StatusLine id={statusId} tone={text?.tone ?? null} className="mt-2 min-h-5 text-center">
        {line}
      </StatusLine>
    </>
  );
}

function DemoGate({
  onCreateAccount,
  gateRef,
}: {
  onCreateAccount: () => void;
  gateRef?: Ref<HTMLParagraphElement>;
}) {
  return (
    <div
      id="pay-gate"
      className="flex flex-col gap-3 rounded-xl bg-tag-6-bg p-4 text-body-5 text-neutral-1 md:flex-row md:items-center"
    >
      <Users className="hidden size-5 shrink-0 text-tag-6 md:block" aria-hidden />
      <p ref={gateRef} tabIndex={-1} className="flex-1 outline-none">
        Demo accounts can&apos;t place orders. Create your own account to try checkout with Stripe
        test cards.
      </p>
      <Button
        type="button"
        variant="outline"
        size="touch"
        onClick={onCreateAccount}
        className="bg-white"
      >
        Create an account
      </Button>
    </div>
  );
}

function StatusPanel({
  offline,
  checking,
  onCheck,
  statusRef,
}: {
  offline: boolean;
  checking: boolean;
  onCheck: () => void;
  statusRef?: Ref<HTMLDivElement>;
}) {
  const slowChecking = useSlowPending(checking);
  return (
    <div
      ref={statusRef}
      id={PAY_STATUS_ID}
      tabIndex={-1}
      className="rounded-xl bg-neutral-7 p-4 text-body-5 text-neutral-1 outline-none focus-visible:outline-2"
    >
      <p className="flex items-start gap-2">
        <Spinner className="mt-0.5 size-4 shrink-0 motion-reduce:animate-none" aria-hidden />
        {offline ? SLOW_PRESS_OFFLINE : SLOW_PRESS}
      </p>
      {offline ? null : (
        <Button
          type="button"
          variant="outline"
          size="touch"
          aria-disabled={checking || undefined}
          onClick={() => {
            if (!checking) onCheck();
          }}
          className="mt-3 bg-white"
        >
          {slowChecking ? (
            <>
              <Spinner className="size-4 motion-reduce:animate-none" aria-hidden />
              Checking…
            </>
          ) : (
            'Check again'
          )}
        </Button>
      )}
    </div>
  );
}

export function PayBar({
  content,
  onPay,
  notice,
  noticeRef,
  statusRef,
  gateRef,
  buttonRef,
  typing,
}: PayBarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const hydrated = useHydrated();
  const pressing = content.kind === 'button' && content.pendingLabel !== null;
  const slow = useSlowPending(pressing);
  const greyNow = useSlowPending(content.kind === 'button' && Boolean(content.greyLater));

  // The bar's own height, for the page's bottom padding and the focus margin (design §0).
  useEffect(() => {
    const bar = barRef.current;
    if (!bar || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      document.documentElement.style.setProperty(
        '--pay-bar-h',
        `${Math.ceil(entry.borderBoxSize[0]?.blockSize ?? bar.offsetHeight)}px`,
      );
    });
    observer.observe(bar);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty('--pay-bar-h');
    };
  }, []);

  let body: ReactNode;
  let reason: ReactNode = null;
  let reasonTone: 'neutral' | 'error' = 'neutral';
  let reasonSpinner = false;
  if (content.kind === 'status') {
    body = (
      <StatusPanel
        offline={content.offline}
        checking={content.checking}
        onCheck={content.onCheck}
        statusRef={statusRef}
      />
    );
  } else if (content.kind === 'email') {
    body = <EmailGate email={content.email} gateRef={gateRef} />;
  } else if (content.kind === 'demo') {
    body = <DemoGate onCreateAccount={content.onCreateAccount} gateRef={gateRef} />;
  } else {
    const inactive = pressing || content.blocked;
    const looksBlocked = content.blocked && !pressing && (!content.greyLater || greyNow);
    reason = content.reason;
    reasonTone = content.reasonTone ?? 'neutral';
    reasonSpinner = Boolean(content.reasonSpinner);
    body = (
      <Button
        ref={buttonRef}
        type="button"
        size="touch"
        // Until the page's scripts run, the button can't send anything (F2 SubmitButton rule).
        disabled={!hydrated || undefined}
        aria-disabled={inactive || undefined}
        aria-describedby={content.blocked && content.reason ? PAY_REASON_ID : undefined}
        onClick={() => {
          if (pressing) return;
          if (content.blocked) {
            if (content.reasonText) announce(content.reasonText);
            return;
          }
          onPay();
        }}
        className={cn(
          'w-full uppercase disabled:opacity-100',
          inactive && 'cursor-not-allowed',
          looksBlocked && BLOCKED_BUTTON_CLASS,
        )}
      >
        {pressing && slow ? (
          <>
            <Spinner className="size-4 motion-reduce:animate-none" aria-hidden />
            {content.pendingLabel}
          </>
        ) : (
          content.label
        )}
      </Button>
    );
  }

  return (
    <div
      ref={barRef}
      data-pay-bar
      data-typing={typing || undefined}
      className={cn(
        'fixed inset-x-0 bottom-0 z-30 border-t border-neutral-6 bg-white px-6 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-raised md:px-12',
        'transition-[transform,visibility] duration-150 motion-reduce:transition-none',
        'data-[typing=true]:invisible data-[typing=true]:translate-y-full',
        'lg:static lg:z-auto lg:mt-12 lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none lg:data-[typing=true]:visible lg:data-[typing=true]:translate-y-0',
        '[@media(max-height:480px)]:static [@media(max-height:480px)]:mt-10 [@media(max-height:480px)]:px-0 [@media(max-height:480px)]:shadow-none',
      )}
    >
      <div className="mx-auto max-w-[672px] lg:max-w-none">
        <div ref={noticeRef} tabIndex={-1} className="outline-none">
          {notice ? <div className="mb-3">{notice}</div> : null}
        </div>
        {body}
        {content.kind === 'button' ? (
          <div
            id={PAY_REASON_ID}
            className={cn(
              'mt-2 flex min-h-5 flex-wrap items-center justify-center gap-x-1.5 text-center text-body-5',
              reasonTone === 'error' ? 'text-destructive' : 'text-neutral-3',
            )}
          >
            {reasonSpinner ? (
              <Spinner className="size-4 motion-reduce:animate-none" aria-hidden />
            ) : null}
            {reasonTone === 'error' && reason ? (
              <CircleExclamationPoint className="size-4 shrink-0" aria-hidden />
            ) : null}
            {reason}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** "Your order wasn't sent. Nothing was charged." (design 2.17). */
export function NotSentNotice({ children }: { children: ReactNode }) {
  return <FormAlert variant="info">{children}</FormAlert>;
}
