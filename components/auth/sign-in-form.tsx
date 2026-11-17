'use client';

import { revalidateLogic, useForm, useStore } from '@tanstack/react-form';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { z } from 'zod';
import { signInAction } from '@/server/modules/auth/actions';
import { emailSchema } from '@/server/modules/auth/schema';
import { blurField, FieldShell, visibleError } from '@/components/forms/field-shell';
import { FormAlert } from '@/components/forms/form-alert';
import {
  focusFirstInvalid,
  focusThenAnnounce,
  MessageWithLink,
  submitChecked,
} from '@/components/forms/feedback';
import { GoogleButton, OrDivider } from '@/components/forms/google-button';
import { PasswordInput } from '@/components/forms/password-input';
import { SubmitButton } from '@/components/forms/submit-button';
import { CHECK_FAILED_TEXT, Turnstile, type TurnstileHandle } from '@/components/forms/turnstile';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { type ActionFailure, callAction, fieldError } from '@/lib/action-result';
import { announce } from '@/lib/announce';
import { postAuthEvent } from '@/lib/auth-channel';
import { authPageHref, returnRoute } from '@/lib/auth-links';
import { forgetEmail, recalledEmail, rememberEmail } from '@/lib/email-handoff';
import { AuthTitle } from './auth-title';

const fields = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password.'),
});

type Notice = 'password-changed' | 'session-ended';

const NOTICES: Record<Notice, { variant: 'success' | 'info'; text: string }> = {
  'password-changed': {
    variant: 'success',
    text: 'Password changed. Sign in with your new password.',
  },
  'session-ended': {
    variant: 'info',
    text: "You've been signed out. Sign in again to save your changes.",
  },
};

const GOOGLE_ERRORS: Record<string, string> = {
  account_not_linked:
    "This email already has a Foodz account that hasn't been confirmed, so we can't connect Google to it. Sign in with your password, or reset it, then try Google again.",
  TWO_FACTOR_ACCOUNT:
    'This account signs in with a password and a code. Sign in with your password.',
};

const GOOGLE_FAILED = "We couldn't reach Google. Check your connection, then try again.";

/**
 * Sign in (S2, design 3.2). Wrong password and unknown email look the same. After one failure
 * Turnstile is ready; when the server asks for it, the check runs and the same details are sent
 * again. A rate limit gives the real wait and blocks the button until it ends.
 */
