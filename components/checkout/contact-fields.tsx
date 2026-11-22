'use client';

import { revalidateLogic, useForm, useStore } from '@tanstack/react-form';
import { useId, useRef } from 'react';
import { z } from 'zod';
import { MAX_NOTE_LENGTH } from '@/server/modules/cart/schema';
import { nameSchema, PHONE_ERROR } from '@/server/modules/account/schema';
import { PHONE_REQUIRED } from '@/server/modules/orders/schema';
import { CountryCodeSelect } from '@/components/account/profile-form';
import { CheckboxRow } from '@/components/forms/choice-chips';
import { submitChecked } from '@/components/forms/feedback';
import { blurField, FieldShell, visibleError } from '@/components/forms/field-shell';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { type ActionFailure, fieldError } from '@/lib/action-result';
import { parsePhone } from '@/lib/phone';
import type { PhoneCountry } from '@/lib/phone-countries';

/*
 * "Contact" (F4 design 2.9, S2.6 to S2.8): the name for this order, the phone the courier calls
 * (required, US +1 by default) with "Save this number to my profile" when it is new, and the note
 * for the kitchen. Checked on leaving a field, then as she types (F2 2.6).
 */

export const contactSchema = z
  .object({
    contactName: nameSchema,
    phone: z.string(),
    phoneCountry: z.string(),
    savePhone: z.boolean(),
    kitchenNote: z.string().max(MAX_NOTE_LENGTH, 'Use 200 characters or fewer.'),
  })
  .superRefine((value, ctx) => {
    if (!value.phone.trim()) {
      ctx.addIssue({ code: 'custom', path: ['phone'], message: PHONE_REQUIRED });
    } else if (!parsePhone(value.phone, value.phoneCountry)) {
      ctx.addIssue({ code: 'custom', path: ['phone'], message: PHONE_ERROR });
    }
  });

export type ContactValues = z.input<typeof contactSchema>;

export const CONTACT_IDS = {
  name: 'contact-name',
  phone: 'contact-phone',
  note: 'kitchen-note',
} as const;

/** The contact form, with a check that says whether every field is right now. */
export function useContactForm(defaults: ContactValues) {
  const valid = useRef(false);
  const form = useForm({
    defaultValues: defaults,
    validationLogic: revalidateLogic({ mode: 'blur', modeAfterSubmission: 'change' }),
    validators: { onDynamic: contactSchema },
    onSubmit: () => {
      valid.current = true;
    },
  });
  /** Checks every field (each shows its error); true when all are right. */
  const check = async () => {
    valid.current = false;
    await submitChecked(form);
    return valid.current;
  };
  return { form, check };
}

export type ContactForm = ReturnType<typeof useContactForm>['form'];

export interface ContactFieldsProps {
  form: ContactForm;
  countries: readonly PhoneCountry[];
  /** The profile's number (E.164), to know whether to offer saving the typed one. */
  profilePhone: string | null;
  demo: boolean;
  /** The server's answer, for its errors under the fields. */
  failure: ActionFailure | null;
  /** A field changed: the server's old error under it goes. */
  onEdited: (field: 'contactName' | 'phone' | 'kitchenNote') => void;
  /** Kept for this tab (S7.2). */
  onNote: (note: string) => void;
}

