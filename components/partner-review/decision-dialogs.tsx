'use client';

import { revalidateLogic, useForm, useStore } from '@tanstack/react-form';
import { useQuery } from '@tanstack/react-query';
import { Info, Plus, TriangleAlert } from 'lucide-react';
import { type ReactNode, useEffect, useEffectEvent, useId, useRef, useState } from 'react';
import type { z } from 'zod';
import {
  approvePartnerAction,
  partnerVersionAction,
  reinstatePartnerAction,
  rejectPartnerAction,
  reopenPartnerAction,
  sendBackPartnerAction,
  suspendPartnerAction,
} from '@/server/modules/partners/review-actions';
import {
  approveInput,
  type DecisionResult,
  type PartnerReview,
  type PartnerVersion,
  REVIEW_TEXT_MAX,
  type ReviewAction,
  type ReviewActor,
  reinstateInput,
  rejectInput,
  reopenInput,
  sendBackInput,
  suspendInput,
} from '@/server/modules/partners/review-schema';
import { flagSentence } from '@/server/modules/partners/review-state';
import type { ChangedPart, IdDocumentType } from '@/server/modules/partners/rules';
import { ActionDialog } from '@/components/board/dialogs/action-dialog';
import {
  focusFirstProblem,
  OutcomeBox,
  StaffNoteField,
  TickRow,
  zodFieldErrors,
} from '@/components/board/dialogs/dialog-fields';
import { type StepUpMethod, StepUpField } from '@/components/board/dialogs/step-up-field';
import { FormAlert } from '@/components/forms/form-alert';
import { useSlowPending } from '@/components/forms/submit-button';
import { FieldError } from '@/components/ui/field';
import { type ActionFailure, callAction } from '@/lib/action-result';
import { announce } from '@/lib/announce';
import { stepUpLockedText } from '@/lib/board/text';
import {
  alreadySentBackRefusal,
  approveOutcome,
  BANNED_APPROVE,
  BANNED_SUSPEND,
  type DecidedHow,
  decidedConflict,
  DEMO_PARTNER_REFUSAL,
  DIALOG_TITLES,
  editedConflict,
  filesDeletedRefusal,
  goneText,
  idExpiredRefusal,
  imageNotReadyRefusal,
  reapplyFromToday,
  REJECT_STARTERS,
  rejectHint,
  rejectOutcome,
  reinstateOutcome,
  reopenOutcome,
  SEND_BACK_STARTERS,
  sendBackHint,
  sendBackInsteadText,
  sendBackOutcome,
  STEP_UP_HINT,
  STEP_UP_PROMPT,
  suspendHint,
  suspendOutcome,
  suspendReasonLabel,
  withStarter,
} from '@/lib/partner-review/text';
import { cn } from '@/lib/utils';
import { ReadError } from './queries';

/*
 * The six decisions (F6 design 10) on F5's dialog frame: a version check as each opens, the
 * "what will happen" box, the note for staff, the step-up code for approve, suspend and
 * reinstate, and conflicts shown in place before anything is sent (A26). Text typed is kept for
 * this page and comes back if the dialog is reopened.
 */

export interface DialogDraft {
  text: string;
  note: string;
}

export const EMPTY_DRAFT: DialogDraft = { text: '', note: '' };

export interface DecisionDialogProps {
  action: ReviewAction;
  review: PartnerReview;
  timeZone: string;
  offline: boolean;
  draft: DialogDraft;
  onDraft: (draft: DialogDraft) => void;
  onClose: () => void;
  onCloseFocus?: () => boolean;
  onFinished: (action: ReviewAction, result: DecisionResult) => void;
  onSignedOut: () => void;
  /** "Check the changes": close, refetch and mark the changes. */
  onCheckChanges: () => void;
  /** "Back to partners" after a withdrawal. */
  onBackToList: () => void;
  /** Reject's "Send back instead", carrying the reason and the note over. */
  onSendBackInstead?: (draft: DialogDraft) => void;
}

// ------------------------------------------------------------------ reading refusals

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const DECIDED = new Set<string>([
  'approved',
  'rejected',
  'sent-back',
  'suspended',
  'reinstated',
  'reopened',
]);

const isDecidedHow = (value: unknown): value is DecidedHow =>
  typeof value === 'string' && DECIDED.has(value);

