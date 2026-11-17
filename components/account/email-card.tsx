'use client';

import { revalidateLogic, useForm, useStore } from '@tanstack/react-form';
import { Check, Clock } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { changeEmailAction, resendVerificationAction } from '@/server/modules/auth/actions';
import { emailSchema } from '@/server/modules/auth/schema';
import { blurField, FieldShell, visibleError } from '@/components/forms/field-shell';
import { FormAlert } from '@/components/forms/form-alert';
import { focusFirstInvalid, focusThenAnnounce, submitChecked } from '@/components/forms/feedback';
import { StatusLine } from '@/components/forms/status-line';
import { SubmitButton } from '@/components/forms/submit-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { type ActionFailure, callAction, fieldError } from '@/lib/action-result';
import { clockTimeAfter, resendCountdownText } from '@/lib/account-text';
import { announce } from '@/lib/announce';
import { useAccount } from './account-context';
import { SettingsCard } from './settings-card';

const COOLDOWN_SECONDS = 60;
const SENT_TEXT = 'Sent. Check your inbox and spam folder.';
const RESEND_FAILED = "We couldn't send the link. Try again in a minute.";

/** The email's state (S3.3): "Confirmed", or "Not confirmed" with the word, never colour alone. */
export function EmailStatus({ verified }: { verified: boolean }) {
  return verified ? (
    <Badge variant="success">
      <Check aria-hidden />
      Confirmed
    </Badge>
  ) : (
    <Badge variant="pending">
      <Clock aria-hidden />
      Not confirmed
    </Badge>
  );
}

/** "Resend link", resting 60 seconds after each send with a visible (never announced) countdown (S3.4). */
function ResendLink({ focusOnArrival }: { focusOnArrival: boolean }) {
  const router = useRouter();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [state, setState] = useState<{
    tone: 'success' | 'error' | 'neutral' | null;
    text: string | null;
  }>({
    tone: null,
    text: focusOnArrival ? 'Press Resend link to get a new confirmation email.' : null,
  });
  const [busy, setBusy] = useState(false);
  const [restUntil, setRestUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (focusOnArrival) buttonRef.current?.focus();
  }, [focusOnArrival]);

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

  return (
    // Its parts join the action row: the status line takes its own row under both buttons.
    <div className="contents">
      <Button
        ref={buttonRef}
        type="button"
        variant="outline"
        size="touch"
        aria-disabled={busy || resting || undefined}
        className="border-brand-strong bg-white text-brand-strong hover:bg-brand-soft hover:text-brand-strong"
        onClick={() => {
          void (async () => {
            if (busy || resting) return;
            setBusy(true);
            const outcome = await callAction(() =>
              resendVerificationAction({ callbackUrl: '/account' }),
            );
            setBusy(false);
            if (outcome.ok) {
              setState({ tone: 'success', text: SENT_TEXT });
              announce(SENT_TEXT);
              setNow(Date.now());
              setRestUntil(Date.now() + COOLDOWN_SECONDS * 1000);
              return;
            }
            const error = outcome.error;
            if (error.code === 'CONFLICT') {
              router.refresh();
              return;
            }
            if (error.code === 'RATE_LIMITED' && error.retryAfterSeconds) {
              const text =
                error.retryAfterSeconds > COOLDOWN_SECONDS
                  ? `You've asked for several links. You can ask again at ${clockTimeAfter(error.retryAfterSeconds)}.`
                  : error.message;
              setState({ tone: 'neutral', text });
              setNow(Date.now());
              setRestUntil(Date.now() + error.retryAfterSeconds * 1000);
              announce(text);
              return;
            }
            const text =
              error.code === 'OFFLINE' || error.code === 'TIMEOUT' ? error.message : RESEND_FAILED;
            setState({ tone: 'error', text });
            announce(text);
          })();
        }}
      >
        {resting && restUntil !== null && restUntil - now <= COOLDOWN_SECONDS * 1000
          ? resendCountdownText((restUntil - now) / 1000)
          : 'Resend link'}
      </Button>
      <StatusLine tone={state.tone} className="order-last mt-0 basis-full">
        {state.text}
      </StatusLine>
    </div>
  );
}

const changeFields = z.object({ newEmail: emailSchema });

