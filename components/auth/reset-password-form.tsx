'use client';

import { revalidateLogic, useForm, useStore } from '@tanstack/react-form';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import { useId, useRef, useState } from 'react';
import { z } from 'zod';
import { resetPasswordAction } from '@/server/modules/auth/actions';
import { newPasswordSchema } from '@/server/modules/auth/schema';
import {
  blurField,
  FieldShell,
  NewPasswordHint,
  visibleError,
} from '@/components/forms/field-shell';
import { FormAlert } from '@/components/forms/form-alert';
import { focusFirstInvalid, focusThenAnnounce, submitChecked } from '@/components/forms/feedback';
import { PasswordInput } from '@/components/forms/password-input';
import { SubmitButton } from '@/components/forms/submit-button';
import { type ActionFailure, callAction, fieldError } from '@/lib/action-result';
import { rememberEmail } from '@/lib/email-handoff';
import { safeRedirectPath } from '@/lib/redirect';
import { AuthTitle } from './auth-title';

const fields = z.object({ newPassword: newPasswordSchema });

/**
 * Choosing a new password from a reset link (S3.9 to S3.11). On success every device is signed
 * out, so the person signs in again with the email already filled in.
 */
export function ResetPasswordForm({
  token,
  callbackUrl,
  onLinkDead,
}: {
  token: string;
  callbackUrl: string;
  /** The link turned out to be used or expired while the page was open. */
  onLinkDead: () => void;
}) {
  const router = useRouter();
  const id = useId();
  const passwordId = `${id}-password`;
  const formRef = useRef<HTMLFormElement>(null);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);

  const form = useForm({
    defaultValues: { newPassword: '' },
    validationLogic: revalidateLogic({ mode: 'blur', modeAfterSubmission: 'change' }),
    validators: { onDynamic: fields },
    onSubmitInvalid: () => focusFirstInvalid(formRef.current),
    onSubmit: ({ value }) => submit(value.newPassword),
  }); // Re-render the fields when a submit is tried, so every error shows.
  const submitted = useStore(form.store, (formState) => formState.submissionAttempts > 0);

  async function submit(newPassword: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setFailure(null);
    try {
      const outcome = await callAction(() => resetPasswordAction({ token, newPassword }));
      if (outcome.ok) {
        rememberEmail(outcome.data.email);
        const back = safeRedirectPath(callbackUrl);
        const query = new URLSearchParams({ notice: 'password-changed' });
        if (back !== '/') query.set('callbackUrl', back);
        router.replace(`/sign-in?${query.toString()}` as Route);
        return;
      }
      if (outcome.error.code === 'LINK_EXPIRED') {
        onLinkDead();
        return;
      }
      setFailure(outcome.error);
      if (outcome.error.code === 'INVALID_INPUT') focusThenAnnounce(passwordId);
      else focusThenAnnounce(null, outcome.error.message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <div>
      <AuthTitle title="Choose a new password" />
      <div className="mt-6 md:mt-10 xl:mt-12">
        {failure && failure.code !== 'INVALID_INPUT' ? (
          <FormAlert variant="error" className="mb-6">
            {failure.message}
          </FormAlert>
        ) : null}
        <form
          ref={formRef}
          noValidate
          method="post"
          aria-label="Choose a new password"
          onSubmit={(event) => {
            event.preventDefault();
            void submitChecked(form);
          }}
        >
          <form.Field name="newPassword">
            {(field) => {
              const error = visibleError(
                field.state.meta,
                submitted,
                fieldError(failure, 'newPassword'),
              );
              return (
                <FieldShell
                  id={passwordId}
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
                        if (error) void form.validate('blur');
                      }}
                      onBlur={blurField(field.handleBlur)}
                    />
                  )}
                </FieldShell>
              );
            }}
          </form.Field>
          <SubmitButton pending={busy} pendingLabel="Saving…" className="mt-8 w-full uppercase">
            Save new password
          </SubmitButton>
        </form>
      </div>
    </div>
  );
}
