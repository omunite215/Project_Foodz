'use client';

import { revalidateLogic, useForm, useStore } from '@tanstack/react-form';
import { useRouter } from 'next/navigation';
import { useId, useRef, useState } from 'react';
import { z } from 'zod';
import { changePasswordAction, requestPasswordResetAction } from '@/server/modules/auth/actions';
import { CAPTCHA_ACTIONS, newPasswordSchema } from '@/server/modules/auth/schema';
import {
  blurField,
  FieldShell,
  NewPasswordHint,
  visibleError,
} from '@/components/forms/field-shell';
import { FormAlert } from '@/components/forms/form-alert';
import { focusFirstInvalid, focusThenAnnounce, submitChecked } from '@/components/forms/feedback';
import { PasswordInput } from '@/components/forms/password-input';
import { StatusLine } from '@/components/forms/status-line';
import { SubmitButton } from '@/components/forms/submit-button';
import { CHECK_FAILED_TEXT, Turnstile, type TurnstileHandle } from '@/components/forms/turnstile';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible';
import { type ActionFailure, callAction, fieldError, withoutFieldError } from '@/lib/action-result';
import { announce } from '@/lib/announce';
import { useAccount } from './account-context';
import { LockedLine, SettingsCard } from './settings-card';

const fields = z.object({
  currentPassword: z.string().min(1, 'Enter your current password.'),
  newPassword: newPasswordSchema,
});

const CHANGED = "Password changed. You've been signed out on your other devices.";

/** Google-only accounts get a link to set a password instead (S5.5). */
function SetPassword() {
  const account = useAccount();
  const turnstileRef = useRef<TurnstileHandle>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-body-4 text-neutral-3">You sign in with Google.</p>
        <SubmitButton
          type="button"
          pending={busy}
          pendingLabel="Sending…"
          variant="outline"
          className="border-brand-strong bg-white text-brand-strong hover:bg-brand-soft hover:text-brand-strong"
          onClick={() => {
            void (async () => {
              setBusy(true);
              const captchaToken = await turnstileRef.current?.token();
              const outcome = captchaToken
                ? await callAction(() =>
                    requestPasswordResetAction({
                      email: account.email,
                      captchaToken,
                      callbackUrl: '/account/security',
                    }),
                  )
                : ({
                    ok: false,
                    error: { code: 'CAPTCHA_UNAVAILABLE', message: CHECK_FAILED_TEXT },
                  } as const);
              setBusy(false);
              const next = outcome.ok
                ? {
                    tone: 'success' as const,
                    text: `We sent a link to ${account.email} to set a password. It works for 30 minutes.`,
                  }
                : { tone: 'error' as const, text: outcome.error.message };
              setStatus(next);
              announce(next.text);
            })();
          }}
        >
          Set a password
        </SubmitButton>
      </div>
      <Turnstile ref={turnstileRef} action={CAPTCHA_ACTIONS.reset} />
      <StatusLine tone={status?.tone}>{status?.text}</StatusLine>
    </div>
  );
}

