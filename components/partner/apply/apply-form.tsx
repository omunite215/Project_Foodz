'use client';

import { useForm, useStore } from '@tanstack/react-form';
import { useDebouncer } from '@tanstack/react-pacer';
import { CircleCheck, IdCard, ShieldCheck, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useEffectEvent, useId, useRef, useState } from 'react';
import type { LegalPage } from '@/server/modules/content/schema';
import {
  submitApplicationAction,
  updateApplicationAction,
} from '@/server/modules/partners/actions';
import type { ApplicationSummary } from '@/server/modules/partners/schema';
import { needsPlate, normalizePlate } from '@/server/modules/partners/rules';
import { DOCUMENT_WORDS, storeDate, VEHICLE_WORDS } from '@/server/modules/partners/text';
import { FormAlert } from '@/components/forms/form-alert';
import { CHECK_FAILED_TEXT, Turnstile, type TurnstileHandle } from '@/components/forms/turnstile';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { type ActionFailure, callAction } from '@/lib/action-result';
import { announce } from '@/lib/announce';
import {
  type ApplyField,
  type ApplyUploads,
  type ApplyValues,
  clampStep,
  documentWordsOf,
  expiryNote,
  firstIncompleteStep,
  STEP_FIELDS,
  stepErrors,
  stepOfField,
  typedLast4,
} from '@/lib/partner/apply-rules';
import { forgetApplyDraft, readApplyDraft, saveApplyDraft } from '@/lib/partner/draft';
import {
  agreedLine,
  APPLY_STEPS,
  APPLY_TITLES,
  type ApplyMode,
  type ApplyStep,
  DRAFT_KEPT,
  expiryHint,
  ID_NUMBER_NOT_KEPT,
  idNumberLabel,
  keepNumberHint,
  licenseNeededLine,
  stepLine,
} from '@/lib/partner/text';
import { DEFAULT_PHONE_COUNTRY, parsePhone } from '@/lib/phone';
import type { PhoneCountry } from '@/lib/phone-countries';
import { useMotion } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { usePartnerTheme } from '../partner-root';
import { Dock, DockButton, type HeaderStart, PartnerFrame, PlainHeader } from '../shell';
import { CountrySelect } from './country-select';
import {
  cnInput,
  DocumentChoice,
  IdExamples,
  PartnerCheckbox,
  PartnerField,
  VehicleTiles,
} from './fields';
import { InlineNameEditor } from './name-editor';
import { PartnerTermsSheet } from './terms-sheet';
import { UploadField, type UploadValue } from './upload-field';

/*
 * The application (F6 design 4): four short steps at `?step=1…4`, each pushed to history so the
 * browser's Back keeps everything (P17.2). "Continue" checks only its step. A draft without the
 * ID number stays on this phone for 24 hours (4.2). Edit and fix open on step 4 and save with
 * the version the screen showed; a new application or a reapplication sends after Turnstile.
 */

export interface ApplyFormProps {
  mode: ApplyMode;
  userId: string;
  name: string;
  accountPhone: { e164: string; display: string; country: string | null } | null;
  termsVersion: number;
  terms: LegalPage | null;
  countries: readonly PhoneCountry[];
  timeZone: string;
  application?: ApplicationSummary;
  sentBackMessage?: string;
  withdrawn?: boolean;
}

const firstNameOf = (name: string) => name.trim().split(/\s+/)[0] ?? name;

function initialValues(props: ApplyFormProps): ApplyValues {
  const app = props.application;
  const phone = app?.phone ?? props.accountPhone;
  return {
    phone: phone?.display ?? '',
    phoneCountry:
      (phone && parsePhone(phone.e164, DEFAULT_PHONE_COUNTRY)?.country) ?? DEFAULT_PHONE_COUNTRY,
    vehicleType: app?.vehicleType ?? '',
    plate: app?.plate ?? '',
    idDocumentType: app?.idDocumentType ?? '',
    idNumber: '',
    idExpiresOn: app?.idExpiresOn ?? '',
    adult: false,
    agreeTerms: false,
  };
}

function initialUploads(app: ApplicationSummary | undefined): {
  photo: UploadValue | null;
  idPhoto: UploadValue | null;
} {
  if (!app) return { photo: null, idPhoto: null };
  return {
    photo: { uploadId: app.photo.uploadId, status: 'ready', url: app.photo.url },
    idPhoto: { uploadId: app.idPhoto.uploadId, status: 'ready', url: app.idPhoto.url },
  };
}

