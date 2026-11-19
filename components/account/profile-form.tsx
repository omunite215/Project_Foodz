'use client';

import { revalidateLogic, useForm, useStore } from '@tanstack/react-form';
import { ChevronDown } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useId, useRef, useState } from 'react';
import { z } from 'zod';
import { updateProfileAction } from '@/server/modules/account/actions';
import { nameSchema, PHONE_ERROR } from '@/server/modules/account/schema';
import { blurField, FieldShell, visibleError } from '@/components/forms/field-shell';
import { FormAlert } from '@/components/forms/form-alert';
import { focusFirstInvalid, focusThenAnnounce, submitChecked } from '@/components/forms/feedback';
import { StatusLine } from '@/components/forms/status-line';
import { SubmitButton } from '@/components/forms/submit-button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { type ActionFailure, callAction, fieldError } from '@/lib/action-result';
import { announce } from '@/lib/announce';
import { authPageHref } from '@/lib/auth-links';
import { DEFAULT_PHONE_COUNTRY, parsePhone } from '@/lib/phone';
import { compactCountry, type PhoneCountry } from '@/lib/phone-countries';
import Link from 'next/link';
import { useAccount } from './account-context';
import { LockedLine, SettingsCard } from './settings-card';

const profileFields = z
  .object({ name: nameSchema, phone: z.string(), phoneCountry: z.string() })
  .superRefine((value, ctx) => {
    if (value.phone.trim() && !parsePhone(value.phone, value.phoneCountry)) {
      ctx.addIssue({ code: 'custom', path: ['phone'], message: PHONE_ERROR });
    }
  });

const SESSION_ENDED = "You've been signed out. Sign in again to save your changes.";

/**
 * The country code beside the phone number (design 4.2): a compact "US +1" like Figma's, over a
 * native select whose options read in full ("United States (+1)").
 */
function CountryCodeSelect({
  countries,
  value,
  onChange,
  disabled,
}: {
  countries: readonly PhoneCountry[];
  value: string;
  onChange: (code: string) => void;
  disabled?: boolean;
}) {
  const current = countries.find((country) => country.code === value) ?? countries[0]!;

  return (
    <div className="relative flex h-11 items-center justify-between rounded-xl border border-input bg-white px-4 text-body-4 text-neutral-2 has-[select:disabled]:border-neutral-6 has-[select:disabled]:bg-neutral-7 has-[select:disabled]:text-neutral-3 has-[select:focus-visible]:outline-2 has-[select:focus-visible]:outline-offset-2 has-[select:focus-visible]:outline-ring has-[select:focus-visible]:outline-solid">
      <span aria-hidden>{compactCountry(current)}</span>
      <ChevronDown className="size-4 text-neutral-3" aria-hidden />
      <select
        aria-label="Country code"
        value={current.code}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="absolute inset-0 cursor-pointer opacity-0 outline-none disabled:cursor-not-allowed"
      >
        {countries.map((country) => (
          <option key={country.code} value={country.code}>
            {country.name} ({country.dial})
          </option>
        ))}
      </select>
    </div>
  );
}

