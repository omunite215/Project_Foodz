'use client';

import { revalidateLogic, useForm, useStore } from '@tanstack/react-form';
import { useId, useRef, useState } from 'react';
import type { BoardCard } from '@/server/modules/board/schema';
import type { StaffDispatchResult } from '@/server/modules/delivery/schema';
import { cancelUnreachableAction, confirmHandoverAction } from '@/server/modules/tracking/actions';
import {
  CONFIRM_REASONS,
  type ConfirmReason,
  confirmHandoverInput,
} from '@/server/modules/tracking/schema';
import { focusThenAnnounce } from '@/components/forms/feedback';
import { FormAlert } from '@/components/forms/form-alert';
import { FieldError } from '@/components/ui/field';
import { type ActionFailure, callAction } from '@/lib/action-result';
import { announce } from '@/lib/announce';
import { cashCollectedLabel, stepUpLockedText } from '@/lib/board/text';
import {
  bringBackOutcome,
  bringBackRefundLine,
  bringBackTitle,
  CONFIRM_REASON_LABELS,
  confirmedAnnouncement,
  confirmOutcome,
  firstOfShort,
  UNREACHABLE_REASON,
} from '@/lib/board/tracking-text';
import { ActionDialog } from './action-dialog';
import {
  focusFirstProblem,
  OutcomeBox,
  ReasonFieldset,
  StaffNoteField,
  TickRow,
  zodFieldErrors,
} from './dialog-fields';
import { type StepUpMethod, StepUpField } from './step-up-field';

/*
 * Finishing a stuck delivery (F8 design 3.10, A50): "Confirm hand-over" with a reason, a note
 * and the cash tick, and "Cancel and bring it back" with "Customer couldn't be reached" chosen
 * and F5's refund and step-up rules. Both carry the delivery's version and say what happened
 * when the courier or another person got there first (A50.2).
 */

interface Common {
  card: BoardCard;
  timeZone: string;
  offline: boolean;
  /** The demo admin: everything shows, nothing sends. */
  readOnly?: boolean;
  onClose: () => void;
  onCloseFocus: () => boolean;
  onSignedOut: () => void;
  onFinished: (result: StaffDispatchResult) => void;
}

const CLOSE_ONLY = new Set([
  'DELIVERY_CHANGED',
  'ORDER_CHANGED',
  'INVALID_STATE',
  'NOT_ASSIGNED',
  'NOT_FOUND',
  'CONFIRM_NOT_ALLOWED',
]);

function useAlert() {
  const ref = useRef<HTMLDivElement>(null);
  const [alert, setAlert] = useState<{ text: string; closeOnly: boolean } | null>(null);
  const show = (failure: ActionFailure) => {
    const next = { text: failure.message, closeOnly: CLOSE_ONLY.has(failure.code) };
    setAlert(next);
    announce(next.text);
    requestAnimationFrame(() => ref.current?.focus());
  };
  const node = alert ? (
    <div ref={ref} tabIndex={-1} className="outline-none">
      <FormAlert variant={alert.closeOnly ? 'info' : 'error'}>{alert.text}</FormAlert>
    </div>
  ) : null;
  return { alert, show, clear: () => setAlert(null), node };
}

const cashCentsOf = (card: BoardCard) =>
  card.view === 'full' && card.payment.method === 'cash' && card.payment.status === 'UNPAID'
    ? card.payment.totalCents
    : null;

