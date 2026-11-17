'use client';

import { revalidateLogic, useForm, useStore } from '@tanstack/react-form';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { z } from 'zod';
import { requestPasswordResetAction } from '@/server/modules/auth/actions';
import { emailSchema } from '@/server/modules/auth/schema';
import { blurField, FieldShell, visibleError } from '@/components/forms/field-shell';
import { FormAlert } from '@/components/forms/form-alert';
import { focusFirstInvalid, focusThenAnnounce, submitChecked } from '@/components/forms/feedback';
import { SubmitButton } from '@/components/forms/submit-button';
import { CHECK_FAILED_TEXT, Turnstile, type TurnstileHandle } from '@/components/forms/turnstile';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { type ActionFailure, callAction, fieldError } from '@/lib/action-result';
import { authPageHref } from '@/lib/auth-links';
import { recalledEmail, rememberEmail } from '@/lib/email-handoff';
import { CheckInboxPanel } from './check-inbox-panel';

const fields = z.object({ email: emailSchema });

/**
 * Asks for a reset link (S3.8, design 3.5). Whatever the address, the answer is the same
 * "Check your email" panel, so the form never reveals who has an account.
 */
export function ForgotPasswordForm({
  callbackUrl,
  submitLabel = 'Send reset link',
  focusEmail = false,
  children,
}: {
  callbackUrl: string;
  submitLabel?: string;
  /** Focus the email field on arrival (the dead-link page). */
  focusEmail?: boolean;
  /** The title block above the form. */
  children: React.ReactNode;
}) {
  const id = useId();
  const emailId = `${id}-email`;
  const formRef = useRef<HTMLFormElement>(null);
  const turnstileRef = useRef<TurnstileHandle>(null);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [challenge, setChallenge] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const form = useForm({
    defaultValues: { email: '' },
    validationLogic: revalidateLogic({ mode: 'blur', modeAfterSubmission: 'change' }),
    validators: { onDynamic: fields },
    onSubmitInvalid: () => focusFirstInvalid(formRef.current),
    onSubmit: ({ value }) => submit(value.email),
  }); // Re-render the fields when a submit is tried, so every error shows.
  const submitted = useStore(form.store, (formState) => formState.submissionAttempts > 0);

  useEffect(() => {
    const email = recalledEmail();
    if (email && !form.getFieldValue('email')) {
      form.setFieldValue('email', email, { dontUpdateMeta: true });
    }
    if (focusEmail) document.getElementById(emailId)?.focus();
  }, [form, focusEmail, emailId]);

  async function submit(email: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setFailure(null);
    rememberEmail(email);
    try {
      const captchaToken = await turnstileRef.current?.token();
      if (!captchaToken) {
        setFailure({ code: 'CAPTCHA_UNAVAILABLE', message: CHECK_FAILED_TEXT });
        focusThenAnnounce(null, CHECK_FAILED_TEXT);
        return;
      }
      const outcome = await callAction(() =>
        requestPasswordResetAction({ email, captchaToken, callbackUrl }),
      );
      if (outcome.ok) {
        setSentTo(outcome.data.email);
        return;
      }
      setFailure(outcome.error);
      focusThenAnnounce(
        outcome.error.code === 'INVALID_INPUT' ? emailId : null,
        outcome.error.code === 'INVALID_INPUT' ? undefined : outcome.error.message,
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
      setChallenge(false);
    }
  }

  const backToSignIn = (
    <Button
      asChild
      variant="ghost"
      size="touch"
      className="text-brand-strong hover:bg-brand-soft hover:text-brand-strong"
    >
      <Link href={authPageHref('/sign-in', callbackUrl)}>
        <ArrowLeft className="size-4" aria-hidden />
        Back to sign in
      </Link>
    </Button>
  );

  if (sentTo) {
    return (
      <CheckInboxPanel
        title="Check your email"
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              size="touch"
              className="border-brand-strong bg-transparent text-brand-strong hover:bg-brand-soft hover:text-brand-strong"
              onClick={() => {
                setSentTo(null);
                setTimeout(() => {
                  const input = document.getElementById(emailId);
                  if (input instanceof HTMLInputElement) {
                    input.focus();
                    input.select();
                  }
                }, 0);
              }}
            >
              Use a different email
            </Button>
            {backToSignIn}
          </>
        }
      >
        If there&apos;s a Foodz account for {sentTo}, we&apos;ve sent it a link to reset the
        password. The link works for 30 minutes. Check your spam folder too.
      </CheckInboxPanel>
    );
  }

  const captchaFailed =
    failure?.code === 'CAPTCHA_UNAVAILABLE' || failure?.code === 'CAPTCHA_FAILED';

  return (
    <div>
      {children}
      <div className="mt-6 md:mt-10 xl:mt-12">
        <noscript>
          <FormAlert variant="info" className="mb-6">
            Turn on JavaScript to reset your password. We use it for a quick security check.
          </FormAlert>
        </noscript>
        {failure && failure.code !== 'INVALID_INPUT' ? (
          <FormAlert
            variant="error"
            className="mb-6"
            action={
              captchaFailed ? (
                <Button
                  type="button"
                  variant="outline"
                  size="touch"
                  className="bg-white"
                  onClick={() => void submitChecked(form)}
                >
                  Try again
                </Button>
              ) : null
            }
          >
            {failure.message}
          </FormAlert>
        ) : null}
        <form
          ref={formRef}
          noValidate
          aria-label="Reset your password"
          onSubmit={(event) => {
            event.preventDefault();
            void submitChecked(form);
          }}
        >
          <form.Field name="email">
            {(field) => {
              const error = visibleError(field.state.meta, submitted, fieldError(failure, 'email'));
              return (
                <FieldShell id={emailId} label="Email" error={error}>
                  {(control) => (
                    <Input
                      {...control}
                      name="email"
                      type="email"
                      autoComplete="username"
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
          <SubmitButton
            pending={busy}
            pendingLabel={challenge ? 'Checking…' : 'Sending…'}
            className="mt-8 w-full uppercase"
          >
            {submitLabel}
          </SubmitButton>
          <Turnstile ref={turnstileRef} onChallenge={setChallenge} />
        </form>
        <div className="mt-4">{backToSignIn}</div>
      </div>
    </div>
  );
}