export function ContactFields({
  form,
  countries,
  profilePhone,
  demo,
  failure,
  onEdited,
  onNote,
}: ContactFieldsProps) {
  const id = useId();
  const submitted = useStore(form.store, (state) => state.submissionAttempts > 0);
  const phone = useStore(form.store, (state) => state.values.phone);
  const phoneCountry = useStore(form.store, (state) => state.values.phoneCountry);
  const parsed = parsePhone(phone, phoneCountry);
  const offerSave = !demo && parsed !== null && parsed.e164 !== profilePhone;

  return (
    <section aria-labelledby="contact-title">
      <h2 id="contact-title" className="text-body-2 font-semibold text-neutral-1">
        Contact
      </h2>
      <div className="mt-4 space-y-6">
        <div className="grid gap-6 md:grid-cols-2 md:gap-3">
          <form.Field name="contactName">
            {(field) => {
              const error = visibleError(
                field.state.meta,
                submitted,
                fieldError(failure, 'contactName'),
              );
              return (
                <FieldShell
                  id={CONTACT_IDS.name}
                  label="Name for the order"
                  hint="Your courier sees only your first name."
                  error={error}
                >
                  {(control) => (
                    <Input
                      {...control}
                      name="contactName"
                      autoComplete="name"
                      autoCapitalize="words"
                      maxLength={60}
                      value={field.state.value}
                      onChange={(event) => {
                        field.handleChange(event.target.value);
                        onEdited('contactName');
                      }}
                      onBlur={blurField(field.handleBlur)}
                      className="[overflow-wrap:anywhere]"
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
                <div>
                  <FieldShell
                    id={CONTACT_IDS.phone}
                    label="Phone number"
                    hint="Only your courier sees it, and only during the delivery."
                    error={error}
                  >
                    {(control) => (
                      <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-2">
                        <form.Field name="phoneCountry">
                          {(country) => (
                            <CountryCodeSelect
                              countries={countries}
                              value={country.state.value}
                              onChange={(code) => {
                                country.handleChange(code);
                                onEdited('phone');
                              }}
                            />
                          )}
                        </form.Field>
                        <Input
                          {...control}
                          name="phone"
                          type="tel"
                          autoComplete="tel"
                          placeholder="(617) 555-0142"
                          value={field.state.value}
                          onChange={(event) => {
                            const typed = event.target.value;
                            field.handleChange(typed);
                            onEdited('phone');
                            if (typed.startsWith('+')) {
                              const match = parsePhone(typed, form.getFieldValue('phoneCountry'));
                              if (match) form.setFieldValue('phoneCountry', match.country);
                            }
                          }}
                          onBlur={(event) => {
                            blurField(field.handleBlur)(event);
                            const match = parsePhone(
                              field.state.value,
                              form.getFieldValue('phoneCountry'),
                            );
                            if (match) {
                              field.handleChange(match.display);
                              form.setFieldValue('phoneCountry', match.country);
                            }
                          }}
                        />
                      </div>
                    )}
                  </FieldShell>
                  {offerSave ? (
                    <form.Field name="savePhone">
                      {(save) => (
                        <div className="mt-3">
                          <CheckboxRow
                            id={`${id}-save-phone`}
                            label="Save this number to my profile"
                            checked={save.state.value}
                            onChange={(checked) => save.handleChange(checked)}
                          />
                        </div>
                      )}
                    </form.Field>
                  ) : null}
                </div>
              );
            }}
          </form.Field>
        </div>
        <form.Field name="kitchenNote">
          {(field) => {
            const error = visibleError(
              field.state.meta,
              submitted,
              fieldError(failure, 'kitchenNote'),
            );
            const left = MAX_NOTE_LENGTH - field.state.value.length;
            return (
              <FieldShell
                id={CONTACT_IDS.note}
                label="Note for the kitchen"
                optional
                hint="For the whole order. Notes for one dish stay on that dish in your cart."
                error={error}
                more={
                  <p className="mt-1 text-right text-caption text-muted-foreground tabular-nums">
                    <span aria-hidden>
                      {field.state.value.length}/{MAX_NOTE_LENGTH}
                    </span>
                    {left <= 20 ? <span className="sr-only">{left} characters left</span> : null}
                  </p>
                }
              >
                {(control) => (
                  <Textarea
                    {...control}
                    name="kitchenNote"
                    maxLength={MAX_NOTE_LENGTH}
                    placeholder="More spicy, more sauce…"
                    value={field.state.value}
                    onChange={(event) => {
                      field.handleChange(event.target.value);
                      onEdited('kitchenNote');
                      onNote(event.target.value);
                    }}
                    onBlur={blurField(field.handleBlur)}
                    className="max-h-32 min-h-[88px] rounded-xl bg-white px-5 py-2.5 text-body-4 text-neutral-2 md:text-body-4"
                  />
                )}
              </FieldShell>
            );
          }}
        </form.Field>
      </div>
    </section>
  );
}