/** Change password (S5.4): current and new password; this device stays signed in. */
function ChangePassword({ onChanged }: { onChanged: () => void }) {
  const id = useId();
  const ids = { current: `${id}-current`, next: `${id}-new` };
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [changed, setChanged] = useState(false);
  const busyRef = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const changedRef = useRef<HTMLDivElement>(null);

  const form = useForm({
    defaultValues: { currentPassword: '', newPassword: '' },
    validationLogic: revalidateLogic({ mode: 'blur', modeAfterSubmission: 'change' }),
    validators: { onDynamic: fields },
    onSubmitInvalid: () => focusFirstInvalid(formRef.current),
    onSubmit: async ({ value, formApi }) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      setFailure(null);
      const outcome = await callAction(() => changePasswordAction(value));
      busyRef.current = false;
      setBusy(false);
      if (outcome.ok) {
        formApi.reset();
        setOpen(false);
        setChanged(true);
        onChanged();
        requestAnimationFrame(() => changedRef.current?.focus());
        announce(CHANGED);
        return;
      }
      const error = outcome.error;
      setFailure(error);
      if (error.code === 'INVALID_INPUT') {
        focusThenAnnounce(fieldError(error, 'currentPassword') ? ids.current : ids.next);
        return;
      }
      focusThenAnnounce(null, error.message);
    },
  }); // Re-render the fields when a submit is tried, so every error shows.
  const submitted = useStore(form.store, (formState) => formState.submissionAttempts > 0);

  const close = () => {
    form.reset();
    setFailure(null);
    setOpen(false);
    // "Change password" is drawn again only once the form has closed.
    requestAnimationFrame(() => toggleRef.current?.focus());
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-body-4 text-neutral-3">Use a password only you know.</p>
        {open ? null : (
          <Button
            ref={toggleRef}
            type="button"
            variant="outline"
            size="touch"
            aria-expanded={false}
            onClick={() => {
              setChanged(false);
              setOpen(true);
              setTimeout(() => document.getElementById(ids.current)?.focus(), 0);
            }}
            className="border-brand-strong bg-white text-brand-strong hover:bg-brand-soft hover:text-brand-strong"
          >
            Change password
          </Button>
        )}
      </div>
      {changed ? (
        <div ref={changedRef} tabIndex={-1} className="mt-4 focus:outline-none">
          <FormAlert variant="success">{CHANGED}</FormAlert>
        </div>
      ) : null}
      <CollapsibleContent>
        <form
          ref={formRef}
          noValidate
          method="post"
          aria-label="Change password"
          className="mt-6 max-w-[524px]"
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
          <div className="space-y-6">
            <form.Field name="currentPassword">
              {(field) => {
                const error = visibleError(
                  field.state.meta,
                  submitted,
                  fieldError(failure, 'currentPassword'),
                );
                return (
                  <FieldShell id={ids.current} label="Current password" error={error}>
                    {(control) => (
                      <PasswordInput
                        {...control}
                        name="currentPassword"
                        value={field.state.value}
                        onChange={(event) => {
                          field.handleChange(event.target.value);
                          setFailure((current) => withoutFieldError(current, 'currentPassword'));
                          if (error) void form.validate('blur');
                        }}
                        onBlur={blurField(field.handleBlur)}
                      />
                    )}
                  </FieldShell>
                );
              }}
            </form.Field>
            <form.Field name="newPassword">
              {(field) => {
                const error = visibleError(
                  field.state.meta,
                  submitted,
                  fieldError(failure, 'newPassword'),
                );
                return (
                  <FieldShell
                    id={ids.next}
                    label="New password"
                    hint={<NewPasswordHint length={field.state.value.length} />}
                    error={error}
                  >
                    {(control) => (
                      <PasswordInput
                        {...control}
                        isNew
                        name="newPassword"
                        value={field.state.value}
                        onChange={(event) => {
                          field.handleChange(event.target.value);
                          setFailure((current) => withoutFieldError(current, 'newPassword'));
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
          <div className="mt-8 flex flex-wrap gap-3">
            <SubmitButton pending={busy} pendingLabel="Saving…" className="uppercase">
              Save new password
            </SubmitButton>
            <Button
              type="button"
              variant="ghost"
              size="touch"
              onClick={close}
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

/** The Password card on /account/security (design 4.3). */
export function PasswordCard() {
  const account = useAccount();
  const router = useRouter();
  return (
    <SettingsCard id="password" title="Password">
      {account.isDemo ? (
        <LockedLine>The demo account&apos;s password can&apos;t be changed.</LockedLine>
      ) : account.hasPassword ? (
        <ChangePassword onChanged={() => router.refresh()} />
      ) : (
        <SetPassword />
      )}
    </SettingsCard>
  );
}