export function ConfirmHandoverDialog({
  card,
  timeZone,
  offline,
  readOnly = false,
  onClose,
  onCloseFocus,
  onSignedOut,
  onFinished,
}: Common) {
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const { alert, show, clear, node } = useAlert();
  const cashCents = cashCentsOf(card);
  const courierFirst = firstOfShort(card.courier?.shortName);
  const version = card.courier?.deliveryVersion ?? 0;
  void timeZone;

  const form = useForm({
    defaultValues: { reason: '', note: '', cashCollected: false },
    validationLogic: revalidateLogic({ mode: 'submit', modeAfterSubmission: 'change' }),
    validators: {
      onDynamic: ({ value }) => {
        const fields =
          zodFieldErrors(confirmHandoverInput, {
            orderId: card.id,
            expectedVersion: version,
            reason: value.reason,
            note: value.note,
            cashCollected: value.cashCollected,
          }) ?? {};
        if (cashCents !== null && !value.cashCollected) {
          fields.cashCollected = 'Check this box once you have the cash.';
        }
        return Object.keys(fields).length ? { fields } : undefined;
      },
    },
    onSubmitInvalid: () => focusFirstProblem(formRef.current),
    onSubmit: async ({ value }) => {
      if (pending) return;
      const parsed = confirmHandoverInput.safeParse({
        orderId: card.id,
        expectedVersion: version,
        reason: value.reason,
        note: value.note,
        ...(cashCents !== null ? { cashCollected: value.cashCollected } : {}),
      });
      if (!parsed.success) return;
      setPending(true);
      setServerErrors({});
      clear();
      const outcome = await callAction(() => confirmHandoverAction(parsed.data));
      setPending(false);
      if (outcome.ok) {
        announce(confirmedAnnouncement(card.number));
        onFinished(outcome.data);
        return;
      }
      if (outcome.error.code === 'UNAUTHENTICATED') {
        onSignedOut();
        onClose();
        return;
      }
      const fields = outcome.error.fieldErrors;
      if (outcome.error.code === 'INVALID_INPUT' && fields) {
        setServerErrors(
          Object.fromEntries(
            Object.entries(fields).flatMap(([key, list]) => (list?.[0] ? [[key, list[0]]] : [])),
          ),
        );
        focusFirstProblem(formRef.current);
        return;
      }
      show(outcome.error);
    },
  });
  const submitted = useStore(form.store, (state) => state.submissionAttempts > 0);
  const reason = useStore(form.store, (state) => state.values.reason);
  const errorOf = (name: string, errors: readonly unknown[]) => {
    const first = errors.find((error) => typeof error === 'string');
    return (submitted && typeof first === 'string' ? first : null) ?? serverErrors[name] ?? null;
  };
  const blockedReason = offline ? "You're offline." : readOnly ? 'Read-only in the demo' : null;

  return (
    <ActionDialog
      open
      title={`Confirm hand-over of order ${card.number}?`}
      pending={pending}
      safeLabel="Not yet"
      actionLabel="Confirm hand-over"
      pendingLabel="Confirming…"
      blocked={blockedReason !== null}
      blockedReason={blockedReason}
      closeOnly={alert?.closeOnly ?? false}
      formRef={formRef}
      onClose={onClose}
      onCloseFocus={onCloseFocus}
      onSubmit={() => void form.handleSubmit()}
    >
      {node}
      {alert?.closeOnly ? null : (
        <>
          <form.Field name="reason">
            {(field) => (
              <ReasonFieldset<ConfirmReason>
                name="confirm-reason"
                reasons={CONFIRM_REASONS}
                labels={CONFIRM_REASON_LABELS}
                value={field.state.value}
                error={errorOf('reason', field.state.meta.errors)}
                onChange={(next) => field.handleChange(next)}
              />
            )}
          </form.Field>
          <form.Field name="note">
            {(field) => (
              <StaffNoteField
                required={reason === 'other'}
                value={field.state.value}
                error={errorOf('note', field.state.meta.errors)}
                onChange={(next) => field.handleChange(next)}
                onBlur={field.handleBlur}
              />
            )}
          </form.Field>
          {cashCents !== null ? (
            <form.Field name="cashCollected">
              {(field) => {
                const error = errorOf('cashCollected', field.state.meta.errors);
                return (
                  <div>
                    <TickRow
                      id={`${id}-cash`}
                      checked={field.state.value}
                      invalid={Boolean(error)}
                      describedBy={error ? `${id}-cash-error` : undefined}
                      onChange={(checked) => field.handleChange(checked)}
                    >
                      {cashCollectedLabel(cashCents)}
                    </TickRow>
                    <FieldError id={`${id}-cash-error`}>{error}</FieldError>
                  </div>
                );
              }}
            </form.Field>
          ) : null}
          <OutcomeBox lines={[confirmOutcome(card.number, courierFirst, card.firstName)]} />
        </>
      )}
    </ActionDialog>
  );
}

const UNREACHABLE = ['customer-unreachable'] as const;
const STEP_UP_PROMPT = 'Enter a code from your authenticator app to continue.';