export function SignInForm({
  callbackUrl,
  notice,
  googleError,
  google,
}: {
  callbackUrl: string;
  notice: Notice | null;
  googleError: string | null;
  google: boolean;
}) {
  const router = useRouter();
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const turnstileRef = useRef<TurnstileHandle>(null);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [captcha, setCaptcha] = useState(false);
  const [challenge, setChallenge] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(
    googleError ? { code: 'GOOGLE', message: GOOGLE_ERRORS[googleError] ?? GOOGLE_FAILED } : null,
  );
  const [blocked, setBlocked] = useState(false);
  const alertId = `${id}-alert`;
  const emailId = `${id}-email`;
  const passwordId = `${id}-password`;

  const form = useForm({
    defaultValues: { email: '', password: '' },
    validationLogic: revalidateLogic({ mode: 'blur', modeAfterSubmission: 'change' }),
    validators: { onDynamic: fields },
    onSubmitInvalid: () => focusFirstInvalid(formRef.current),
    onSubmit: ({ value }) => submit(value),
  }); // Re-render the fields when a submit is tried, so every error shows.
  const submitted = useStore(form.store, (formState) => formState.submissionAttempts > 0);

  // The email typed on another sign-in page (design 3.8).
  useEffect(() => {
    const email = recalledEmail();
    if (email && !form.getFieldValue('email')) {
      form.setFieldValue('email', email, { dontUpdateMeta: true });
    }
  }, [form]);

  // After a rate limit, the button comes back by itself once the wait is over (S2.8).
  useEffect(() => {
    const seconds = failure?.code === 'RATE_LIMITED' ? failure.retryAfterSeconds : undefined;
    if (!seconds) return undefined;
    const timer = setTimeout(() => {
      setBlocked(false);
      announce('You can try signing in again.');
    }, seconds * 1000);
    return () => clearTimeout(timer);
  }, [failure]);

  const toForgot = () => rememberEmail(form.getFieldValue('email'));

  function fail(next: ActionFailure, focus: string | null = null) {
    setFailure(next);
    focusThenAnnounce(focus, next.message);
  }

  async function submit(value: { email: string; password: string }) {
    if (busyRef.current || blocked) return;
    busyRef.current = true;
    setBusy(true);
    setFailure(null);
    rememberEmail(value.email);
    try {
      await attempt(value, captcha);
    } finally {
      busyRef.current = false;
      setBusy(false);
      setChallenge(false);
    }
  }

  async function attempt(value: { email: string; password: string }, withCaptcha: boolean) {
    let captchaToken: string | undefined;
    if (withCaptcha) {
      const token = await turnstileRef.current?.token();
      if (!token) {
        fail({ code: 'CAPTCHA_UNAVAILABLE', message: CHECK_FAILED_TEXT });
        return;
      }
      captchaToken = token;
    }

    const outcome = await callAction(() =>
      signInAction({ email: value.email, password: value.password, callbackUrl, captchaToken }),
    );
    if (outcome.ok) {
      if (outcome.data.status === 'two-factor') {
        // The code step is an auth page, so it is built here rather than taken as a return path.
        router.replace(authPageHref('/sign-in/two-factor', callbackUrl));
        return;
      }
      forgetEmail();
      postAuthEvent('signed-in');
      router.replace(returnRoute(outcome.data.redirectTo));
      focusThenAnnounce('main', 'Signed in');
      return;
    }

    const error = outcome.error;
    switch (error.code) {
      case 'CAPTCHA_REQUIRED':
        // Not counted by the server: run the check and send the same details again.
        if (!withCaptcha) {
          flushSync(() => setCaptcha(true));
          await attempt(value, true);
          return;
        }
        fail({ code: 'CAPTCHA_UNAVAILABLE', message: CHECK_FAILED_TEXT });
        return;
      case 'INVALID_CREDENTIALS':
      case 'ACCOUNT_SUSPENDED':
        form.setFieldValue('password', '', { dontUpdateMeta: true });
        setCaptcha(true);
        fail(error, passwordId);
        return;
      case 'RATE_LIMITED':
        setBlocked(true);
        fail(error);
        return;
      case 'INVALID_INPUT':
        setFailure(error);
        focusThenAnnounce(fieldError(error, 'email') ? emailId : passwordId);
        return;
      default:
        fail(error);
    }
  }

  const failureBody = (() => {
    if (!failure) return null;
    if (failure.code === 'INVALID_CREDENTIALS' || failure.code === 'RATE_LIMITED') {
      return (
        <MessageWithLink
          text={failure.message}
          phrase="reset your password"
          href="/forgot-password"
          onNavigate={toForgot}
        />
      );
    }
    if (failure.code === 'ACCOUNT_SUSPENDED') {
      return <MessageWithLink text={failure.message} phrase="Contact support" href="/contact" />;
    }
    return failure.message;
  })();
  const captchaFailed =
    failure?.code === 'CAPTCHA_UNAVAILABLE' || failure?.code === 'CAPTCHA_FAILED';

  return (
    <div>
      <AuthTitle
        title="Sign in"
        subtitle="Welcome back. Sign in to order and use your saved addresses."
      />
      <div className="mt-6 md:mt-10 xl:mt-12">
        {notice ? (
          <FormAlert variant={NOTICES[notice].variant} className="mb-6">
            {NOTICES[notice].text}
          </FormAlert>
        ) : null}
        {google ? (
          <>
            <GoogleButton
              callbackUrl={callbackUrl}
              errorPage={authPageHref('/sign-in', callbackUrl)}
              onFailure={() => fail({ code: 'GOOGLE', message: GOOGLE_FAILED })}
            />
            <OrDivider />
          </>
        ) : null}
        {failure && failure.code !== 'INVALID_INPUT' ? (
          <FormAlert
            id={alertId}
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
            {failureBody}
          </FormAlert>
        ) : null}

        <form
          ref={formRef}
          noValidate
          aria-label="Sign in"
          onSubmit={(event) => {
            event.preventDefault();
            void submitChecked(form);
          }}
        >
          <div className="space-y-6">
            <form.Field name="email">
              {(field) => {
                const error = visibleError(
                  field.state.meta,
                  submitted,
                  fieldError(failure, 'email'),
                );
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
            <form.Field name="password">
              {(field) => {
                const error = visibleError(
                  field.state.meta,
                  submitted,
                  fieldError(failure, 'password'),
                );
                return (
                  <FieldShell
                    id={passwordId}
                    label="Password"
                    error={error}
                    more={
                      <Link
                        href="/forgot-password"
                        onClick={toForgot}
                        className="mt-2 inline-flex h-11 items-center text-button-2 font-medium text-brand-strong underline-offset-4 hover:underline"
                      >
                        Forgot password?
                      </Link>
                    }
                  >
                    {(control) => (
                      <PasswordInput
                        {...control}
                        name="password"
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
          </div>

          <SubmitButton
            pending={busy}
            pendingLabel={challenge ? 'Checking…' : 'Signing in…'}
            blocked={blocked}
            aria-describedby={blocked ? alertId : undefined}
            className="mt-8 w-full uppercase"
          >
            Sign in
          </SubmitButton>
          {captcha ? <Turnstile ref={turnstileRef} onChallenge={setChallenge} /> : null}
        </form>

        <p className="mt-6 text-center text-body-4 text-neutral-3">
          New to Foodz?{' '}
          <Link
            href={authPageHref('/sign-up', callbackUrl)}
            onClick={() => rememberEmail(form.getFieldValue('email'))}
            className="inline-flex h-11 items-center font-medium text-brand-strong underline-offset-4 hover:underline"
          >
            Create an account
          </Link>
        </p>
      </div>
    </div>
  );
}
