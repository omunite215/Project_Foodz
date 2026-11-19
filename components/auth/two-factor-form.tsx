'use client';

import { revalidateLogic, useForm, useStore } from '@tanstack/react-form';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useRef, useState } from 'react';
import { z } from 'zod';
import { verifyTwoFactorAction } from '@/server/modules/auth/actions';
import { CheckboxRow } from '@/components/forms/choice-chips';
import { blurField, FieldShell, visibleError } from '@/components/forms/field-shell';
import { FormAlert } from '@/components/forms/form-alert';
import {
  FadeIn,
  focusFirstInvalid,
  focusThenAnnounce,
  submitChecked,
} from '@/components/forms/feedback';
import { SubmitButton } from '@/components/forms/submit-button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { type ActionFailure, callAction, fieldError } from '@/lib/action-result';
import { postAuthEvent } from '@/lib/auth-channel';
import { authPageHref, returnRoute } from '@/lib/auth-links';
import { forgetEmail } from '@/lib/email-handoff';
import { cn } from '@/lib/utils';
import { AuthTitle } from './auth-title';

type Method = 'totp' | 'backup';

const codeSchema = z
  .object({
    method: z.enum(['totp', 'backup']),
    code: z.string(),
    trustDevice: z.boolean(),
  })
  .superRefine((value, ctx) => {
    const code = value.method === 'totp' ? value.code.replace(/[\s-]/g, '') : value.code.trim();
    if (value.method === 'totp' && !/^\d{6}$/.test(code)) {
      ctx.addIssue({
        code: 'custom',
        path: ['code'],
        message: 'Enter the 6 digits from your app.',
      });
    }
    if (value.method === 'backup' && !/^[A-Za-z0-9-]{4,32}$/.test(code)) {
      ctx.addIssue({ code: 'custom', path: ['code'], message: 'Enter one of your backup codes.' });
    }
  });

const TIMED_OUT = 'This sign-in timed out. Please start again.';

/** "Start again": back to a fresh sign-in form, with the email kept for it (S2.9). */
function StartAgain({
  callbackUrl,
  variant,
}: {
  callbackUrl: string;
  variant: 'outline' | 'ghost';
}) {
  return (
    <Button
      asChild
      variant={variant}
      size="touch"
      className={cn(variant === 'outline' && 'bg-white')}
    >
      <Link href={authPageHref('/sign-in', callbackUrl)}>Start again</Link>
    </Button>
  );
}

/** The time-out state: no field, no Continue (design 3.4). */
export function TwoFactorTimedOut({ callbackUrl }: { callbackUrl: string }) {
  return (
    <div>
      <AuthTitle title="Enter your code" />
      <FormAlert
        variant="error"
        className="mt-6 md:mt-10 xl:mt-12"
        action={<StartAgain callbackUrl={callbackUrl} variant="outline" />}
      >
        {TIMED_OUT}
      </FormAlert>
    </div>
  );
}

/**
 * The second step for accounts with two-factor on (S2.9, design 3.4). One wide numeric field
 * (paste works; "123 456" is fine); a backup code instead; "Don't ask again" for customers only.
 * Nothing about the account is shown until the code is right.
 */