/** One line per problem for step 4's alert (design 4.7.4). */
interface Problem {
  step: ApplyStep;
  field: string;
  text: string;
}

function problemsFrom(fieldErrors: Partial<Record<string, string>>): Problem[] {
  return Object.entries(fieldErrors)
    .filter((entry): entry is [string, string] => Boolean(entry[1]))
    .map(([field, text]) => ({ step: stepOfField(field), field, text }))
    .toSorted((a, b) => a.step - b.step);
}

export function ApplyForm(props: ApplyFormProps) {
  const { mode, userId, timeZone, application } = props;
  const router = useRouter();
  const search = useSearchParams();
  const { resolved } = usePartnerTheme();
  const formId = useId();
  const editing = mode === 'edit' || mode === 'fix';
  const [today] = useState(() => storeDate(new Date(), timeZone));

  const [name, setName] = useState(props.name);
  const [uploads, setUploads] = useState(() => initialUploads(application));
  const [attempted, setAttempted] = useState<Set<ApplyStep>>(() => new Set());
  const [serverErrors, setServerErrors] = useState<Partial<Record<string, string>>>({});
  const [uploadErrors, setUploadErrors] = useState<{
    photo: string | null;
    idPhoto: string | null;
  }>({ photo: null, idPhoto: null });
  const [problems, setProblems] = useState<Problem[]>([]);
  const [failure, setFailure] = useState<{ text: string; retry: boolean } | null>(null);
  const [pending, setPending] = useState(false);
  const [challenge, setChallenge] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const [draftNotice, setDraftNotice] = useState(false);
  const [withdrawnNotice, setWithdrawnNotice] = useState(Boolean(props.withdrawn));
  const [recheckUploads, setRecheckUploads] = useState(false);
  const [returnToCheck, setReturnToCheck] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);
  const pushedSteps = useRef(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const photoFocus = useRef<HTMLInputElement | null>(null);
  const idPhotoFocus = useRef<HTMLInputElement | null>(null);
  const termsLinkRef = useRef<HTMLAnchorElement>(null);
  const turnstileRef = useRef<TurnstileHandle>(null);
  const focusHeading = useRef(false);

  const form = useForm({ defaultValues: initialValues(props) });
  const values = useStore(form.store, (state) => state.values);
  const dirty = useStore(form.store, (state) => !state.isDefaultValue);

  const uploadState: ApplyUploads = {
    photo: uploads.photo && { uploadId: uploads.photo.uploadId, status: uploads.photo.status },
    idPhoto: uploads.idPhoto && {
      uploadId: uploads.idPhoto.uploadId,
      status: uploads.idPhoto.status,
    },
  };
  const requested = clampStep(Number(search.get('step') ?? (editing ? 4 : 1)));
  const step = firstIncompleteStep(requested, values, uploadState, mode, today);
  const document = documentWordsOf(values);
  const checking = uploads.photo?.status === 'checking' || uploads.idPhoto?.status === 'checking';
  const uploadsChanged =
    uploads.photo?.uploadId !== application?.photo.uploadId ||
    uploads.idPhoto?.uploadId !== application?.idPhoto.uploadId;
  const unsaved = editing && (dirty || uploadsChanged);

  function stepHref(next: ApplyStep): string {
    const params = new URLSearchParams(search.toString());
    params.set('step', String(next));
    params.delete('done');
    return `?${params.toString()}`;
  }

  // ---------------------------------------------------------------- the draft (design 4.2)

  const restore = useEffectEvent(() => {
    const draft = readApplyDraft(userId);
    if (!draft) return;
    form.setFieldValue('phone', draft.phone);
    form.setFieldValue('phoneCountry', draft.phoneCountry);
    form.setFieldValue('vehicleType', draft.vehicleType ?? '');
    form.setFieldValue('plate', draft.plate);
    form.setFieldValue('idDocumentType', draft.idDocumentType ?? '');
    form.setFieldValue('idExpiresOn', draft.idExpiresOn);
    setUploads((current) => ({
      photo: draft.photoUploadId
        ? current.photo?.uploadId === draft.photoUploadId
          ? current.photo
          : { uploadId: draft.photoUploadId, status: 'ready', url: null }
        : current.photo,
      idPhoto: draft.idDocumentUploadId
        ? current.idPhoto?.uploadId === draft.idDocumentUploadId
          ? current.idPhoto
          : { uploadId: draft.idDocumentUploadId, status: 'ready', url: null }
        : current.idPhoto,
    }));
    setRecheckUploads(true);
    setDraftRestored(true);
    setDraftNotice(true);
    if (!search.get('step') && draft.step > 1) {
      window.history.replaceState(null, '', stepHref(clampStep(draft.step)));
    }
  });
  useEffect(() => {
    const timer = setTimeout(restore, 0);
    return () => clearTimeout(timer);
  }, []);

  const saver = useDebouncer(
    (next: { values: ApplyValues; uploads: typeof uploads; step: ApplyStep }) =>
      saveApplyDraft(userId, {
        step: next.step,
        phone: next.values.phone,
        phoneCountry: next.values.phoneCountry,
        vehicleType: next.values.vehicleType || null,
        plate: next.values.plate,
        idDocumentType: next.values.idDocumentType || null,
        idExpiresOn: next.values.idExpiresOn,
        photoUploadId: next.uploads.photo?.uploadId ?? null,
        idDocumentUploadId: next.uploads.idPhoto?.uploadId ?? null,
      }),
    { wait: 300 },
  );
  const touched = useRef(false);
  useEffect(() => {
    // Nothing is written until the person changes something.
    if (!touched.current) {
      touched.current = true;
      return;
    }
    if (editing && !unsaved) return;
    saver.maybeExecute({ values, uploads, step });
  }, [values, uploads, step, editing, unsaved, saver]);

  // ---------------------------------------------------------------- steps

  function goTo(next: ApplyStep) {
    focusHeading.current = true;
    if (next > step) {
      pushedSteps.current += 1;
      window.history.pushState(null, '', stepHref(next));
    } else if (pushedSteps.current > 0 && next === step - 1) {
      pushedSteps.current -= 1;
      window.history.back();
    } else {
      window.history.pushState(null, '', stepHref(next));
    }
  }

  // Moving forward focuses the new step's heading (design 4.1); the form fades in.
  const shownStep = useRef(step);
  useEffect(() => {
    if (shownStep.current === step) return;
    shownStep.current = step;
    if (focusHeading.current) {
      focusHeading.current = false;
      headingRef.current?.focus();
    }
  }, [step]);
  useMotion(
    (motion) => {
      if (!contentRef.current) return;
      motion.from(contentRef.current, { opacity: 0, duration: 0.15, ease: 'power2.out' });
    },
    { scope: contentRef, dependencies: [step] },
  );

  // ---------------------------------------------------------------- errors

  const clientErrors = stepErrors(step, values, uploadState, mode, today);
  const errorFor = (field: ApplyField, blurred = false): string | null => {
    if (field === 'photoUploadId' && uploadErrors.photo) return uploadErrors.photo;
    if (field === 'idDocumentUploadId' && uploadErrors.idPhoto) return uploadErrors.idPhoto;
    const client = attempted.has(step) || blurred ? (clientErrors[field] ?? null) : null;
    return client ?? serverErrors[field] ?? null;
  };

  function focusFirstProblem(frames = 10) {
    requestAnimationFrame(() => {
      const field = formRef.current?.querySelector<HTMLElement>(
        '[aria-invalid="true"], [data-invalid="true"]',
      );
      if (field) field.focus();
      else if (frames > 0) focusFirstProblem(frames - 1);
    });
  }

  function onContinue() {
    setAttempted((current) => new Set(current).add(step));
    if (Object.keys(clientErrors).length) {
      focusFirstProblem();
      return;
    }
    if (returnToCheck) {
      setReturnToCheck(false);
      goTo(4);
      return;
    }
    goTo(clampStep(step + 1));
  }

  function showAlert() {
    requestAnimationFrame(() => alertRef.current?.focus());
  }

  // ---------------------------------------------------------------- send and save

  function handleFailure(error: ActionFailure) {
    if (error.code === 'APPLICATION_DECIDED') {
      forgetApplyDraft(userId);
      router.replace('/partner?done=decided');
      return;
    }
    if (error.code === 'APPLICATION_EXISTS') {
      forgetApplyDraft(userId);
      router.replace('/partner');
      return;
    }
    const fields = Object.fromEntries(
      Object.entries(error.fieldErrors ?? {}).map(([key, messages]) => [key, messages[0] ?? '']),
    );
    if (Object.keys(fields).length) {
      // An upload the server can't use empties its field (design 4.4, "Not available at send").
      if (fields.photoUploadId) setUploads((current) => ({ ...current, photo: null }));
      if (fields.idDocumentUploadId) setUploads((current) => ({ ...current, idPhoto: null }));
      setServerErrors(fields);
      setProblems(problemsFrom(fields));
      setFailure(null);
      announce('Please fix these before you send:');
      showAlert();
      return;
    }
    setProblems([]);
    setFailure({ text: error.message, retry: false });
    announce(error.message);
    showAlert();
  }

  async function onSend() {
    if (pending) return;
    setFailure(null);
    // Every step again: one line per problem, each a link to its step.
    const all: Problem[] = [];
    for (const each of [1, 2, 3, 4] as const) {
      const errors = stepErrors(each, values, uploadState, mode, today);
      for (const field of STEP_FIELDS[each]) {
        const text = errors[field];
        if (text) all.push({ step: each, field, text });
      }
    }
    setAttempted(new Set([1, 2, 3, 4]));
    if (all.length) {
      setProblems(all);
      announce('Please fix these before you send:');
      showAlert();
      return;
    }
    setProblems([]);
    setServerErrors({});
    const plate = values.vehicleType && needsPlate(values.vehicleType) ? values.plate : undefined;
    const common = {
      photoUploadId: uploads.photo?.uploadId ?? '',
      phone: values.phone.trim(),
      phoneCountry: values.phoneCountry,
      vehicleType: values.vehicleType || 'BICYCLE',
      ...(plate === undefined ? {} : { plate }),
      ...(values.vehicleType === 'BICYCLE' && values.idDocumentType
        ? { idDocumentType: values.idDocumentType }
        : {}),
      idExpiresOn: values.idExpiresOn,
      idDocumentUploadId: uploads.idPhoto?.uploadId ?? '',
    };

    setPending(true);
    if (editing && application) {
      const number = values.idNumber.trim();
      const outcome = await callAction(() =>
        updateApplicationAction({
          ...common,
          ...(number ? { idNumber: number } : {}),
          expectedVersion: application.version,
        }),
      );
      if (outcome.ok) {
        forgetApplyDraft(userId);
        router.replace('/partner?done=saved');
        return;
      }
      setPending(false);
      handleFailure(outcome.error);
      return;
    }

    const token = await turnstileRef.current?.token();
    if (!token) {
      setPending(false);
      setFailure({ text: CHECK_FAILED_TEXT, retry: true });
      announce(CHECK_FAILED_TEXT);
      showAlert();
      return;
    }
    const outcome = await callAction(() =>
      submitApplicationAction({
        ...common,
        idNumber: values.idNumber,
        termsVersion: props.termsVersion,
        adult: values.adult,
        agreeTerms: values.agreeTerms,
        turnstileToken: token,
      }),
    );
    if (outcome.ok) {
      forgetApplyDraft(userId);
      announce('Application sent');
      router.replace('/partner?done=sent');
      return;
    }
    setPending(false);
    handleFailure(outcome.error);
  }

  // ---------------------------------------------------------------- the header

  const closeHref = editing ? '/partner' : '/deliver';
  const start: HeaderStart =
    step === 1
      ? unsaved
        ? { kind: 'close', onClose: () => setLeaving(true) }
        : { kind: 'close', href: closeHref }
      : { kind: 'back', onBack: () => goTo(clampStep(step - 1)) };

  const dockLabel =
    step < 4
      ? returnToCheck
        ? 'Back to Check and send'
        : 'Continue'
      : editing
        ? 'Save changes'
        : 'Send application';
  const blockedForChecking = step === 4 && checking;
  const checkingReason = "We're still checking your photos. This usually takes a few seconds.";
  const reasonId = `${formId}-dock-reason`;

  // ---------------------------------------------------------------- render

  const fixMessage =
    mode === 'fix' && props.sentBackMessage ? (
      <FormAlert variant="warning" tone="partner">
        <p className="font-medium">What we need:</p>
        <p className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">{props.sentBackMessage}</p>
      </FormAlert>
    ) : null;

  const plateNeeded = values.vehicleType !== '' && needsPlate(values.vehicleType);
  const last4 = typedLast4(values.idNumber) ?? (application ? application.idLast4 : null);

  return (
    <PartnerFrame
      header={<PlainHeader title={APPLY_TITLES[mode]} start={start} />}
      mainClassName="px-0 pt-0"
      dock={
        <Dock reason={blockedForChecking ? checkingReason : null} reasonId={reasonId}>
          <DockButton
            type="submit"
            form={formId}
            pending={pending}
            pendingLabel={challenge ? 'Checking…' : editing ? 'Saving…' : 'Sending…'}
            blocked={blockedForChecking}
            blockedReason={checkingReason}
            reasonId={reasonId}
          >
            {blockedForChecking ? 'Waiting for your photos to finish checking…' : dockLabel}
          </DockButton>
        </Dock>
      }
    >
      <div className="px-4 pt-4">
        <p className="text-body-5 font-medium text-muted-foreground">{stepLine(step)}</p>
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="mt-1 font-heading text-title-1 text-strong outline-none"
        >
          {APPLY_STEPS[step - 1]}
        </h1>
        <div aria-hidden className="mt-3 grid grid-cols-4 gap-1.5">
          {APPLY_STEPS.map((label, index) => (
            <span
              key={label}
              className={cn('h-1.5 rounded-full', index < step ? 'bg-primary' : 'bg-border')}
            />
          ))}
        </div>
        <div aria-hidden className="mt-2 hidden grid-cols-4 gap-1.5 text-caption md:grid">
          {APPLY_STEPS.map((label, index) => (
            <span
              key={label}
              className={cn(
                index === step - 1 ? 'font-medium text-strong' : 'text-muted-foreground',
              )}
            >
              {label}
            </span>
          ))}
        </div>
      </div>

      <form
        id={formId}
        ref={formRef}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (step < 4) onContinue();
          else void onSend();
        }}
        className="px-4 pt-6 pb-8"
      >
        <div ref={contentRef} className="space-y-8">
          {withdrawnNotice && step === 1 ? (
            <WithdrawnAlert onDismiss={() => setWithdrawnNotice(false)} />
          ) : null}
          {draftNotice ? (
            <FormAlert
              variant="info"
              tone="partner"
              action={
                <Button
                  type="button"
                  variant="ghost"
                  size="kitchen"
                  className="-ml-3 text-strong underline underline-offset-4"
                  onClick={() => setDraftNotice(false)}
                >
                  Dismiss
                </Button>
              }
            >
              {DRAFT_KEPT}
            </FormAlert>
          ) : null}
          {fixMessage}

          {step === 4 && (problems.length || failure) ? (
            <div ref={alertRef} tabIndex={-1} className="outline-none">
              <FormAlert
                variant="error"
                tone="partner"
                action={
                  failure?.retry ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="kitchen"
                      className="bg-card"
                      onClick={() => void onSend()}
                    >
                      Try again
                    </Button>
                  ) : null
                }
              >
                {problems.length ? (
                  <>
                    <p>Please fix these before you send:</p>
                    <ul className="mt-2 space-y-1">
                      {problems.map((problem) => (
                        <li key={`${problem.step}-${problem.field}`}>
                          <button
                            type="button"
                            className="min-h-11 text-left font-medium underline underline-offset-4"
                            onClick={() => {
                              setReturnToCheck(true);
                              goTo(problem.step);
                            }}
                          >
                            {APPLY_STEPS[problem.step - 1]}: {problem.text}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  failure?.text
                )}
              </FormAlert>
            </div>
          ) : null}

          {step === 1 ? (
            <>
              <InlineNameEditor
                name={name}
                accountPhone={props.accountPhone}
                onSaved={setName}
                hint={`Customers see your first name, ${firstNameOf(name)}.`}
              />
              <UploadField
                kind="photo"
                documentType={document}
                value={uploads.photo}
                recheck={recheckUploads}
                error={errorFor('photoUploadId')}
                focusRef={photoFocus}
                onError={(message) =>
                  setUploadErrors((current) => ({ ...current, photo: message }))
                }
                onChange={(next) => {
                  setUploads((current) => ({ ...current, photo: next }));
                  setServerErrors((current) => ({ ...current, photoUploadId: undefined }));
                }}
              />
              <form.Field name="phone">
                {(field) => (
                  <PartnerField
                    id={`${formId}-phone`}
                    label="Mobile phone"
                    error={errorFor('phone', field.state.meta.isBlurred)}
                    hint={
                      <>
                        <p>
                          Foodz support uses it to reach you while you deliver. Customers don&apos;t
                          see it.
                        </p>
                        <p>This also updates the phone on your Foodz account.</p>
                      </>
                    }
                  >
                    {(control) => (
                      <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-2">
                        <form.Field name="phoneCountry">
                          {(country) => (
                            <CountrySelect
                              countries={props.countries}
                              value={country.state.value}
                              onChange={(code) => country.handleChange(code)}
                            />
                          )}
                        </form.Field>
                        <input
                          {...control}
                          type="tel"
                          name="phone"
                          autoComplete="tel"
                          inputMode="tel"
                          value={field.state.value}
                          onChange={(event) => {
                            field.handleChange(event.target.value);
                            setServerErrors((current) => ({ ...current, phone: undefined }));
                          }}
                          onBlur={() => {
                            field.handleBlur();
                            const parsed = parsePhone(
                              field.state.value,
                              form.getFieldValue('phoneCountry'),
                            );
                            if (parsed) {
                              field.handleChange(parsed.display);
                              form.setFieldValue('phoneCountry', parsed.country);
                            }
                          }}
                          className={cnInput('tabular-nums')}
                        />
                      </div>
                    )}
                  </PartnerField>
                )}
              </form.Field>
            </>
          ) : null}

          {step === 2 ? (
            <>
              <form.Field name="vehicleType">
                {(field) => (
                  <VehicleTiles
                    value={field.state.value}
                    error={errorFor('vehicleType')}
                    onChange={(next) => {
                      field.handleChange(next);
                      setServerErrors((current) => ({ ...current, vehicleType: undefined }));
                    }}
                  />
                )}
              </form.Field>
              {plateNeeded ? (
                <form.Field name="plate">
                  {(field) => (
                    <PartnerField
                      id={`${formId}-plate`}
                      label="Plate number"
                      error={errorFor('plate', field.state.meta.isBlurred)}
                    >
                      {(control) => (
                        <input
                          {...control}
                          name="plate"
                          autoCapitalize="characters"
                          autoComplete="off"
                          spellCheck={false}
                          maxLength={10}
                          value={field.state.value}
                          onChange={(event) => {
                            field.handleChange(event.target.value);
                            setServerErrors((current) => ({ ...current, plate: undefined }));
                          }}
                          onBlur={() => {
                            field.handleBlur();
                            const shown = normalizePlate(field.state.value);
                            if (shown) field.handleChange(shown);
                          }}
                          className={cnInput('uppercase tabular-nums')}
                        />
                      )}
                    </PartnerField>
                  )}
                </form.Field>
              ) : null}
            </>
          ) : null}

          {step === 3 ? (
            <>
              {values.vehicleType === 'BICYCLE' ? (
                <form.Field name="idDocumentType">
                  {(field) => (
                    <DocumentChoice
                      value={field.state.value}
                      error={errorFor('idDocumentType')}
                      onChange={(next) => field.handleChange(next)}
                    />
                  )}
                </form.Field>
              ) : values.vehicleType ? (
                <p className="flex gap-3 rounded-xl bg-muted p-4 text-body-4 text-strong">
                  <IdCard className="mt-0.5 size-5 shrink-0" aria-hidden />
                  {licenseNeededLine(values.vehicleType)}
                </p>
              ) : null}
              <form.Field name="idNumber">
                {(field) => (
                  <PartnerField
                    id={`${formId}-number`}
                    label={idNumberLabel(document)}
                    error={errorFor('idNumber', field.state.meta.isBlurred)}
                    hint={
                      editing && application
                        ? keepNumberHint(
                            DOCUMENT_WORDS[application.idDocumentType],
                            application.idLast4,
                          )
                        : undefined
                    }
                    above={
                      draftRestored && !field.state.value ? (
                        <p className="mt-2 flex gap-2 text-body-5 text-foreground">
                          <ShieldCheck
                            className="mt-0.5 size-4 shrink-0 text-success-mark"
                            aria-hidden
                          />
                          {ID_NUMBER_NOT_KEPT}
                        </p>
                      ) : undefined
                    }
                  >
                    {(control) => (
                      <input
                        {...control}
                        name="idNumber"
                        autoComplete="off"
                        autoCapitalize="characters"
                        autoCorrect="off"
                        spellCheck={false}
                        inputMode="text"
                        maxLength={24}
                        value={field.state.value}
                        onChange={(event) => {
                          field.handleChange(event.target.value);
                          setServerErrors((current) => ({ ...current, idNumber: undefined }));
                        }}
                        onBlur={field.handleBlur}
                        className={cnInput('uppercase tracking-wide tabular-nums')}
                      />
                    )}
                  </PartnerField>
                )}
              </form.Field>
              <form.Field name="idExpiresOn">
                {(field) => {
                  const note = expiryNote(field.state.value, today);
                  return (
                    <div>
                      <PartnerField
                        id={`${formId}-expiry`}
                        label="Expiry date"
                        hint={expiryHint(document)}
                        error={errorFor('idExpiresOn', field.state.meta.isBlurred)}
                      >
                        {(control) => (
                          <input
                            {...control}
                            type="date"
                            name="idExpiresOn"
                            value={field.state.value}
                            onChange={(event) => {
                              field.handleChange(event.target.value);
                              setServerErrors((current) => ({
                                ...current,
                                idExpiresOn: undefined,
                              }));
                            }}
                            onBlur={field.handleBlur}
                            className={cnInput('tabular-nums')}
                          />
                        )}
                      </PartnerField>
                      {note && !errorFor('idExpiresOn', field.state.meta.isBlurred) ? (
                        <p className="mt-2 flex gap-1.5 text-body-5 text-foreground">
                          <TriangleAlert
                            className="mt-0.5 size-4 shrink-0 text-warning-mark"
                            aria-hidden
                          />
                          {note}
                        </p>
                      ) : null}
                    </div>
                  );
                }}
              </form.Field>
              <UploadField
                kind="id"
                documentType={document}
                value={uploads.idPhoto}
                recheck={recheckUploads}
                error={errorFor('idDocumentUploadId')}
                focusRef={idPhotoFocus}
                examples={<IdExamples />}
                onError={(message) =>
                  setUploadErrors((current) => ({ ...current, idPhoto: message }))
                }
                onChange={(next) => {
                  setUploads((current) => ({ ...current, idPhoto: next }));
                  setServerErrors((current) => ({ ...current, idDocumentUploadId: undefined }));
                }}
              />
            </>
          ) : null}

          {step === 4 ? (
            <>
              <div className="space-y-3">
                <SummaryCard
                  title="About you"
                  editLabel="Edit about you"
                  onEdit={() => {
                    setReturnToCheck(true);
                    goTo(1);
                  }}
                >
                  <div className="flex items-start gap-3">
                    <Thumb url={uploads.photo?.url ?? null} round />
                    <div className="min-w-0">
                      <p className="text-body-4 text-strong [overflow-wrap:anywhere]">{name}</p>
                      <InlineNameEditor
                        compact
                        name={name}
                        accountPhone={props.accountPhone}
                        onSaved={setName}
                        hint="Use your name exactly as it is on your ID."
                      />
                    </div>
                  </div>
                  <SummaryRow label="Mobile phone" value={values.phone} />
                </SummaryCard>
                <SummaryCard
                  title="Your vehicle"
                  editLabel="Edit your vehicle"
                  onEdit={() => {
                    setReturnToCheck(true);
                    goTo(2);
                  }}
                >
                  <p className="text-body-4 text-strong">
                    {values.vehicleType
                      ? plateNeeded
                        ? `${VEHICLE_WORDS[values.vehicleType]} · ${normalizePlate(values.plate) ?? values.plate}`
                        : VEHICLE_WORDS[values.vehicleType]
                      : '—'}
                  </p>
                </SummaryCard>
                <SummaryCard
                  title="Your ID"
                  editLabel="Edit your ID"
                  onEdit={() => {
                    setReturnToCheck(true);
                    goTo(3);
                  }}
                >
                  <div className="flex items-start gap-3">
                    <Thumb url={uploads.idPhoto?.url ?? null} />
                    <p className="min-w-0 text-body-4 text-strong">
                      {DOCUMENT_WORDS[document]}
                      {last4 ? ` ending ${last4}` : ''}
                      {values.idExpiresOn
                        ? ` · expires ${new Date(`${values.idExpiresOn}T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' })}`
                        : ''}
                    </p>
                  </div>
                </SummaryCard>
              </div>

              {editing && application ? (
                <div className="space-y-2 text-body-4 text-foreground">
                  <p className="flex items-start gap-2">
                    <CircleCheck className="mt-0.5 size-4 shrink-0 text-success-mark" aria-hidden />
                    {agreedLine(application.terms.version, application.terms.acceptedAt, timeZone)}
                  </p>
                  <p className="flex items-start gap-2">
                    <CircleCheck className="mt-0.5 size-4 shrink-0 text-success-mark" aria-hidden />
                    Confirmed you&apos;re 18 or older
                  </p>
                </div>
              ) : (
                <fieldset className="min-w-0">
                  <legend className="text-body-4 font-medium text-strong">Before you send</legend>
                  <div className="mt-2 space-y-1">
                    <form.Field name="adult">
                      {(field) => (
                        <PartnerCheckbox
                          id={`${formId}-adult`}
                          checked={field.state.value}
                          error={errorFor('adult')}
                          onChange={(checked) => field.handleChange(checked)}
                        >
                          I&apos;m 18 or older.
                        </PartnerCheckbox>
                      )}
                    </form.Field>
                    <form.Field name="agreeTerms">
                      {(field) => (
                        <PartnerCheckbox
                          id={`${formId}-terms`}
                          checked={field.state.value}
                          error={errorFor('agreeTerms')}
                          onChange={(checked) => field.handleChange(checked)}
                        >
                          I agree to the Foodz Partner Terms
                        </PartnerCheckbox>
                      )}
                    </form.Field>
                    <Link
                      ref={termsLinkRef}
                      href="/partner/terms"
                      onClick={(event) => {
                        event.preventDefault();
                        setTermsOpen(true);
                      }}
                      className="inline-flex h-12 items-center text-button-2 font-medium text-primary underline underline-offset-4"
                    >
                      Read the Partner Terms
                    </Link>
                  </div>
                </fieldset>
              )}
              <p className="text-body-5 text-muted-foreground">
                We use your location only while you&apos;re online.{' '}
                <Link
                  href="/privacy"
                  className="font-medium text-strong underline underline-offset-4"
                >
                  Read the Privacy Policy
                </Link>
                .
              </p>
              {editing ? null : (
                <Turnstile
                  ref={turnstileRef}
                  action="partner-apply"
                  theme={resolved}
                  onChallenge={setChallenge}
                  challengeClassName="mb-3 text-body-5 text-foreground"
                />
              )}
            </>
          ) : null}
        </div>
      </form>

      <PartnerTermsSheet
        open={termsOpen}
        terms={props.terms}
        timeZone={timeZone}
        onOpenChange={setTermsOpen}
        onCloseFocus={() => termsLinkRef.current?.focus()}
      />
      <LeaveDialog
        open={leaving}
        onOpenChange={setLeaving}
        onLeave={() => router.push('/partner')}
      />
    </PartnerFrame>
  );
}