/** Name and phone (S5.1 to S5.3). An unchanged form can't be sent; the demo profile is read-only. */
export function ProfileForm({
  countries,
}: {
  /** Named on the server, so the browser's own country names never differ from the page's. */
  countries: readonly PhoneCountry[];
}) {
  const account = useAccount();
  const router = useRouter();
  const id = useId();
  const ids = { name: `${id}-name`, phone: `${id}-phone` };
  const formRef = useRef<HTMLFormElement>(null);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [saved, setSaved] = useState(false);
  const locked = !account.canEditProfile;
  const lockedId = `${id}-locked`;

  const initial = {
    name: account.name,
    phone: account.phoneDisplay ?? '',
    phoneCountry: account.phoneCountry ?? DEFAULT_PHONE_COUNTRY,
  };

  const form = useForm({
    defaultValues: initial,
    validationLogic: revalidateLogic({ mode: 'blur', modeAfterSubmission: 'change' }),
    validators: { onDynamic: profileFields },
    onSubmitInvalid: () => focusFirstInvalid(formRef.current),
    onSubmit: async ({ value, formApi }) => {
      if (busyRef.current || locked) return;
      busyRef.current = true;
      setBusy(true);
      setFailure(null);
      setSaved(false);
      const outcome = await callAction(() =>
        updateProfileAction({
          name: value.name,
          phone: value.phone.trim(),
          phoneCountry: value.phoneCountry,
        }),
      );
      busyRef.current = false;
      setBusy(false);
      if (outcome.ok) {
        const next = {
          name: outcome.data.name,
          phone: outcome.data.phoneDisplay ?? '',
          phoneCountry: outcome.data.phoneCountry ?? value.phoneCountry,
        };
        formApi.reset(next);
        setSaved(true);
        announce('Profile saved');
        // The header's first name comes from the server.
        router.refresh();
        return;
      }
      const error = outcome.error;
      setFailure(error);
      if (error.code === 'INVALID_INPUT') {
        focusThenAnnounce(fieldError(error, 'name') ? ids.name : ids.phone);
        return;
      }
      focusThenAnnounce(null, error.code === 'UNAUTHENTICATED' ? SESSION_ENDED : error.message);
    },
  }); // Re-render the fields when a submit is tried, so every error shows.
  const submitted = useStore(form.store, (formState) => formState.submissionAttempts > 0);

  return (
    <SettingsCard id="profile" title="Profile">
      <form
        ref={formRef}
        noValidate
        method="post"
        aria-label="Profile"
        onSubmit={(event) => {
          event.preventDefault();
          if (locked) return;
          if (form.state.isDefaultValue) {
            announce('No changes to save.');
            return;
          }
          void submitChecked(form);
        }}
      >
        {failure && failure.code !== 'INVALID_INPUT' ? (
          <FormAlert
            variant={failure.code === 'UNAUTHENTICATED' ? 'info' : 'error'}
            className="mb-6"
            action={
              failure.code === 'UNAUTHENTICATED' ? (
                <Button asChild variant="outline" size="touch" className="bg-white">
                  <Link href={authPageHref('/sign-in', '/account')}>Sign in</Link>
                </Button>
              ) : null
            }
          >
            {failure.code === 'UNAUTHENTICATED' ? SESSION_ENDED : failure.message}
          </FormAlert>
        ) : null}
        <div className="max-w-[524px] space-y-6">
          <form.Field name="name">
            {(field) => {
              const error = visibleError(field.state.meta, submitted, fieldError(failure, 'name'));
              return (
                <FieldShell id={ids.name} label="Name" error={error}>
                  {(control) => (
                    <Input
                      {...control}
                      name="name"
                      autoComplete="name"
                      autoCapitalize="words"
                      maxLength={60}
                      readOnly={locked}
                      aria-describedby={locked ? lockedId : control['aria-describedby']}
                      value={field.state.value}
                      onChange={(event) => {
                        field.handleChange(event.target.value);
                        setSaved(false);
                        if (error) void form.validate('blur');
                      }}
                      onBlur={blurField(field.handleBlur)}
                    />
                  )}
                </FieldShell>
              );
            }}
          </form.Field>
          <form.Field name="phone">
            {(field) => {
              const error = visibleError(field.state.meta, submitted, fieldError(failure, 'phone'));
              return (
                <FieldShell
                  id={ids.phone}
                  label="Phone"
                  optional
                  hint="Only your courier sees it, and only during a delivery."
                  error={error}
                >
                  {(control) => (
                    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-2">
                      <form.Field name="phoneCountry">
                        {(country) => (
                          <CountryCodeSelect
                            countries={countries}
                            value={country.state.value}
                            disabled={locked}
                            onChange={(code) => {
                              country.handleChange(code);
                              setSaved(false);
                              if (error) void form.validate('blur');
                            }}
                          />
                        )}
                      </form.Field>
                      <Input
                        {...control}
                        name="phone"
                        type="tel"
                        autoComplete="tel"
                        readOnly={locked}
                        aria-describedby={
                          locked
                            ? [control['aria-describedby'], lockedId].filter(Boolean).join(' ')
                            : control['aria-describedby']
                        }
                        value={field.state.value}
                        onChange={(event) => {
                          const typed = event.target.value;
                          field.handleChange(typed);
                          setSaved(false);
                          // Autofill with "+84…" picks the matching country.
                          if (typed.startsWith('+')) {
                            const parsed = parsePhone(typed, form.getFieldValue('phoneCountry'));
                            if (parsed) form.setFieldValue('phoneCountry', parsed.country);
                          }
                          if (error) void form.validate('blur');
                        }}
                        onBlur={(event) => {
                          blurField(field.handleBlur)(event);
                          const parsed = parsePhone(
                            field.state.value,
                            form.getFieldValue('phoneCountry'),
                          );
                          if (parsed) {
                            field.handleChange(parsed.display);
                            form.setFieldValue('phoneCountry', parsed.country);
                          }
                        }}
                      />
                    </div>
                  )}
                </FieldShell>
              );
            }}
          </form.Field>
        </div>
        {locked ? (
          <LockedLine id={lockedId} className="mt-8">
            The demo account&apos;s profile can&apos;t be changed.
          </LockedLine>
        ) : (
          <form.Subscribe selector={(state) => state.isDefaultValue}>
            {(unchanged) => (
              <>
                <SubmitButton
                  pending={busy}
                  pendingLabel="Saving…"
                  blocked={unchanged}
                  onBlockedPress={() => announce('No changes to save.')}
                  className="mt-8 w-full uppercase md:w-auto md:min-w-40"
                >
                  Save changes
                </SubmitButton>
                <StatusLine tone={saved ? 'success' : null}>{saved ? 'Saved' : null}</StatusLine>
              </>
            )}
          </form.Subscribe>
        )}
      </form>
    </SettingsCard>
  );
}