export function TwoFactorForm({
  callbackUrl,
  canTrustDevice,
}: {
  callbackUrl: string;
  canTrustDevice: boolean;
}) {
  const router = useRouter();
  const id = useId();
  const codeId = `${id}-code`;
  const trustId = `${id}-trust`;
  const reasonId = `${id}-reason`;
  const formRef = useRef<HTMLFormElement>(null);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [state, setState] = useState<'active' | 'locked' | 'expired'>('active');

  const form = useForm({
    defaultValues: { method: 'totp' as Method, code: '', trustDevice: false },
    validationLogic: revalidateLogic({ mode: 'submit', modeAfterSubmission: 'change' }),
    validators: { onDynamic: codeSchema },
    onSubmitInvalid: () => focusFirstInvalid(formRef.current),
    onSubmit: ({ value }) => submit(value),
  }); // Re-render the fields when a submit is tried, so every error shows.
  const submitted = useStore(form.store, (formState) => formState.submissionAttempts > 0);

  async function submit(value: { method: Method; code: string; trustDevice: boolean }) {
    if (busyRef.current || state !== 'active') return;
    busyRef.current = true;
    setBusy(true);
    setFailure(null);
    try {
      const outcome = await callAction(() =>
        verifyTwoFactorAction({
          method: value.method,
          code: value.code,
          trustDevice: canTrustDevice && value.trustDevice,
          callbackUrl,
        }),
      );
      if (outcome.ok) {
        forgetEmail();
        postAuthEvent('signed-in');
        router.replace(returnRoute(outcome.data.redirectTo));
        focusThenAnnounce('main', 'Signed in');
        return;
      }
      const error = outcome.error;
      setFailure(error);
      if (error.code === 'INVALID_INPUT') {
        // The code is kept but selected, so typing replaces it.
        focusThenAnnounce(codeId);
        return;
      }
      if (error.code === 'RATE_LIMITED') setState('locked');
      if (error.code === 'SIGN_IN_EXPIRED') setState('expired');
      focusThenAnnounce(null, error.message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  if (state === 'expired') {
    return (
      <FadeIn>
        <AuthTitle title="Enter your code" />
        <FormAlert
          variant="error"
          className="mt-6 md:mt-10 xl:mt-12"
          action={<StartAgain callbackUrl={callbackUrl} variant="outline" />}
        >
          {failure?.message ?? TIMED_OUT}
        </FormAlert>
      </FadeIn>
    );
  }

  const locked = state === 'locked';

  return (
    <div>
      <AuthTitle
        title="Enter your code"
        subtitle="Enter the 6-digit code from your authenticator app."
      />
      <div className="mt-6 md:mt-10 xl:mt-12">
        {failure && failure.code !== 'INVALID_INPUT' ? (
          <FormAlert
            id={reasonId}
            variant="error"
            className="mb-6"
            action={locked ? <StartAgain callbackUrl={callbackUrl} variant="outline" /> : null}
          >
            {failure.message}
          </FormAlert>
        ) : null}
        <form
          ref={formRef}
          noValidate
          method="post"
          aria-label="Enter your code"
          onSubmit={(event) => {
            event.preventDefault();
            void submitChecked(form);
          }}
        >
          <form.Subscribe selector={(s) => s.values.method}>
            {(method) => (
              <form.Field name="code">
                {(field) => {
                  const error = visibleError(
                    field.state.meta,
                    submitted,
                    fieldError(failure, 'code'),
                  );
                  const totp = method === 'totp';
                  return (
                    <FieldShell
                      id={codeId}
                      label={totp ? '6-digit code' : 'Backup code'}
                      hint={totp ? undefined : 'Each backup code works once.'}
                      error={error}
                      more={
                        <Button
                          type="button"
                          variant="ghost"
                          size="touch"
                          className="mt-2 -ml-4 text-button-2 text-brand-strong hover:bg-brand-soft hover:text-brand-strong"
                          onClick={() => {
                            form.setFieldValue('method', totp ? 'backup' : 'totp');
                            form.setFieldValue('code', '', { dontUpdateMeta: true });
                            setFailure(null);
                            focusThenAnnounce(codeId);
                          }}
                        >
                          {totp
                            ? 'Use a backup code instead'
                            : 'Use your authenticator app instead'}
                        </Button>
                      }
                    >
                      {(control) => (
                        <Input
                          {...control}
                          key={method}
                          name="code"
                          data-select-on-focus=""
                          disabled={locked}
                          aria-describedby={
                            [control['aria-describedby'], locked ? reasonId : undefined]
                              .filter(Boolean)
                              .join(' ') || undefined
                          }
                          {...(totp
                            ? {
                                autoComplete: 'one-time-code',
                                inputMode: 'numeric' as const,
                                maxLength: 9,
                                className:
                                  'h-14 text-center text-title-2 font-medium tracking-[0.35em] tabular-nums md:max-w-[320px]',
                              }
                            : {
                                autoComplete: 'off',
                                autoCapitalize: 'none',
                                spellCheck: false,
                                maxLength: 32,
                              })}
                          value={field.state.value}
                          onChange={(event) => {
                            field.handleChange(event.target.value);
                            if (failure?.code === 'INVALID_INPUT') setFailure(null);
                          }}
                          onBlur={blurField(field.handleBlur)}
                        />
                      )}
                    </FieldShell>
                  );
                }}
              </form.Field>
            )}
          </form.Subscribe>

          {canTrustDevice ? (
            <form.Field name="trustDevice">
              {(field) => (
                <div className="mt-4">
                  <CheckboxRow
                    id={trustId}
                    label="Don't ask again on this device for 30 days"
                    checked={field.state.value}
                    disabled={locked}
                    onChange={(checked) => field.handleChange(checked)}
                  />
                </div>
              )}
            </form.Field>
          ) : null}

          <SubmitButton
            pending={busy}
            pendingLabel="Checking…"
            blocked={locked}
            aria-describedby={locked ? reasonId : undefined}
            className="mt-8 w-full uppercase"
          >
            Continue
          </SubmitButton>
          <Button
            asChild
            variant="ghost"
            size="touch"
            className="mt-3 w-full text-neutral-2 hover:bg-neutral-7"
          >
            <Link href={authPageHref('/sign-in', callbackUrl)} replace>
              Cancel
            </Link>
          </Button>
        </form>
      </div>
    </div>
  );
}