function WithdrawnAlert({ onDismiss }: { onDismiss: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  useEffect(() => {
    ref.current?.focus();
    announce("Application withdrawn. We've deleted your photos and ID details.");
    router.replace('/partner/apply', { scroll: false });
  }, [router]);
  return (
    <div ref={ref} tabIndex={-1} className="outline-none">
      <FormAlert
        variant="success"
        tone="partner"
        action={
          <Button
            type="button"
            variant="ghost"
            size="kitchen"
            className="-ml-3 text-strong underline underline-offset-4"
            onClick={onDismiss}
          >
            Dismiss
          </Button>
        }
      >
        Application withdrawn. We&apos;ve deleted your photos and ID details.
      </FormAlert>
    </div>
  );
}

function SummaryCard({
  title,
  editLabel,
  onEdit,
  children,
}: {
  title: string;
  editLabel: string;
  onEdit: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-body-3 font-semibold text-strong">{title}</h2>
        <Button
          type="button"
          variant="ghost"
          size="kitchen"
          className="-mr-3 text-strong"
          onClick={onEdit}
        >
          Edit<span className="sr-only">{editLabel.replace(/^Edit/, '')}</span>
        </Button>
      </div>
      {children}
    </section>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <p className="text-body-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-strong"> · {value || '—'}</span>
    </p>
  );
}

function Thumb({ url, round = false }: { url: string | null; round?: boolean }) {
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center overflow-hidden border border-border bg-muted',
        round ? 'size-14 rounded-full' : 'aspect-[1.586] h-10 rounded',
      )}
    >
      {url ? (
        // A 5-minute private link to the checked image.
        // oxlint-disable-next-line nextjs/no-img-element
        <img src={url} alt="" referrerPolicy="no-referrer" className="size-full object-cover" />
      ) : null}
    </span>
  );
}

function LeaveDialog({
  open,
  onOpenChange,
  onLeave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLeave: () => void;
}) {
  const keepRef = useRef<HTMLButtonElement>(null);
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent
        className="border border-border bg-card text-foreground"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          keepRef.current?.focus();
        }}
      >
        <AlertDialogTitle className="font-heading text-title-2 text-strong">
          Leave without saving?
        </AlertDialogTitle>
        <AlertDialogDescription className="mt-3 text-body-4 text-foreground">
          Your changes are kept on this phone for 24 hours.
        </AlertDialogDescription>
        <div className="mt-6 flex flex-col-reverse gap-3">
          <Button
            ref={keepRef}
            type="button"
            variant="outline"
            size="kitchen"
            onClick={() => onOpenChange(false)}
          >
            Keep editing
          </Button>
          <Button type="button" size="kitchen" onClick={onLeave}>
            Leave
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