function actorOf(value: unknown): ReviewActor {
  if (isRecord(value) && value.kind === 'staff') {
    return {
      kind: 'staff',
      name: typeof value.name === 'string' ? value.name : null,
      role: value.role === 'admin' ? 'admin' : 'support',
    };
  }
  return isRecord(value) && value.kind === 'applicant' ? { kind: 'applicant' } : { kind: 'system' };
}

const partsOf = (value: unknown): ChangedPart[] =>
  Array.isArray(value)
    ? value.filter(
        (part): part is ChangedPart =>
          typeof part === 'string' &&
          [
            'photo',
            'idPhoto',
            'vehicle',
            'plate',
            'idType',
            'idNumber',
            'idExpiry',
            'phone',
          ].includes(part),
      )
    : [];

const text = (value: unknown) => (typeof value === 'string' ? value : null);

type Conflict =
  | { kind: 'edited'; text: string }
  | { kind: 'decided'; text: string }
  | { kind: 'gone'; text: string };

/** The dialog body for a changed or gone application (design 10.9), or null. */
function conflictOf(
  change: { how: unknown; by: unknown; at: unknown; changedParts: unknown },
  review: PartnerReview,
  timeZone: string,
): Conflict | null {
  const at = text(change.at);
  if (!at) return null;
  if (change.how === 'edited') {
    return {
      kind: 'edited',
      text: editedConflict(review.name, at, partsOf(change.changedParts), timeZone),
    };
  }
  if (isDecidedHow(change.how)) {
    return { kind: 'decided', text: decidedConflict(change.how, actorOf(change.by), at, timeZone) };
  }
  return null;
}

/** The refusal's words in the dialog's alert, by code (design 10.2 to 10.7). */
function refusalText(action: ReviewAction, failure: ActionFailure, review: PartnerReview): string {
  const details = failure.details ?? {};
  const first = review.firstName;
  switch (failure.code) {
    case 'ID_EXPIRED': {
      const expiredOn = text(details.expiredOn);
      const type = text(details.documentType);
      const documentType: IdDocumentType =
        type === 'STATE_ID' || type === 'PASSPORT' ? type : 'DRIVER_LICENSE';
      return expiredOn ? idExpiredRefusal(first, documentType, expiredOn) : failure.message;
    }
    case 'IMAGE_NOT_READY':
      return imageNotReadyRefusal(
        first,
        details.image === 'photo' ? 'photo' : 'idFront',
        details.kind === 'missing' ? 'missing' : 'checking',
      );
    case 'ACCOUNT_BANNED':
      return action === 'approve' ? BANNED_APPROVE : BANNED_SUSPEND;
    case 'DEMO_PARTNER':
      return DEMO_PARTNER_REFUSAL;
    case 'ALREADY_SENT_BACK':
      return alreadySentBackRefusal(first);
    case 'FILES_DELETED': {
      const deletedOn = text(details.deletedOn);
      return deletedOn ? filesDeletedRefusal(first, deletedOn) : failure.message;
    }
    default:
      return failure.message;
  }
}

const retryAtOf = (failure: ActionFailure) => text(failure.details?.retryAt);

/** The schema's field names on this form's fields: message and reason are "text". */
function formFields(errors: Record<string, string> | null): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const [key, message] of Object.entries(errors ?? {})) {
    if (key === 'message' || key === 'reason') fields.text = message;
    else if (key === 'staffNote') fields.note = message;
    else if (key === 'flagsChecked') fields.flagsChecked = message;
  }
  return fields;
}

// ------------------------------------------------------------------ shared fields