/** Fixing a mistyped, unconfirmed address (S3.6). The change happens when the new link is used. */
function ChangeEmail({
  open,
  onOpenChange,
  onSent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSent: (email: string) => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);

  const form = useForm({
    defaultValues: { newEmail: '' },
    validationLogic: revalidateLogic({ mode: 'blur', modeAfterSubmission: 'change' }),
    validators: { onDynamic: changeFields },
    onSubmitInvalid: () => focusFirstInvalid(formRef.current),
    onSubmit: async ({ value, formApi }) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      setFailure(null);
      const outcome = await callAction(() =>
        changeEmailAction({ newEmail: value.newEmail, callbackUrl: '/account' }),
      );
      busyRef.current = false;
      setBusy(false);
      if (outcome.ok) {
        formApi.reset();
        onSent(outcome.data.email);
        return;
      }
      setFailure(outcome.error);
      if (outcome.error.code === 'INVALID_INPUT') focusThenAnnounce('change-email-input');
      else focusThenAnnounce(null, outcome.error.message);
    },
  }); // Re-render the fields when a submit is tried, so every error shows.
  const submitted = useStore(form.store, (formState) => formState.submissionAttempts > 0);

  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleContent>
        <form
          ref={formRef}
          id="change-email"
          noValidate
          aria-label="Change email"
          className="mt-6 max-w-[524px] border-t border-neutral-6 pt-6"
          onSubmit={(event) => {
            event.preventDefault();
            void submitChecked(form);
          }}
        >
          {failure && failure.code !== 'INVALID_INPUT' ? (
            <FormAlert variant="error" className="mb-6">
              {failure.message}
            </FormAlert>
          ) : null}
          <form.Field name="newEmail">
            {(field) => {
              const error = visibleError(
                field.state.meta,
                submitted,
                fieldError(failure, 'newEmail'),
              );
              return (
                <FieldShell id="change-email-input" label="New email" error={error}>
                  {(control) => (
                    <Input
                      {...control}
                      name="newEmail"
                      type="email"
                      autoComplete="email"
                      inputMode="email"
                      autoCapitalize="none"
                      spellCheck={false}
                      value={field.state.value}
                      onChange={(event) => {
                        field.handleChange(event.target.value);
                        if (error) void form.validate('blur');
                      }}
                      onBlur={blurField(field.handleBlur)}
                    />
                  )}
                </FieldShell>
              );
            }}
          </form.Field>
          <div className="mt-8 flex flex-wrap gap-3">
            <SubmitButton pending={busy} pendingLabel="Sending…" className="uppercase md:min-w-40">
              Send link
            </SubmitButton>
            <Button
              type="button"
              variant="ghost"
              size="touch"
              onClick={() => {
                form.reset();
                setFailure(null);
                onOpenChange(false);
              }}
              className="text-neutral-2 hover:bg-neutral-7"
            >
              Cancel
            </Button>
          </div>
        </form>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** The Email card on /account (design 4.2). */
export function EmailCard({ resendRequested }: { resendRequested: boolean }) {
  const account = useAccount();
  const [changeOpen, setChangeOpen] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const changeButtonRef = useRef<HTMLButtonElement>(null);
  const sentRef = useRef<HTMLDivElement>(null);
  const canChange = !account.emailVerified && !account.isDemo;

  // "Wrong address? Change it" from the welcome notice opens the form (/account#change-email).
  useEffect(() => {
    if (!canChange) return undefined;
    const openFromHash = () => {
      if (window.location.hash !== '#change-email') return;
      setChangeOpen(true);
      setTimeout(() => document.getElementById('change-email-input')?.focus(), 0);
    };
    openFromHash();
    window.addEventListener('hashchange', openFromHash);
    return () => window.removeEventListener('hashchange', openFromHash);
  }, [canChange]);

  return (
    <SettingsCard id="email" title="Email">
      <p className="flex flex-wrap items-center gap-3">
        <span className="text-body-3 font-medium text-neutral-1 [overflow-wrap:anywhere]">
          {account.email}
        </span>
        <span className="sr-only"> · </span>
        <EmailStatus verified={account.emailVerified} />
      </p>
      {canChange ? (
        <>
          <p className="mt-2 text-body-5 text-neutral-3">
            Confirm your email before your first order. We sent the link to {account.email}.
          </p>
          {sentTo ? (
            <div ref={sentRef} tabIndex={-1} className="mt-4 focus:outline-none">
              <FormAlert variant="success">
                We sent a link to {sentTo}. The change takes effect when you click it.
              </FormAlert>
            </div>
          ) : null}
          <div className="mt-4 flex flex-wrap items-start gap-3">
            <ResendLink focusOnArrival={resendRequested} />
            <Button
              ref={changeButtonRef}
              type="button"
              variant="ghost"
              size="touch"
              aria-expanded={changeOpen}
              aria-controls="change-email"
              onClick={() => {
                const next = !changeOpen;
                setChangeOpen(next);
                if (next) {
                  setSentTo(null);
                  setTimeout(() => document.getElementById('change-email-input')?.focus(), 0);
                }
              }}
              className="text-brand-strong hover:bg-brand-soft hover:text-brand-strong"
            >
              Change email
            </Button>
          </div>
          <ChangeEmail
            open={changeOpen}
            onOpenChange={(open) => {
              setChangeOpen(open);
              if (!open) changeButtonRef.current?.focus();
            }}
            onSent={(email) => {
              setChangeOpen(false);
              setSentTo(email);
              const text = `We sent a link to ${email}. The change takes effect when you click it.`;
              requestAnimationFrame(() => sentRef.current?.focus());
              announce(text);
            }}
          />
        </>
      ) : null}
    </SettingsCard>
  );
}
