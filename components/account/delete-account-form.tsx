'use client';

import { revalidateLogic, useForm, useStore } from '@tanstack/react-form';
import { Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useId, useRef, useState } from 'react';
import { z } from 'zod';
import { deleteAccountAction } from '@/server/modules/account/actions';
import { blurField, FieldShell, visibleError } from '@/components/forms/field-shell';
import { FormAlert } from '@/components/forms/form-alert';
import { focusFirstInvalid, focusThenAnnounce, submitChecked } from '@/components/forms/feedback';
import { GoogleButton } from '@/components/forms/google-button';
import { PasswordInput } from '@/components/forms/password-input';
import { SubmitButton } from '@/components/forms/submit-button';
import { Button } from '@/components/ui/button';
import { type ActionFailure, callAction, fieldError } from '@/lib/action-result';
import { postAuthEvent } from '@/lib/auth-channel';
import { forgetEmail } from '@/lib/email-handoff';
import { forgetDrafts } from '@/lib/form-draft';
import { useEndCartSession } from '@/lib/data/cart';
import { authPageHref } from '@/lib/auth-links';
import { cn } from '@/lib/utils';
import { useAccount } from './account-context';
import { deleteBlockedText } from './privacy-cards';
import { LockedLine } from './settings-card';

const REAUTH_TEXT = 'For your security, enter your password to continue.';

type Method = 'password' | 'google';

const methodsFrom = (
  details: Record<string, unknown> | undefined,
  fallback: Method[],
): Method[] => {
  const raw = details?.methods;
  if (!Array.isArray(raw)) return fallback;
  return raw.filter((method): method is Method => method === 'password' || method === 'google');
};

/**
 * The final step of deleting an account (S5.11, S6.4 to S6.6). A sign-in older than 10 minutes
 * asks "Confirm it's you" in place, and the next press confirms and deletes in one go. Success
 * signs out everywhere, empties this device's cart and lands on Home with the notice.
 */
export function DeleteAccountForm({ needsConfirm }: { needsConfirm: boolean }) {
  const account = useAccount();
  const blocked = account.deleteBlockedReason ?? (account.canDelete ? null : 'staff');
  if (blocked) return <LockedLine className="mt-8">{deleteBlockedText(blocked)}</LockedLine>;
  return <DeleteForm needsConfirm={needsConfirm} methods={account.signInMethods} />;
}

function DeleteForm({ needsConfirm, methods }: { needsConfirm: boolean; methods: Method[] }) {
  const id = useId();
  const passwordId = `${id}-password`;
  const reasonId = `${id}-reason`;
  const busyRef = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Method[] | null>(needsConfirm ? methods : null);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [orderOnTheWay, setOrderOnTheWay] = useState(false);
  const endCartSession = useEndCartSession();

  const form = useForm({
    defaultValues: { password: '' },
    validationLogic: revalidateLogic({ mode: 'submit', modeAfterSubmission: 'change' }),
    validators: {
      onDynamic: z.object({
        password: confirm?.includes('password')
          ? z.string().min(1, 'Enter your password.')
          : z.string(),
      }),
    },
    onSubmitInvalid: () => focusFirstInvalid(formRef.current),
    onSubmit: ({ value }) => submit(value.password),
  }); // Re-render the fields when a submit is tried, so every error shows.
  const submitted = useStore(form.store, (formState) => formState.submissionAttempts > 0);

  async function submit(password: string) {
    if (busyRef.current || orderOnTheWay) return;
    busyRef.current = true;
    setBusy(true);
    setFailure(null);
    const outcome = await callAction(() =>
      deleteAccountAction(confirm?.includes('password') && password ? { password } : {}),
    );
    if (outcome.ok) {
      endCartSession();
      forgetDrafts();
      forgetEmail();
      postAuthEvent('signed-out');
      // A full load of Home: the server shows "Your account has been deleted." and nothing of
      // the account stays in memory. Replace, so Back never returns here.
      window.location.replace('/');
      return;
    }
    busyRef.current = false;
    setBusy(false);
    const error = outcome.error;
    switch (error.code) {
      case 'REAUTH_REQUIRED': {
        const next = methodsFrom(error.details, methods);
        setConfirm(next);
        setNotice(REAUTH_TEXT);
        focusThenAnnounce(next.includes('password') ? passwordId : null, REAUTH_TEXT);
        return;
      }
      case 'INVALID_INPUT':
        setFailure(error);
        focusThenAnnounce(passwordId);
        return;
      case 'CONFLICT':
        setOrderOnTheWay(true);
        setFailure(error);
        focusThenAnnounce(null, error.message);
        return;
      default:
        setFailure(error);
        focusThenAnnounce(null, error.message);
    }
  }

  return (
    <form
      ref={formRef}
      noValidate
      method="post"
      aria-label="Delete your account"
      onSubmit={(event) => {
        event.preventDefault();
        void submitChecked(form);
      }}
    >
      {failure && failure.code !== 'INVALID_INPUT' ? (
        <FormAlert
          id={reasonId}
          variant={failure.code === 'CONFLICT' ? 'warning' : 'error'}
          className="mt-8"
        >
          {failure.message}
        </FormAlert>
      ) : null}

      {confirm ? (
        <div className="mt-8">
          <h2 className="font-heading text-title-2 text-neutral-2">Confirm it&apos;s you</h2>
          {notice ? (
            <FormAlert variant="info" className="mt-4">
              {notice}
            </FormAlert>
          ) : null}
          {confirm.includes('password') ? (
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
                    className="mt-4 max-w-[524px]"
                  >
                    {(control) => (
                      <PasswordInput
                        {...control}
                        name="password"
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
          ) : confirm.includes('google') ? (
            <div className="mt-4 max-w-[524px]">
              <GoogleButton
                label="Confirm with Google"
                callbackUrl="/account/privacy/delete"
                errorPage={authPageHref('/sign-in', '/account/privacy/delete')}
                onFailure={() =>
                  setFailure({
                    code: 'GOOGLE',
                    message: "We couldn't reach Google. Check your connection, then try again.",
                  })
                }
              />
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-8 flex flex-col gap-3 md:flex-row">
        <SubmitButton
          variant="danger"
          pending={busy}
          pendingLabel="Deleting…"
          blocked={orderOnTheWay}
          aria-describedby={orderOnTheWay ? reasonId : undefined}
          className={cn('uppercase')}
        >
          <Trash2 className="size-4" aria-hidden />
          Delete my account
        </SubmitButton>
        <Button
          asChild
          variant="outline"
          size="touch"
          className="border-neutral-6 bg-white text-neutral-2 hover:bg-neutral-7"
        >
          <Link href="/account/privacy">Keep my account</Link>
        </Button>
      </div>
    </form>
  );
}