export function CancelBringBackDialog({
  card,
  timeZone,
  offline,
  readOnly = false,
  onClose,
  onCloseFocus,
  onSignedOut,
  onFinished,
}: Common) {
  const formRef = useRef<HTMLFormElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);
  const [stepUp, setStepUp] = useState<{ shown: boolean; method: StepUpMethod; code: string }>({
    shown: false,
    method: 'totp',
    code: '',
  });
  const [codeError, setCodeError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const { alert, show, clear, node } = useAlert();
  const courierFirst = firstOfShort(card.courier?.shortName);
  const version = card.courier?.deliveryVersion ?? 0;
  const blockedReason = offline
    ? "You're offline."
    : readOnly
      ? 'Read-only in the demo'
      : locked
        ? 'Too many wrong codes.'
        : null;

  const submit = async () => {
    if (pending || blockedReason) return;
    setPending(true);
    setCodeError(null);
    setNoteError(null);
    clear();
    const outcome = await callAction(() =>
      cancelUnreachableAction({
        orderId: card.id,
        expectedVersion: version,
        ...(note.trim() ? { note } : {}),
        ...(stepUp.shown && stepUp.code
          ? { stepUp: { method: stepUp.method, code: stepUp.code } }
          : {}),
      }),
    );
    setPending(false);
    if (outcome.ok) {
      announce(`Order ${card.number} cancelled. The customer has been told.`);
      onFinished(outcome.data);
      return;
    }
    const failure = outcome.error;
    switch (failure.code) {
      case 'UNAUTHENTICATED':
        onSignedOut();
        onClose();
        return;
      case 'STEP_UP_REQUIRED':
        setStepUp((value) => ({ ...value, shown: true }));
        focusThenAnnounce(codeRef.current, STEP_UP_PROMPT);
        return;
      case 'STEP_UP_INVALID':
        setCodeError(failure.fieldErrors?.stepUp?.[0] ?? failure.message);
        focusThenAnnounce(codeRef.current);
        return;
      case 'STEP_UP_LOCKED': {
        const retryAt = failure.details?.retryAt;
        setLocked(true);
        show({
          ...failure,
          message:
            typeof retryAt === 'string' ? stepUpLockedText(retryAt, timeZone) : failure.message,
        });
        return;
      }
      case 'INVALID_INPUT': {
        const message = failure.fieldErrors?.note?.[0];
        if (message) {
          setNoteError(message);
          focusFirstProblem(formRef.current);
          return;
        }
        show(failure);
        return;
      }
      default:
        show(failure);
    }
  };

  return (
    <ActionDialog
      open
      title={bringBackTitle(card.number)}
      pending={pending}
      irreversible
      danger
      safeLabel="Keep order"
      actionLabel="Cancel order"
      pendingLabel="Cancelling…"
      blocked={blockedReason !== null}
      blockedReason={blockedReason}
      closeOnly={alert?.closeOnly ?? false}
      formRef={formRef}
      onClose={onClose}
      onCloseFocus={onCloseFocus}
      onSubmit={() => void submit()}
    >
      {node}
      {alert?.closeOnly ? null : (
        <>
          <ReasonFieldset<(typeof UNREACHABLE)[number]>
            name="bring-back-reason"
            reasons={UNREACHABLE}
            labels={{ 'customer-unreachable': UNREACHABLE_REASON }}
            value="customer-unreachable"
            error={null}
            onChange={() => undefined}
          />
          <StaffNoteField
            required={false}
            value={note}
            error={noteError}
            onChange={setNote}
            onBlur={() => undefined}
          />
          {stepUp.shown ? (
            <StepUpField
              method={stepUp.method}
              value={stepUp.code}
              error={codeError}
              disabled={pending || locked}
              inputRef={codeRef}
              onSwap={() =>
                setStepUp((value) => ({
                  ...value,
                  method: value.method === 'totp' ? 'backup' : 'totp',
                  code: '',
                }))
              }
              onChange={(code) => setStepUp((value) => ({ ...value, code }))}
            />
          ) : null}
          <OutcomeBox
            lines={[bringBackRefundLine(card), bringBackOutcome(courierFirst)].filter(Boolean)}
          />
        </>
      )}
    </ActionDialog>
  );
}