/** "What needs fixing", "Reason for the applicant (optional)": 4 rows growing to 8, 0/500. */
function ReviewTextField({
  id,
  label,
  hint,
  value,
  error,
  onChange,
  onBlur,
  fieldRef,
}: {
  id: string;
  label: string;
  hint: string;
  value: string;
  error: string | null;
  onChange: (value: string) => void;
  onBlur: () => void;
  fieldRef?: React.Ref<HTMLTextAreaElement>;
}) {
  const hintId = `${id}-hint`;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div>
      <label htmlFor={id} className="block text-body-4 font-medium text-neutral-1">
        {label}
      </label>
      <textarea
        ref={fieldRef}
        id={id}
        value={value}
        rows={4}
        maxLength={REVIEW_TEXT_MAX * 2}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        aria-invalid={error ? true : undefined}
        aria-describedby={[hintId, errorId].filter(Boolean).join(' ')}
        className="mt-2 field-sizing-content max-h-[13rem] min-h-[7.25rem] w-full rounded-xl border border-input bg-white px-4 py-3 text-body-4 text-neutral-1 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid aria-invalid:border-destructive"
      />
      <div className="mt-2 flex items-start justify-between gap-3">
        <p id={hintId} className="text-body-5 text-muted-foreground">
          {hint}
        </p>
        <span
          aria-hidden
          className={cn(
            'text-caption tabular-nums',
            value.length > REVIEW_TEXT_MAX ? 'text-destructive' : 'text-neutral-3',
          )}
        >
          {value.length}/{REVIEW_TEXT_MAX}
        </span>
      </div>
      <FieldError id={errorId}>{error}</FieldError>
    </div>
  );
}

