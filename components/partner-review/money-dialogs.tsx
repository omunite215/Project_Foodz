'use client';

import { revalidateLogic, useForm, useStore } from '@tanstack/react-form';
import { useQuery } from '@tanstack/react-query';
import { CircleMinus, CirclePlus, Info, Smartphone } from 'lucide-react';
import { type ReactNode, type RefObject, useEffect, useId, useRef, useState } from 'react';
import {
  adjustEarningsAction,
  openMoneyDialogAction,
  recordCashHandInAction,
  recordPayoutAction,
} from '@/server/modules/earnings/actions';
import {
  ADJUST_REASONS,
  type AdjustReason,
  adjustEarningsInput,
  EARNINGS_LIMITS,
  type LedgerChangedDetails,
  type MoneyActionResult,
  type MoneyDialogKind,
  type MoneyDialogOpening,
  parseAmountText,
  PAYOUT_METHODS,
  type PayoutMethod,
  recordCashInput,
  recordPayoutInput,
} from '@/server/modules/earnings/schema';
import { METHOD_WORDS } from '@/server/modules/earnings/text';
import { storeDate } from '@/server/modules/partners/text';
import { showBoardNotice } from '@/components/admin/board-notices';
import { ActionDialog } from '@/components/board/dialogs/action-dialog';
import {
  focusFirstProblem,
  OutcomeBox,
  ReasonFieldset,
  StaffNoteField,
} from '@/components/board/dialogs/dialog-fields';
import { type StepUpMethod, StepUpField } from '@/components/board/dialogs/step-up-field';
import { ChoiceChips } from '@/components/forms/choice-chips';
import { FormAlert } from '@/components/forms/form-alert';
import { useSlowPending } from '@/components/forms/submit-button';
import { FieldError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { type ActionFailure, callAction } from '@/lib/action-result';
import {
  adjustActionLabel,
  amountAfterChange,
  previewAmount,
  type AdjustDirection,
  adjustOutcome,
  adjustTitle,
  amountText,
  cashActionLabel,
  cashOutcome,
  cashTitle,
  holdingHint,
  messageHint,
  messageLabel,
  messageMissing,
  MONEY_COPY,
  orderHint,
  overBalance,
  overHolding,
  payoutActionLabel,
  payoutOutcome,
  payoutTitle,
} from '@/lib/admin/earnings-text';
import { announce } from '@/lib/announce';
import { stepUpLockedText } from '@/lib/board/text';
import { cn } from '@/lib/utils';
import { ReadError } from './queries';

/*
 * The three money dialogs (F9 design 3.6 to 3.9): record cash handed in, adjust earnings and
 * record a payout. Each opening fetches a fresh key and the ledger's version; the action waits
 * for that answer ("Checking for changes…"). Amounts are typed text parsed to integer cents on
 * blur and on submit, never while typing; the outcome box previews the balance from the typed
 * amount without announcing it. A change made by someone else between opening and pressing
 * writes nothing and says what happened; pressing again sends with the new version.
 */

export const moneyDialogKey = (partnerId: string, kind: MoneyDialogKind) =>
  ['earnings', 'dialog', partnerId, kind] as const;

const CASH_NOTE_MAX = EARNINGS_LIMITS.cashNoteMax;
const NOTE_MAX = EARNINGS_LIMITS.staffNoteMax;
const ORDER_NUMBER = /^[A-Z]?\d{1,12}$/;
const ORDER_FORMAT = 'Enter an order number like 1042.';

const REASON_LABELS: Record<AdjustReason, string> = {
  bonus: 'Bonus',
  'cancelled-order-pay': 'Pay for a cancelled order',
  correction: 'Correction',
  other: 'Other',
};

const DIRECTIONS = [
  { value: 'add', label: 'Add', icon: CirclePlus },
  { value: 'take-off', label: 'Take off', icon: CircleMinus },
] as const;

const PENDING_LABELS: Record<MoneyDialogKind, string> = {
  cash: 'Recording…',
  adjust: 'Saving…',
  payout: 'Recording…',
};

interface MoneyValues {
  amount: string;
  note: string;
  direction: AdjustDirection;
  reason: string;
  message: string;
  orderNumber: string;
  method: string;
  reference: string;
  paidOn: string;
}

interface Figures {
  version: number;
  balanceCents: number;
  holdingCents: number;
}

export interface MoneyDialogProps {
  kind: MoneyDialogKind;
  partnerId: string;
  /** The partner's name as the page shows it (the title before the opening answers). */
  partnerName: string;
  timeZone: string;
  offline: boolean;
  onClose: () => void;
  /** Where focus goes on close: the opener, or the balance heading once the opener has gone. */
  onCloseFocus: () => boolean;
  /** After a send: the page refetches before this resolves, then the dialog closes (review S3). */
  onDone: (result: MoneyActionResult) => Promise<void> | void;
  /** The figures changed under the dialog: the page behind refetches too (A67.2). */
  onChanged?: () => Promise<unknown> | void;
  onSignedOut: () => void;
  /** Opens in a known state: an answer already shown, or the form already sent (stories). */
  start?: MoneyDialogStart;
}

export interface MoneyDialogStart {
  alert?: { tone: 'error' | 'warning' | 'info'; text: string };
  closeOnly?: string;
  /** Sends the form once on open, so its field errors show. */
  submit?: boolean;
}

async function readOpening(partnerId: string, kind: MoneyDialogKind): Promise<MoneyDialogOpening> {
  const outcome = await callAction(() => openMoneyDialogAction({ partnerId, kind }));
  if (!outcome.ok) throw new ReadError(outcome.error);
  return outcome.data;
}

const TITLES: Record<MoneyDialogKind, (name: string) => string> = {
  cash: cashTitle,
  adjust: adjustTitle,
  payout: payoutTitle,
};

/** One money dialog: the version check, then the form for its kind. */
export function MoneyDialog(props: MoneyDialogProps) {
  const { kind, partnerId, partnerName, onClose, onCloseFocus, onSignedOut } = props;
  const opening = useQuery<MoneyDialogOpening>({
    queryKey: moneyDialogKey(partnerId, kind),
    queryFn: () => readOpening(partnerId, kind),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  const slow = useSlowPending(opening.isPending);
  const failure = opening.error instanceof ReadError ? opening.error.failure : null;
  const signedOut = failure?.code === 'UNAUTHENTICATED';
  useEffect(() => {
    if (signedOut) onSignedOut();
  }, [signedOut, onSignedOut]);
  const title = TITLES[kind](opening.data?.partnerName ?? partnerName);

  if (opening.data && opening.data.applies) {
    return <MoneyForm {...props} opening={opening.data} title={title} />;
  }
  if (opening.data || opening.isError) {
    const words =
      opening.data?.whyNot ?? failure?.message ?? 'Something went wrong. Please try again.';
    return (
      <ActionDialog
        open
        title={title}
        pending={false}
        safeLabel="Close"
        actionLabel="Close"
        pendingLabel=""
        closeOnly
        onClose={onClose}
        onCloseFocus={onCloseFocus}
        onSubmit={onClose}
      >
        <FormAlert variant={opening.data ? 'info' : 'error'}>{words}</FormAlert>
      </ActionDialog>
    );
  }
  return (
    <ActionDialog
      open
      title={title}
      pending={false}
      safeLabel="Cancel"
      actionLabel={kind === 'cash' ? 'Record cash' : kind === 'adjust' ? 'Add' : 'Record payout'}
      pendingLabel={PENDING_LABELS[kind]}
      blocked
      blockedReason={slow ? MONEY_COPY.checking : null}
      onClose={onClose}
      onCloseFocus={onCloseFocus}
      onSubmit={() => undefined}
    >
      <div aria-busy className="space-y-3">
        <div className="h-5 w-24 rounded-md bg-neutral-7 motion-safe:animate-skeleton" />
        <div className="h-12 rounded-xl bg-neutral-7 motion-safe:animate-skeleton md:w-48" />
        <div className="h-14 rounded-xl bg-neutral-7 motion-safe:animate-skeleton" />
        <span className="sr-only">{MONEY_COPY.checking}</span>
      </div>
    </ActionDialog>
  );
}

// ------------------------------------------------------------------ fields

/** "Amount" with "$" drawn inside on the left (design 3.9). */
export function AmountField({
  value,
  error,
  hint,
  onChange,
  onBlur,
  inputRef,
}: {
  value: string;
  error: string | null;
  hint?: string | null;
  onChange: (value: string) => void;
  onBlur: () => void;
  inputRef?: RefObject<HTMLInputElement | null>;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div>
      <label htmlFor={id} className="block text-body-4 font-medium text-neutral-1">
        Amount
      </label>
      <div className="relative mt-2 md:w-48">
        <span
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-body-3 text-neutral-3"
        >
          $
        </span>
        <Input
          ref={inputRef}
          id={id}
          value={value}
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          maxLength={20}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
          aria-invalid={error ? true : undefined}
          aria-describedby={[hintId, errorId].filter(Boolean).join(' ') || undefined}
          className="h-12 pl-8 text-body-3 tabular-nums"
        />
      </div>
      {hint ? (
        <p id={hintId} className="mt-2 text-body-5 text-muted-foreground">
          {hint}
        </p>
      ) : null}
      <FieldError id={errorId}>{error}</FieldError>
    </div>
  );
}

function TextField({
  label,
  hint,
  value,
  error,
  maxLength,
  onChange,
  onBlur,
  className,
  inputMode,
}: {
  label: string;
  hint?: string;
  value: string;
  error: string | null;
  maxLength: number;
  onChange: (value: string) => void;
  onBlur: () => void;
  className?: string;
  inputMode?: 'text' | 'numeric';
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div>
      <label htmlFor={id} className="block text-body-4 font-medium text-neutral-1">
        {label}
      </label>
      <Input
        id={id}
        value={value}
        maxLength={maxLength}
        autoComplete="off"
        inputMode={inputMode}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        aria-invalid={error ? true : undefined}
        aria-describedby={[hintId, errorId].filter(Boolean).join(' ') || undefined}
        className={cn('mt-2', className)}
      />
      {hint ? (
        <p id={hintId} className="mt-2 text-body-5 text-muted-foreground">
          {hint}
        </p>
      ) : null}
      <FieldError id={errorId}>{error}</FieldError>
    </div>
  );
}

function MessageField({
  name,
  value,
  error,
  onChange,
  onBlur,
}: {
  name: string;
  value: string;
  error: string | null;
  onChange: (value: string) => void;
  onBlur: () => void;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = error ? `${id}-error` : undefined;
  const max = EARNINGS_LIMITS.partnerMessageMax;
  return (
    <div>
      <label htmlFor={id} className="block text-body-4 font-medium text-neutral-1">
        {messageLabel(name)}
      </label>
      <Textarea
        id={id}
        value={value}
        rows={3}
        maxLength={max * 2}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        aria-invalid={error ? true : undefined}
        aria-describedby={[hintId, errorId].filter(Boolean).join(' ')}
        className="mt-2 max-h-[8rem] min-h-[5.25rem] rounded-xl bg-white px-4 py-3 text-body-4 text-neutral-1"
      />
      <div className="mt-2 flex items-start justify-between gap-3">
        <p id={hintId} className="text-body-5 text-muted-foreground">
          {messageHint(name)}
        </p>
        <span
          aria-hidden
          className={cn(
            'text-caption tabular-nums',
            value.length > max ? 'text-destructive' : 'text-neutral-3',
          )}
        >
          {value.length}/{max}
        </span>
      </div>
      <FieldError id={errorId}>{error}</FieldError>
    </div>
  );
}

function DateField({
  label,
  value,
  max,
  error,
  onChange,
  onBlur,
}: {
  label: string;
  value: string;
  max: string;
  error: string | null;
  onChange: (value: string) => void;
  onBlur: () => void;
}) {
  const id = useId();
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div>
      <label htmlFor={id} className="block text-body-4 font-medium text-neutral-1">
        {label}
      </label>
      <Input
        id={id}
        type="date"
        value={value}
        max={max}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        aria-invalid={error ? true : undefined}
        aria-describedby={errorId}
        className="mt-2 w-auto min-w-48 tabular-nums"
      />
      <FieldError id={errorId}>{error}</FieldError>
    </div>
  );
}

// ------------------------------------------------------------------ validation

const tooLong = (max: number) => `Keep it to ${max} characters.`;

/** Every problem with what's typed, in the design's words (A67.3, 3.6 to 3.8). */
function problemsOf(
  kind: MoneyDialogKind,
  value: MoneyValues,
  context: { name: string; figures: Figures; today: string },
): Record<string, string> {
  const fields: Record<string, string> = {};
  const { name, figures } = context;
  const cents = parseAmountText(value.amount);
  if (value.amount.trim() === '' || cents === null) fields.amount = MONEY_COPY.amount;
  else if (cents < 1) fields.amount = MONEY_COPY.amountMin;
  else if (kind === 'cash' && cents > figures.holdingCents) {
    fields.amount = overHolding(name, figures.holdingCents);
  } else if (kind === 'adjust' && cents > EARNINGS_LIMITS.adjustMaxCents) {
    fields.amount = MONEY_COPY.adjustCap;
  } else if (kind === 'payout' && cents > Math.max(0, figures.balanceCents)) {
    fields.amount = overBalance(name, Math.max(0, figures.balanceCents));
  }
  const noteMax = kind === 'cash' ? CASH_NOTE_MAX : NOTE_MAX;
  if (value.note.trim().length > noteMax) fields.note = tooLong(noteMax);
  if (kind === 'adjust') {
    if (!value.reason) fields.reason = MONEY_COPY.reason;
    const message = value.message.trim();
    if (!message) fields.message = messageMissing(name);
    else if (message.length > EARNINGS_LIMITS.partnerMessageMax) {
      fields.message = tooLong(EARNINGS_LIMITS.partnerMessageMax);
    }
    const order = value.orderNumber.trim().toUpperCase();
    if (order && !ORDER_NUMBER.test(order)) fields.orderNumber = ORDER_FORMAT;
  }
  if (kind === 'payout') {
    if (!value.method) fields.method = MONEY_COPY.method;
    if (!value.paidOn) fields.paidOn = MONEY_COPY.date;
    else if (value.paidOn > context.today) fields.paidOn = MONEY_COPY.futureDate;
    if (value.reference.trim().length > EARNINGS_LIMITS.referenceMax) {
      fields.reference = tooLong(EARNINGS_LIMITS.referenceMax);
    }
  }
  return fields;
}

/** The action's input, checked against the module's own schema before it's sent. */
function inputOf(
  kind: MoneyDialogKind,
  value: MoneyValues,
  base: { partnerId: string; expectedVersion: number; idempotencyKey: string },
  stepUp: { method: StepUpMethod; code: string } | null,
) {
  const note = value.note.trim() ? { note: value.note } : {};
  const code = stepUp?.code ? { stepUp } : {};
  if (kind === 'cash') return { ...base, amount: value.amount.trim(), ...note };
  if (kind === 'adjust') {
    const order = value.orderNumber.trim().toUpperCase();
    return {
      ...base,
      direction: value.direction,
      amount: value.amount.trim(),
      reason: value.reason,
      message: value.message,
      ...(order ? { orderNumber: order } : {}),
      ...note,
      ...code,
    };
  }
  return {
    ...base,
    amount: value.amount.trim(),
    method: value.method,
    ...(value.reference.trim() ? { reference: value.reference } : {}),
    paidOn: value.paidOn,
    ...note,
    ...code,
  };
}

const SCHEMAS = {
  cash: recordCashInput,
  adjust: adjustEarningsInput,
  payout: recordPayoutInput,
} as const;

function send(kind: MoneyDialogKind, input: Record<string, unknown>) {
  switch (kind) {
    case 'cash': {
      const parsed = recordCashInput.safeParse(input);
      return parsed.success ? callAction(() => recordCashHandInAction(parsed.data)) : null;
    }
    case 'adjust': {
      const parsed = adjustEarningsInput.safeParse(input);
      return parsed.success
        ? callAction(() =>
            adjustEarningsAction({ ...parsed.data, message: parsed.data.message ?? '' }),
          )
        : null;
    }
    default: {
      const parsed = recordPayoutInput.safeParse(input);
      return parsed.success ? callAction(() => recordPayoutAction(parsed.data)) : null;
    }
  }
}

const isChanged = (details: unknown): details is LedgerChangedDetails =>
  typeof details === 'object' &&
  details !== null &&
  typeof Reflect.get(details, 'version') === 'number' &&
  typeof Reflect.get(details, 'words') === 'string';

// ------------------------------------------------------------------ the form

function MoneyForm({
  kind,
  opening,
  title,
  timeZone,
  offline,
  onClose,
  onCloseFocus,
  onDone,
  onChanged,
  onSignedOut,
  start,
}: MoneyDialogProps & { opening: MoneyDialogOpening; title: string }) {
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const name = opening.partnerName;
  const [today] = useState(() => storeDate(new Date(), timeZone));
  const [figures, setFigures] = useState<Figures>({
    version: opening.version,
    balanceCents: opening.balanceCents,
    holdingCents: opening.holdingCents,
  });
  const [pending, setPending] = useState(false);
  const [alert, setAlert] = useState<{ tone: 'error' | 'warning' | 'info'; text: string } | null>(
    start?.alert ?? null,
  );
  const [closeOnlyText, setCloseOnlyText] = useState<string | null>(start?.closeOnly ?? null);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [stepUp, setStepUp] = useState<{ shown: boolean; method: StepUpMethod; code: string }>({
    shown: kind !== 'cash' && opening.stepUpRequired,
    method: 'totp',
    code: '',
  });
  const [codeError, setCodeError] = useState<string | null>(null);
  const [lockedUntil, setLockedUntil] = useState<string | null>(null);

  const showAlert = (next: { tone: 'error' | 'warning' | 'info'; text: string }) => {
    setAlert(next);
    requestAnimationFrame(() => alertRef.current?.focus());
    announce(next.text, { assertive: next.tone === 'error' });
  };

  const defaults: MoneyValues = {
    amount: amountText(opening.defaultAmountCents),
    note: '',
    direction: 'add',
    reason: '',
    message: '',
    orderNumber: '',
    method: '',
    reference: '',
    paidOn: today,
  };

  const form = useForm({
    defaultValues: defaults,
    // After a failed send, errors clear as they're fixed, so nothing jumps under a tap at blur.
    validationLogic: revalidateLogic({ mode: 'blur', modeAfterSubmission: 'change' }),
    validators: {
      onDynamic: ({ value }) => {
        const fields = problemsOf(kind, value, { name, figures, today });
        return Object.keys(fields).length ? { fields } : undefined;
      },
    },
    onSubmitInvalid: () => focusFirstProblem(formRef.current),
    onSubmit: async ({ value }) => {
      if (pending) return;
      const input = inputOf(
        kind,
        value,
        {
          partnerId: opening.partnerId,
          expectedVersion: figures.version,
          idempotencyKey: opening.idempotencyKey,
        },
        kind !== 'cash' && stepUp.shown ? { method: stepUp.method, code: stepUp.code } : null,
      );
      const sending = send(kind, input);
      if (!sending) {
        // The schema refused something the checks above let through: show it under its field.
        const parsed = SCHEMAS[kind].safeParse(input);
        if (!parsed.success) {
          const fields: Record<string, string> = {};
          for (const issue of parsed.error.issues) {
            const key = String(issue.path[0] ?? '');
            if (key === 'stepUp') setCodeError(issue.message);
            else if (key && !(key in fields)) fields[key] = issue.message;
          }
          setServerErrors(fields);
          focusFirstProblem(formRef.current);
        }
        return;
      }
      setPending(true);
      setServerErrors({});
      setAlert(null);
      const outcome = await sending;
      if (outcome.ok) {
        showBoardNotice(outcome.data.boardNotice);
        // Still pending while the page behind refetches, so focus never lands on an old figure.
        await onDone(outcome.data);
        return;
      }
      setPending(false);
      handleFailure(outcome.error);
    },
  });

  function handleFailure(failure: ActionFailure) {
    const details = failure.details;
    switch (failure.code) {
      case 'UNAUTHENTICATED':
        onSignedOut();
        onClose();
        return;
      case 'LEDGER_CHANGED':
        if (isChanged(details)) {
          void onChanged?.();
          if (details.closeOnly) {
            setCloseOnlyText(details.words);
            announce(details.words);
            requestAnimationFrame(() => alertRef.current?.focus());
            return;
          }
          setFigures({
            version: details.version,
            balanceCents: details.balanceCents,
            holdingCents: details.holdingCents,
          });
          form.setFieldValue(
            'amount',
            amountAfterChange(kind, form.state.values.amount, defaults.amount, details),
          );
          showAlert({ tone: 'warning', text: details.words });
          return;
        }
        break;
      case 'CONFLICT':
        setCloseOnlyText(failure.message);
        announce(failure.message);
        requestAnimationFrame(() => alertRef.current?.focus());
        return;
      case 'STEP_UP_REQUIRED':
        setStepUp((current) => ({ ...current, shown: true }));
        requestAnimationFrame(() => {
          codeRef.current?.focus();
          announce(MONEY_COPY.stepUpPrompt);
        });
        return;
      case 'STEP_UP_INVALID':
        setCodeError(failure.fieldErrors?.stepUp?.[0] ?? failure.message);
        requestAnimationFrame(() => {
          codeRef.current?.focus();
          codeRef.current?.parentElement?.scrollIntoView({ block: 'nearest' });
        });
        return;
      case 'STEP_UP_LOCKED': {
        const retryAt = typeof details?.retryAt === 'string' ? details.retryAt : null;
        setLockedUntil(retryAt ?? 'locked');
        showAlert({
          tone: 'error',
          text: retryAt ? stepUpLockedText(retryAt, timeZone) : failure.message,
        });
        return;
      }
      case 'INVALID_INPUT': {
        const fields: Record<string, string> = {};
        for (const [key, messages] of Object.entries(failure.fieldErrors ?? {})) {
          const first = messages[0];
          if (!first) continue;
          if (key === 'stepUp') setCodeError(first);
          else fields[key] = first;
        }
        if (Object.keys(fields).length > 0 || failure.fieldErrors?.stepUp) {
          setServerErrors(fields);
          focusFirstProblem(formRef.current);
          if (failure.fieldErrors?.stepUp) requestAnimationFrame(() => codeRef.current?.focus());
          return;
        }
        break;
      }
      default:
        break;
    }
    showAlert({ tone: 'error', text: failure.message });
  }

  const sendOnOpen = start?.submit ?? false;
  useEffect(() => {
    if (sendOnOpen) void form.handleSubmit();
    // Once, as it opens.
    // oxlint-disable-next-line react/exhaustive-deps
  }, []);

  const values = useStore(form.store, (state) => state.values);
  const submitted = useStore(form.store, (state) => state.submissionAttempts > 0);
  const errorOf = (
    field: keyof MoneyValues,
    meta: { errors: readonly unknown[]; isBlurred: boolean },
  ) => {
    const first = meta.errors.find((error) => typeof error === 'string');
    return (
      ((submitted || meta.isBlurred) && typeof first === 'string' ? first : null) ??
      (serverErrors[field] || null)
    );
  };
  const clearServer = (field: keyof MoneyValues) =>
    setServerErrors((current) => (current[field] ? { ...current, [field]: '' } : current));

  // The outcome previews only a well-formed amount, in integer cents.
  const previewCents = previewAmount(kind, values.amount, figures);
  let outcome: string[];
  let actionLabel: string;
  if (kind === 'cash') {
    outcome = cashOutcome(name, figures.balanceCents, previewCents);
    actionLabel = cashActionLabel(previewCents);
  } else if (kind === 'adjust') {
    outcome = adjustOutcome(
      name,
      values.direction,
      previewCents,
      values.message,
      figures.balanceCents,
    );
    actionLabel = adjustActionLabel(values.direction, previewCents);
  } else {
    const method = PAYOUT_METHODS.find((choice) => choice === values.method) ?? null;
    outcome = payoutOutcome(name, method, previewCents, figures.balanceCents);
    actionLabel = payoutActionLabel(previewCents);
  }

  const blockedReason = offline ? MONEY_COPY.offline : lockedUntil ? (alert?.text ?? null) : null;

  if (closeOnlyText) {
    return (
      <ActionDialog
        open
        title={title}
        pending={false}
        safeLabel="Close"
        actionLabel="Close"
        pendingLabel=""
        closeOnly
        onClose={onClose}
        onCloseFocus={onCloseFocus}
        onSubmit={onClose}
      >
        <div ref={alertRef} tabIndex={-1} className="outline-none">
          <FormAlert variant="info">{closeOnlyText}</FormAlert>
        </div>
      </ActionDialog>
    );
  }

  const reasons = ADJUST_REASONS.filter(
    (reason) => reason !== 'bonus' || values.direction === 'add',
  );

  let fields: ReactNode;
  if (kind === 'cash') {
    fields = (
      <>
        <form.Field name="amount">
          {(field) => (
            <AmountField
              value={field.state.value}
              error={errorOf('amount', field.state.meta)}
              hint={holdingHint(name, figures.holdingCents)}
              onChange={(value) => {
                field.handleChange(value);
                clearServer('amount');
              }}
              onBlur={field.handleBlur}
            />
          )}
        </form.Field>
        <form.Field name="note">
          {(field) => (
            <StaffNoteField
              required={false}
              max={CASH_NOTE_MAX}
              value={field.state.value}
              error={errorOf('note', field.state.meta)}
              onChange={(value) => {
                field.handleChange(value);
                clearServer('note');
              }}
              onBlur={field.handleBlur}
            />
          )}
        </form.Field>
        <p className="flex items-start gap-2 text-body-5 text-neutral-2">
          <Smartphone className="mt-0.5 size-4 shrink-0 text-neutral-3" aria-hidden />
          {MONEY_COPY.smartphone(name)}
        </p>
      </>
    );
  } else if (kind === 'adjust') {
    fields = (
      <>
        <form.Field name="direction">
          {(field) => (
            <ChoiceChips
              name={`${id}-direction`}
              legend="Add or take off"
              choices={DIRECTIONS}
              value={field.state.value}
              onChange={(value) => {
                field.handleChange(value);
                // "Bonus" exists only for additions: a chosen one clears (design 3.7).
                if (value === 'take-off' && form.state.values.reason === 'bonus') {
                  form.setFieldValue('reason', '');
                }
              }}
            />
          )}
        </form.Field>
        <form.Field name="amount">
          {(field) => (
            <AmountField
              value={field.state.value}
              error={errorOf('amount', field.state.meta)}
              onChange={(value) => {
                field.handleChange(value);
                clearServer('amount');
              }}
              onBlur={field.handleBlur}
            />
          )}
        </form.Field>
        <form.Field name="reason">
          {(field) => (
            <ReasonFieldset<AdjustReason>
              name={`${id}-reason`}
              reasons={reasons}
              labels={REASON_LABELS}
              value={field.state.value}
              error={errorOf('reason', field.state.meta)}
              onChange={(value) => {
                field.handleChange(value);
                clearServer('reason');
              }}
            />
          )}
        </form.Field>
        <form.Field name="message">
          {(field) => (
            <MessageField
              name={name}
              value={field.state.value}
              error={errorOf('message', field.state.meta)}
              onChange={(value) => {
                field.handleChange(value);
                clearServer('message');
              }}
              onBlur={field.handleBlur}
            />
          )}
        </form.Field>
        <form.Field name="orderNumber">
          {(field) => (
            <TextField
              label="Order number (optional)"
              hint={orderHint(name)}
              value={field.state.value}
              error={errorOf('orderNumber', field.state.meta)}
              maxLength={13}
              className="h-11 w-40 tabular-nums"
              onChange={(value) => {
                field.handleChange(value);
                clearServer('orderNumber');
              }}
              onBlur={field.handleBlur}
            />
          )}
        </form.Field>
        <form.Field name="note">
          {(field) => (
            <StaffNoteField
              required={false}
              value={field.state.value}
              error={errorOf('note', field.state.meta)}
              onChange={(value) => {
                field.handleChange(value);
                clearServer('note');
              }}
              onBlur={field.handleBlur}
            />
          )}
        </form.Field>
      </>
    );
  } else {
    fields = (
      <>
        <p className="flex gap-2 rounded-xl bg-tag-3-bg p-4 text-body-5 text-neutral-1">
          <Info className="mt-0.5 size-4 shrink-0 text-tag-3" aria-hidden />
          {MONEY_COPY.payoutInfo}
        </p>
        <form.Field name="amount">
          {(field) => (
            <AmountField
              value={field.state.value}
              error={errorOf('amount', field.state.meta)}
              onChange={(value) => {
                field.handleChange(value);
                clearServer('amount');
              }}
              onBlur={field.handleBlur}
            />
          )}
        </form.Field>
        <form.Field name="method">
          {(field) => (
            <ReasonFieldset<PayoutMethod>
              name={`${id}-method`}
              legend="How you paid"
              reasons={PAYOUT_METHODS}
              labels={METHOD_WORDS}
              value={field.state.value}
              error={errorOf('method', field.state.meta)}
              onChange={(value) => {
                field.handleChange(value);
                clearServer('method');
              }}
            />
          )}
        </form.Field>
        <form.Field name="reference">
          {(field) => (
            <TextField
              label="Reference (optional)"
              hint="For example, Transfer 88213."
              value={field.state.value}
              error={errorOf('reference', field.state.meta)}
              maxLength={EARNINGS_LIMITS.referenceMax}
              onChange={(value) => {
                field.handleChange(value);
                clearServer('reference');
              }}
              onBlur={field.handleBlur}
            />
          )}
        </form.Field>
        <form.Field name="paidOn">
          {(field) => (
            <DateField
              label="Date paid"
              value={field.state.value}
              max={today}
              error={errorOf('paidOn', field.state.meta)}
              onChange={(value) => {
                field.handleChange(value);
                clearServer('paidOn');
              }}
              onBlur={field.handleBlur}
            />
          )}
        </form.Field>
        <form.Field name="note">
          {(field) => (
            <StaffNoteField
              required={false}
              value={field.state.value}
              error={errorOf('note', field.state.meta)}
              onChange={(value) => {
                field.handleChange(value);
                clearServer('note');
              }}
              onBlur={field.handleBlur}
            />
          )}
        </form.Field>
      </>
    );
  }

  return (
    <ActionDialog
      open
      title={title}
      pending={pending}
      safeLabel="Cancel"
      actionLabel={actionLabel}
      pendingLabel={PENDING_LABELS[kind]}
      blocked={offline || Boolean(lockedUntil)}
      blockedReason={blockedReason}
      formRef={formRef}
      onClose={onClose}
      onCloseFocus={onCloseFocus}
      onSubmit={() => void form.handleSubmit()}
    >
      {alert ? (
        <div ref={alertRef} tabIndex={-1} className="outline-none">
          <FormAlert variant={alert.tone}>{alert.text}</FormAlert>
        </div>
      ) : null}
      {fields}
      <OutcomeBox lines={outcome} />
      {kind !== 'cash' && stepUp.shown ? (
        <StepUpField
          method={stepUp.method}
          value={stepUp.code}
          error={codeError}
          disabled={Boolean(lockedUntil)}
          inputRef={codeRef}
          hint={MONEY_COPY.stepUpHint}
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
