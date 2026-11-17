'use client';

import { revalidateLogic, useForm, useStore } from '@tanstack/react-form';
import { ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { signUpAction } from '@/server/modules/auth/actions';
import { signUpInput } from '@/server/modules/auth/schema';
import { firstNameOf } from '@/server/modules/account/schema';
import {
  blurField,
  FieldShell,
  NewPasswordHint,
  visibleError,
} from '@/components/forms/field-shell';
import { FormAlert } from '@/components/forms/form-alert';
import { focusFirstInvalid, focusThenAnnounce, submitChecked } from '@/components/forms/feedback';
import { GoogleButton, OrDivider } from '@/components/forms/google-button';
import { PasswordInput } from '@/components/forms/password-input';
import { SubmitButton } from '@/components/forms/submit-button';
import { CHECK_FAILED_TEXT, Turnstile, type TurnstileHandle } from '@/components/forms/turnstile';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { type ActionFailure, callAction, fieldError } from '@/lib/action-result';
import { postAuthEvent, requestNoticeFocus } from '@/lib/auth-channel';
import { authPageHref, returnRoute } from '@/lib/auth-links';
import { recalledEmail, rememberEmail } from '@/lib/email-handoff';
import { suggestEmail } from '@/lib/email-typo';
import { AuthTitle } from './auth-title';
import { CheckInboxPanel } from './check-inbox-panel';

const fields = signUpInput.pick({ name: true, email: true, password: true });

const FIELD_ORDER = ['name', 'email', 'password'] as const;

function TermsLink({ href, children }: { href: '/terms' | '/privacy'; children: string }) {
  return (
    <Link
      href={href}
      target="_blank"
      rel="noopener"
      className="inline-flex items-center gap-0.5 font-medium text-brand-strong underline underline-offset-4"
    >
      {children}
      <ExternalLink className="size-3.5" aria-hidden />
      <span className="sr-only"> (opens in a new tab)</span>
    </Link>
  );
}

/**
 * Create an account (S1, design 3.3): name, email and a password, nothing else. Signs in at once
 * (U1) and returns to where the person was, cart untouched. An email that already has an account
 * gets the same welcome words, without signing in (S1.5).
 */
export function SignUpForm({ callbackUrl, google }: { callbackUrl: string; google: boolean }) {
  const router = useRouter();
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const turnstileRef = useRef<TurnstileHandle>(null);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [challenge, setChallenge] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [sentTo, setSentTo] = useState<{ firstName: string; email: string } | null>(null);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const ids = {
    name: `${id}-name`,
    email: `${id}-email`,
    password: `${id}-password`,
  };

  const form = useForm({
    defaultValues: { name: '', email: '', password: '' },
    validationLogic: revalidateLogic({ mode: 'blur', modeAfterSubmission: 'change' }),
    validators: { onDynamic: fields },
    onSubmitInvalid: () => focusFirstInvalid(formRef.current),
    onSubmit: ({ value }) => submit(value),
  }); // Re-render the fields when a submit is tried, so every error shows.
  const submitted = useStore(form.store, (formState) => formState.submissionAttempts > 0);

  useEffect(() => {
    const email = recalledEmail();
    if (email && !form.getFieldValue('email')) {
      form.setFieldValue('email', email, { dontUpdateMeta: true });
    }
  }, [form]);

  function fail(next: ActionFailure, focus: string | null = null) {
    setFailure(next);
    focusThenAnnounce(focus, next.message);
  }

  async function submit(value: { name: string; email: string; password: string }) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setFailure(null);
    rememberEmail(value.email);
    try {
      const captchaToken = await turnstileRef.current?.token();
      if (!captchaToken) {
        fail({ code: 'CAPTCHA_UNAVAILABLE', message: CHECK_FAILED_TEXT });
        return;
      }
      const outcome = await callAction(() => signUpAction({ ...value, captchaToken, callbackUrl }));
      if (outcome.ok) {
        if (outcome.data.signedIn) {
          postAuthEvent('signed-in');
          requestNoticeFocus();
          router.replace(returnRoute(outcome.data.redirectTo));
        } else {
          setSentTo({ firstName: firstNameOf(value.name), email: outcome.data.email });
        }
        return;
      }
      const error = outcome.error;
      if (error.code === 'INVALID_INPUT') {
        setFailure(error);
        const first = FIELD_ORDER.find((name) => fieldError(error, name));
        focusThenAnnounce(first ? ids[first] : null);
        return;
      }
      fail(error);
    } finally {
      busyRef.current = false;
      setBusy(false);
      setChallenge(false);
    }
  }

  if (sentTo) {
    return (
      <CheckInboxPanel
        title="Check your inbox"
        actions={
          <Button
            type="button"
            variant="ghost"
            size="touch"
            className="text-brand-strong hover:bg-brand-soft hover:text-brand-strong"
            onClick={() => {
              setSentTo(null);
              setTimeout(() => {
                const email = document.getElementById(ids.email);
                if (email instanceof HTMLInputElement) {
                  email.focus();
                  email.select();
                }
              }, 0);
            }}
          >
            Wrong address? Change it
          </Button>
        }
      >
        Welcome, {sentTo.firstName}. We sent a link to {sentTo.email} to confirm your email.
        You&apos;ll need it before your first order.
      </CheckInboxPanel>
    );
  }

  const captchaFailed =
    failure?.code === 'CAPTCHA_UNAVAILABLE' || failure?.code === 'CAPTCHA_FAILED';

  return (
    <div>
      <AuthTitle
        title="Create an account"
        subtitle="It takes a minute: just your name, email and a password."
      />
      <div className="mt-6 md:mt-10 xl:mt-12">
        {google ? (
          <>
            <GoogleButton
              callbackUrl={callbackUrl}
              errorPage={authPageHref('/sign-up', callbackUrl)}
              onFailure={() =>
                fail({
                  code: 'GOOGLE',
                  message: "We couldn't reach Google. Check your connection, then try again.",
                })
              }
            />
            <OrDivider />
          </>
        ) : null}
        <noscript>
          <FormAlert variant="info" className="mb-6">
            Turn on JavaScript to create an account. We use it for a quick security check.
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
          aria-label="Create an account"
          onSubmit={(event) => {
            event.preventDefault();
            void submitChecked(form);
          }}
        >
          <div className="space-y-6">
            <form.Field name="name">
              {(field) => {
                const error = visibleError(
                  field.state.meta,
                  submitted,
                  fieldError(failure, 'name'),
                );
                return (
                  <FieldShell
                    id={ids.name}
                    label="Name"
                    hint="We put it on your orders. Couriers see only your first name."
                    error={error}
                  >
                    {(control) => (
                      <Input
                        {...control}
                        name="name"
                        autoComplete="name"
                        autoCapitalize="words"
                        maxLength={60}
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
            <form.Field name="email">
              {(field) => {
                const error = visibleError(
                  field.state.meta,
                  submitted,
                  fieldError(failure, 'email'),
                );
                return (
                  <FieldShell
                    id={ids.email}
                    label="Email"
                    error={error}
                    more={
                      suggestion && !error ? (
                        <div className="mt-2 flex flex-wrap items-center gap-x-2 text-body-5 text-neutral-3">
                          <span>Did you mean {suggestion}?</span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="touch"
                            className="-ml-2 text-brand-strong hover:bg-brand-soft hover:text-brand-strong"
                            onClick={() => {
                              field.handleChange(suggestion);
                              setSuggestion(null);
                              document.getElementById(ids.email)?.focus();
                            }}
                          >
                            Use {suggestion}
                          </Button>
                        </div>
                      ) : null
                    }
                  >
                    {(control) => (
                      <Input
                        {...control}
                        name="email"
                        type="email"
                        autoComplete="email"
                        inputMode="email"
                        autoCapitalize="none"
                        spellCheck={false}
                        value={field.state.value}
                        onChange={(event) => {
                          field.handleChange(event.target.value);
                          setSuggestion(null);
                          if (error) void form.validate('blur');
                        }}
                        onBlur={(event) => {
                          blurField(field.handleBlur)(event);
                          setSuggestion(suggestEmail(event.target.value));
                        }}
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
                    id={ids.password}
                    label="Password"
                    hint={<NewPasswordHint length={field.state.value.length} />}
                    error={error}
                  >
                    {(control) => (
                      <PasswordInput
                        {...control}
                        isNew
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

          <p className="mt-6 text-body-5 text-neutral-3">
            By creating an account, you agree to our <TermsLink href="/terms">Terms</TermsLink> and{' '}
            <TermsLink href="/privacy">Privacy Policy</TermsLink>.
          </p>

          <SubmitButton
            pending={busy}
            pendingLabel={challenge ? 'Checking…' : 'Creating account…'}
            className="mt-8 w-full uppercase"
          >
            Create account
          </SubmitButton>
          <Turnstile ref={turnstileRef} onChallenge={setChallenge} />
        </form>

        <p className="mt-6 text-center text-body-4 text-neutral-3">
          Already have an account?{' '}
          <Link
            href={authPageHref('/sign-in', callbackUrl)}
            onClick={() => rememberEmail(form.getFieldValue('email'))}
            className="inline-flex h-11 items-center font-medium text-brand-strong underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