/** "Common requests", "Common reasons": a sentence fills an empty field or adds a line (D28). */
function StarterButtons({
  label,
  starters,
  onPick,
}: {
  label: string;
  starters: readonly string[];
  onPick: (starter: string) => void;
}) {
  const id = useId();
  return (
    <fieldset className="mx-0 min-w-0 border-0 p-0">
      <legend id={id} className="text-body-5 font-medium text-neutral-2">
        {label}
      </legend>
      <div className="mt-2 flex flex-col gap-2">
        {starters.map((starter) => (
          <button
            key={starter}
            type="button"
            onClick={() => onPick(starter)}
            className="inline-flex min-h-12 w-full items-start gap-2 rounded-lg border border-neutral-6 bg-white px-3 py-2.5 text-left text-body-5 whitespace-normal text-neutral-1 outline-none hover:bg-neutral-7 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid"
          >
            <Plus className="mt-0.5 size-4 shrink-0 text-neutral-3" aria-hidden />
            {starter}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function FooterNote({ tone, children }: { tone: 'info' | 'warning'; children: ReactNode }) {
  return tone === 'info' ? (
    <p className="flex gap-2 text-body-5 text-neutral-3">
      <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
      {children}
    </p>
  ) : (
    <p className="flex items-center gap-2 text-body-5 font-medium text-neutral-1">
      <TriangleAlert className="size-4 shrink-0 text-destructive" aria-hidden />
      {children}
    </p>
  );
}

// ------------------------------------------------------------------ the dialog

const SCHEMAS: Record<ReviewAction, z.ZodType> = {
  approve: approveInput,
  sendBack: sendBackInput,
  reject: rejectInput,
  suspend: suspendInput,
  reinstate: reinstateInput,
  reopen: reopenInput,
};

const LABELS: Record<
  ReviewAction,
  { safe: string; action: string; pending: string; danger: boolean }
> = {
  approve: { safe: 'Keep reviewing', action: 'Approve', pending: 'Approving…', danger: false },
  sendBack: {
    safe: 'Keep reviewing',
    action: 'Send back',
    pending: 'Sending back…',
    danger: false,
  },
  reject: { safe: 'Keep reviewing', action: 'Reject', pending: 'Rejecting…', danger: true },
  suspend: { safe: 'Keep partner', action: 'Suspend', pending: 'Suspending…', danger: true },
  reinstate: {
    safe: 'Keep suspended',
    action: 'Reinstate',
    pending: 'Reinstating…',
    danger: false,
  },
  reopen: { safe: 'Keep rejected', action: 'Reopen', pending: 'Reopening…', danger: false },
};

const NEEDS_CODE: ReadonlySet<ReviewAction> = new Set(['approve', 'suspend', 'reinstate']);

/** Sends the decision, shaped by the module's schema first. */
function send(action: ReviewAction, input: Record<string, unknown>) {
  switch (action) {
    case 'approve': {
      const parsed = approveInput.safeParse(input);
      return parsed.success
        ? callAction(() => approvePartnerAction(parsed.data))
        : unparsed(parsed);
    }
    case 'sendBack': {
      const parsed = sendBackInput.safeParse(input);
      return parsed.success
        ? callAction(() => sendBackPartnerAction(parsed.data))
        : unparsed(parsed);
    }
    case 'reject': {
      const parsed = rejectInput.safeParse(input);
      return parsed.success ? callAction(() => rejectPartnerAction(parsed.data)) : unparsed(parsed);
    }
    case 'suspend': {
      const parsed = suspendInput.safeParse(input);
      return parsed.success
        ? callAction(() => suspendPartnerAction(parsed.data))
        : unparsed(parsed);
    }
    case 'reinstate': {
      const parsed = reinstateInput.safeParse(input);
      return parsed.success
        ? callAction(() => reinstatePartnerAction(parsed.data))
        : unparsed(parsed);
    }
    default: {
      const parsed = reopenInput.safeParse(input);
      return parsed.success ? callAction(() => reopenPartnerAction(parsed.data)) : unparsed(parsed);
    }
  }
}

function unparsed(parsed: { error: z.ZodError }) {
  const codeIssue = parsed.error.issues.find((issue) => issue.path[0] === 'stepUp');
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of parsed.error.issues) {
    const key = String(issue.path[0] ?? '');
    if (key) fieldErrors[key] = [...(fieldErrors[key] ?? []), issue.message];
  }
  return Promise.resolve({
    ok: false as const,
    error: codeIssue
      ? {
          code: 'STEP_UP_INVALID',
          message: codeIssue.message,
          fieldErrors: { stepUp: [codeIssue.message] },
        }
      : { code: 'INVALID_INPUT', message: 'Check the highlighted fields.', fieldErrors },
  });
}

export function DecisionDialog({
  action,
  review,
  timeZone,
  offline,
  draft,
  onDraft,
  onClose,
  onCloseFocus,
  onFinished,
  onSignedOut,
  onCheckChanges,
  onBackToList,
  onSendBackInstead,
}: DecisionDialogProps) {
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [pending, setPending] = useState(false);
  // The reject outcome's date: the store's today plus 30 days, read once as the dialog opens.
  const [reapplyFrom] = useState(() => reapplyFromToday(new Date(), timeZone));
  const [alert, setAlert] = useState<{ tone: 'error' | 'info' | 'warning'; text: string } | null>(
    null,
  );
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [stepUp, setStepUp] = useState<{ shown: boolean; method: StepUpMethod; code: string }>({
    shown: NEEDS_CODE.has(action) && review.stepUpRequired,
    method: 'totp',
    code: '',
  });
  const [codeError, setCodeError] = useState<string | null>(null);
  const [lockedUntil, setLockedUntil] = useState<string | null>(null);
  const labels = LABELS[action];
  const first = review.firstName;

  // A26.5: the current version, asked for as the dialog opens.
  const check = useQuery<PartnerVersion>({
    queryKey: ['partners', 'version', review.partnerId, action],
    queryFn: async () => {
      const outcome = await callAction(() => partnerVersionAction({ partnerId: review.partnerId }));
      if (!outcome.ok) throw new ReadError(outcome.error);
      return outcome.data;
    },
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  const checking = check.isPending;
  const slowCheck = useSlowPending(checking);

  const showAlert = (next: { tone: 'error' | 'info' | 'warning'; text: string }) => {
    setAlert(next);
    requestAnimationFrame(() => alertRef.current?.focus());
    announce(next.text);
  };

  const showConflict = (next: Conflict) => {
    setConflict(next);
    requestAnimationFrame(() => alertRef.current?.focus());
    announce(next.text);
  };

  // A stale answer turns the dialog into the conflict before anything is sent (10.9).
  const readCheck = useEffectEvent(() => {
    if (check.data && check.data.version !== review.version && check.data.lastChange) {
      const found = conflictOf(check.data.lastChange, review, timeZone);
      if (found) showConflict(found);
      return;
    }
    const failure = check.error instanceof ReadError ? check.error.failure : null;
    if (failure?.code === 'APPLICATION_GONE') {
      const how = failure.details?.how === 'account-deleted' ? 'account-deleted' : 'withdrawn';
      const at = text(failure.details?.at);
      if (at) showConflict({ kind: 'gone', text: goneText(how, review.name, at, timeZone) });
    } else if (failure?.code === 'UNAUTHENTICATED') {
      onSignedOut();
    }
  });
  useEffect(() => {
    if (!check.data && !check.error) return undefined;
    const timer = setTimeout(readCheck, 0);
    return () => clearTimeout(timer);
  }, [check.data, check.error]);

  const version = check.data?.version ?? review.version;
  const online = check.data?.online ?? null;

  const form = useForm({
    defaultValues: { text: draft.text, note: draft.note, flagsChecked: false },
    validationLogic: revalidateLogic({ mode: 'submit', modeAfterSubmission: 'change' }),
    validators: {
      onDynamic: ({ value }) => {
        const fields = formFields(zodFieldErrors(SCHEMAS[action], inputOf(value)));
        if (action === 'approve' && review.flags.length > 0 && !value.flagsChecked) {
          fields.flagsChecked = 'Check this box to approve an application with flags.';
        }
        return Object.keys(fields).length ? { fields } : undefined;
      },
    },
    onSubmitInvalid: () => focusFirstProblem(formRef.current),
    onSubmit: async ({ value }) => {
      if (pending) return;
      setPending(true);
      setServerErrors({});
      setAlert(null);
      const input = {
        ...inputOf(value),
        ...(NEEDS_CODE.has(action) && stepUp.shown && stepUp.code
          ? { stepUp: { method: stepUp.method, code: stepUp.code } }
          : {}),
      };
      const outcome = await send(action, input);
      setPending(false);
      if (outcome.ok) {
        onFinished(action, outcome.data);
        return;
      }
      handleFailure(outcome.error);
    },
  });

  function inputOf(value: { text: string; note: string; flagsChecked: boolean }) {
    const base = { partnerId: review.partnerId, expectedVersion: version };
    const note = value.note.trim() ? { staffNote: value.note } : {};
    switch (action) {
      case 'approve':
        return { ...base, flagsChecked: value.flagsChecked, ...note };
      case 'sendBack':
        return { ...base, message: value.text, ...note };
      case 'reject':
        return { ...base, ...(value.text.trim() ? { reason: value.text } : {}), ...note };
      case 'suspend':
        return { ...base, ...(value.text.trim() ? { reason: value.text } : {}), ...note };
      case 'reinstate':
        return { ...base, ...note };
      default:
        return { ...base, staffNote: value.note };
    }
  }

  function handleFailure(failure: ActionFailure) {
    const details = failure.details ?? {};
    switch (failure.code) {
      case 'UNAUTHENTICATED':
        onSignedOut();
        onClose();
        return;
      case 'APPLICATION_CHANGED': {
        const found = conflictOf(
          { how: details.how, by: details.by, at: details.at, changedParts: details.changedParts },
          review,
          timeZone,
        );
        if (found) {
          showConflict(found);
          return;
        }
        break;
      }
      case 'APPLICATION_GONE': {
        const at = text(details.at);
        if (at) {
          showConflict({
            kind: 'gone',
            text: goneText(
              details.how === 'account-deleted' ? 'account-deleted' : 'withdrawn',
              review.name,
              at,
              timeZone,
            ),
          });
          return;
        }
        break;
      }
      case 'INVALID_STATE':
      case 'ALREADY_SENT_BACK':
        showConflict({ kind: 'decided', text: refusalText(action, failure, review) });
        return;
      case 'STEP_UP_REQUIRED':
        setStepUp((current) => ({ ...current, shown: true }));
        requestAnimationFrame(() => {
          codeRef.current?.focus();
          announce(STEP_UP_PROMPT);
        });
        return;
      case 'STEP_UP_INVALID':
        setCodeError(failure.fieldErrors?.stepUp?.[0] ?? failure.message);
        requestAnimationFrame(() => codeRef.current?.focus());
        return;
      case 'STEP_UP_LOCKED': {
        const retryAt = retryAtOf(failure);
        setLockedUntil(retryAt ?? 'locked');
        showAlert({
          tone: 'error',
          text: retryAt ? stepUpLockedText(retryAt, timeZone) : failure.message,
        });
        return;
      }
      case 'FLAGS_NOT_CHECKED':
        setServerErrors({ flagsChecked: 'Check this box to approve an application with flags.' });
        focusFirstProblem(formRef.current);
        return;
      case 'INVALID_INPUT': {
        const fields = Object.fromEntries(
          Object.entries(failure.fieldErrors ?? {}).map(([key, messages]) => [
            key,
            messages[0] ?? '',
          ]),
        );
        if (fields.stepUp) setCodeError(fields.stepUp);
        setServerErrors(formFields(fields));
        focusFirstProblem(formRef.current);
        return;
      }
      default:
        break;
    }
    showAlert({ tone: 'error', text: refusalText(action, failure, review) });
  }

  // Typed text is kept for this page (A26.2).
  const values = useStore(form.store, (state) => state.values);
  const keepDraft = useEffectEvent((next: DialogDraft) => onDraft(next));
  useEffect(() => {
    keepDraft({ text: values.text, note: values.note });
  }, [values.text, values.note]);

  const submitted = useStore(form.store, (state) => state.submissionAttempts > 0);
  const errorOf = (name: string, errors: readonly unknown[]) => {
    const firstError = errors.find((error) => typeof error === 'string');
    return (
      (submitted && typeof firstError === 'string' ? firstError : null) ??
      serverErrors[name] ??
      null
    );
  };

  const blockedReason = offline
    ? "You're offline."
    : lockedUntil
      ? (alert?.text ?? null)
      : checking && slowCheck
        ? 'Checking for changes…'
        : null;
  const blocked = offline || Boolean(lockedUntil) || checking;

  const conflictNode = conflict ? (
    <div ref={alertRef} tabIndex={-1} className="outline-none">
      <FormAlert variant={conflict.kind === 'edited' ? 'warning' : 'info'}>
        {conflict.text}
      </FormAlert>
    </div>
  ) : null;

  if (conflict) {
    const edited = conflict.kind === 'edited';
    const gone = conflict.kind === 'gone';
    return (
      <ActionDialog
        open
        title={DIALOG_TITLES[action](review.name)}
        pending={false}
        safeLabel="Close"
        actionLabel={edited ? 'Check the changes' : 'Back to partners'}
        pendingLabel=""
        closeOnly={!edited && !gone}
        onClose={onClose}
        onCloseFocus={onCloseFocus}
        onSubmit={edited ? onCheckChanges : onBackToList}
      >
        {conflictNode}
      </ActionDialog>
    );
  }

  const flagSentences = review.flags.map((flag) => flagSentence(flag, timeZone));

  const outcome: Record<ReviewAction, readonly string[] | null> = {
    approve: approveOutcome(first),
    sendBack: [sendBackOutcome(first)],
    reject: rejectOutcome(first, reapplyFrom),
    suspend: online === null ? null : suspendOutcome(first, online),
    reinstate: [reinstateOutcome(first)],
    reopen: [reopenOutcome(first)],
  };
  const outcomeLines = outcome[action];

  const footerNote =
    action === 'approve' ? (
      <FooterNote tone="info">To take an approval back later, suspend the partner.</FooterNote>
    ) : action === 'suspend' ? (
      <FooterNote tone="warning">This takes effect at once.</FooterNote>
    ) : undefined;

  const textField = (field: 'sendBack' | 'reject' | 'suspend') => (
    <form.Field name="text">
      {(fieldApi) => {
        const props = {
          sendBack: { label: 'What needs fixing', hint: sendBackHint(first) },
          reject: { label: 'Reason for the applicant (optional)', hint: rejectHint(first) },
          suspend: { label: suspendReasonLabel(first), hint: suspendHint(first) },
        }[field];
        return (
          <ReviewTextField
            id={`${id}-text`}
            fieldRef={textRef}
            label={props.label}
            hint={props.hint}
            value={fieldApi.state.value}
            error={errorOf('text', fieldApi.state.meta.errors)}
            onChange={(value) => {
              fieldApi.handleChange(value);
              setServerErrors((current) => ({ ...current, text: '' }));
            }}
            onBlur={fieldApi.handleBlur}
          />
        );
      }}
    </form.Field>
  );

  const pickStarter = (starter: string, what: 'message' | 'reason') => {
    form.setFieldValue('text', (value) => withStarter(value, starter));
    requestAnimationFrame(() => {
      const field = textRef.current;
      if (!field) return;
      field.focus();
      field.setSelectionRange(field.value.length, field.value.length);
    });
    announce(what === 'message' ? 'Added to the message' : 'Added to the reason');
  };

  return (
    <ActionDialog
      open
      title={DIALOG_TITLES[action](review.name)}
      pending={pending}
      safeLabel={labels.safe}
      actionLabel={labels.action}
      pendingLabel={labels.pending}
      danger={labels.danger}
      blocked={blocked}
      blockedReason={blockedReason}
      formRef={formRef}
      footerNote={footerNote}
      onClose={onClose}
      onCloseFocus={onCloseFocus}
      onSubmit={() => void form.handleSubmit()}
    >
      {alert ? (
        <div ref={alertRef} tabIndex={-1} className="outline-none">
          <FormAlert variant={alert.tone}>{alert.text}</FormAlert>
        </div>
      ) : null}

      {action === 'approve' && review.flags.length > 0 ? (
        <section aria-labelledby={`${id}-flags`}>
          <h3 id={`${id}-flags`} className="text-body-5 font-semibold text-neutral-1">
            Flags
          </h3>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-body-5 text-neutral-1">
            {flagSentences.map((sentence) => (
              <li key={sentence}>{sentence}</li>
            ))}
          </ul>
          <form.Field name="flagsChecked">
            {(fieldApi) => {
              const error = errorOf('flagsChecked', fieldApi.state.meta.errors);
              return (
                <div className="mt-3">
                  <TickRow
                    id={`${id}-flags-checked`}
                    checked={fieldApi.state.value}
                    invalid={Boolean(error)}
                    describedBy={error ? `${id}-flags-error` : undefined}
                    onChange={(checked) => {
                      fieldApi.handleChange(checked);
                      setServerErrors((current) => ({ ...current, flagsChecked: '' }));
                    }}
                  >
                    I&apos;ve checked these flags
                  </TickRow>
                  <FieldError id={`${id}-flags-error`}>{error}</FieldError>
                </div>
              );
            }}
          </form.Field>
        </section>
      ) : null}

      {action === 'sendBack' ? (
        <>
          {textField('sendBack')}
          <StarterButtons
            label="Common requests"
            starters={SEND_BACK_STARTERS}
            onPick={(starter) => pickStarter(starter, 'message')}
          />
        </>
      ) : null}

      {action === 'reject' ? (
        <>
          {textField('reject')}
          <StarterButtons
            label="Common reasons"
            starters={REJECT_STARTERS}
            onPick={(starter) => pickStarter(starter, 'reason')}
          />
          {onSendBackInstead &&
          review.actions.some(
            (state) => state.action === 'sendBack' && state.display === 'button' && state.enabled,
          ) ? (
            <div className="flex gap-2 rounded-xl bg-tag-3-bg p-4 text-body-5 text-neutral-1">
              <Info className="mt-0.5 size-4 shrink-0 text-tag-3" aria-hidden />
              <div>
                <p>{sendBackInsteadText(first)}</p>
                <button
                  type="button"
                  onClick={() =>
                    onSendBackInstead({
                      text: form.state.values.text,
                      note: form.state.values.note,
                    })
                  }
                  className="mt-3 inline-flex h-11 items-center rounded-lg border border-border bg-white px-4 text-button-1 font-medium text-neutral-1 outline-none hover:bg-neutral-7 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid"
                >
                  Send back instead
                </button>
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      {action === 'suspend' ? textField('suspend') : null}

      <form.Field name="note">
        {(fieldApi) => (
          <StaffNoteField
            required={action === 'reopen'}
            hint={
              action === 'reopen'
                ? "Why you're reopening it"
                : action === 'reinstate'
                  ? "Why you're reinstating this partner"
                  : undefined
            }
            value={fieldApi.state.value}
            error={errorOf('note', fieldApi.state.meta.errors)}
            onChange={(note) => {
              fieldApi.handleChange(note);
              setServerErrors((current) => ({ ...current, note: '' }));
            }}
            onBlur={fieldApi.handleBlur}
          />
        )}
      </form.Field>

      {outcomeLines ? (
        <OutcomeBox lines={outcomeLines} />
      ) : (
        <div aria-busy className="h-14 rounded-xl bg-neutral-7 motion-safe:animate-skeleton">
          <span className="sr-only">Loading what will happen</span>
        </div>
      )}

      {NEEDS_CODE.has(action) && stepUp.shown ? (
        <StepUpField
          method={stepUp.method}
          value={stepUp.code}
          error={codeError}
          disabled={Boolean(lockedUntil)}
          inputRef={codeRef}
          hint={STEP_UP_HINT}
          onChange={(code) => {
            setStepUp((current) => ({ ...current, code }));
            setCodeError(null);
          }}
          onSwap={() =>
            setStepUp((current) => ({
              ...current,
              method: current.method === 'totp' ? 'backup' : 'totp',
              code: '',
            }))
          }
        />
      ) : null}
    </ActionDialog>
  );
}
