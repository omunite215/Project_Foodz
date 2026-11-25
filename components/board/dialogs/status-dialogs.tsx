'use client';

import { revalidateLogic, useForm, useStore } from '@tanstack/react-form';
import { useId, useRef, useState } from 'react';
import {
  markDeliveredAction,
  markPickedUpAction,
  moveBackAction,
} from '@/server/modules/board/actions';
import {
  type BoardCard,
  HANDOVER_REASONS,
  type HandoverReason,
  markDeliveredInput,
  markPickedUpInput,
  MOVE_BACK_REASONS,
  moveBackInput,
  type StatusChangeResult,
} from '@/server/modules/board/schema';
import { PREVIOUS_STEP } from '@/server/modules/board/state';
import { HANDOVER_REASON_LABELS, MOVE_BACK_REASON_LABELS } from '@/server/modules/board/text';
import { FormAlert } from '@/components/forms/form-alert';
import { FieldError } from '@/components/ui/field';
import { type ActionFailure, callAction } from '@/lib/action-result';
import { announce } from '@/lib/announce';
import {
  cashCollectedLabel,
  conflictText,
  deliveredAnnouncement,
  deliverTitle,
  keepInColumnText,
  movedBackAnnouncement,
  moveBackTitle,
  pickedUpAnnouncement,
  pickUpTitle,
} from '@/lib/board/text';
import { isOrderChangedDetails } from '@/lib/board/model';
import {
  assignedCourierReason,
  deliveredByCourierReason,
  holdingCourier,
  moveBackCourierLine,
  otherWayLine,
} from '@/lib/board/courier-text';
import { ActionDialog } from './action-dialog';
import {
  focusFirstProblem,
  OutcomeBox,
  ReasonFieldset,
  StaffNoteField,
  TickRow,
  zodFieldErrors,
} from './dialog-fields';

/*
 * ADMIN's overrides: "Move back" one step with a reason (design 3.5, A8.3), and "Mark picked
 * up" / "Mark delivered" by hand before couriers exist (design 3.6, A9), with the
 * "Collected $53.97 in cash" tick on a cash order's delivery.
 */

export interface StatusFinished {
  card: BoardCard;
  result: StatusChangeResult;
}

interface Common {
  card: BoardCard;
  timeZone: string;
  offline: boolean;
  onClose: () => void;
  onCloseFocus: () => boolean;
  onFinished: (finished: StatusFinished) => void;
  onSignedOut: () => void;
}

/** Shared failure handling: the alert text, or null when the field errors say it. */
function failureText(
  failure: ActionFailure,
  timeZone: string,
): { text: string; closeOnly: boolean } | null {
  if (failure.code === 'INVALID_INPUT') return null;
  if (failure.code === 'ORDER_CHANGED' && isOrderChangedDetails(failure.details)) {
    return { text: conflictText(failure.details, null, timeZone), closeOnly: true };
  }
  if (failure.code === 'INVALID_STATE') return { text: failure.message, closeOnly: true };
  return { text: failure.message, closeOnly: false };
}

function useDialogAlert() {
  const ref = useRef<HTMLDivElement>(null);
  const [alert, setAlert] = useState<{ text: string; closeOnly: boolean } | null>(null);
  const show = (next: { text: string; closeOnly: boolean }) => {
    setAlert(next);
    requestAnimationFrame(() => ref.current?.focus());
    announce(next.text);
  };
  const node = alert ? (
    <div ref={ref} tabIndex={-1} className="outline-none">
      <FormAlert variant={alert.closeOnly ? 'info' : 'error'}>{alert.text}</FormAlert>
    </div>
  ) : null;
  return { alert, show, node };
}

function firstErrors(failure: ActionFailure): Record<string, string> {
  return Object.fromEntries(
    Object.entries(failure.fieldErrors ?? {}).map(([key, messages]) => [key, messages[0] ?? '']),
  );
}

export function MoveBackDialog({
  card,
  timeZone,
  offline,
  onClose,
  onCloseFocus,
  onFinished,
  onSignedOut,
}: Common) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const { alert, show, node } = useDialogAlert();
  const to = PREVIOUS_STEP[card.status] ?? 'PLACED';
  // "Not picked up after all" only from Out for delivery.
  const reasons = MOVE_BACK_REASONS.filter(
    (reason) => reason !== 'not-picked-up' || card.status === 'PICKED_UP',
  );
  const courier = holdingCourier(card.courier);

  const form = useForm({
    defaultValues: { reason: '', note: '' },
    validationLogic: revalidateLogic({ mode: 'submit', modeAfterSubmission: 'change' }),
    validators: {
      onDynamic: ({ value }) => {
        const fields = zodFieldErrors(moveBackInput, {
          orderId: card.id,
          expectedVersion: card.version,
          ...value,
        });
        return fields ? { fields } : undefined;
      },
    },
    onSubmitInvalid: () => focusFirstProblem(formRef.current),
    onSubmit: async ({ value }) => {
      if (pending) return;
      const parsed = moveBackInput.safeParse({
        orderId: card.id,
        expectedVersion: card.version,
        ...value,
      });
      if (!parsed.success) return;
      setPending(true);
      setServerErrors({});
      const outcome = await callAction(() => moveBackAction(parsed.data));
      setPending(false);
      if (outcome.ok) {
        announce(movedBackAnnouncement(card.number, outcome.data.status));
        onFinished({ card, result: outcome.data });
        return;
      }
      if (outcome.error.code === 'UNAUTHENTICATED') {
        onSignedOut();
        onClose();
        return;
      }
      setServerErrors(firstErrors(outcome.error));
      const text = failureText(outcome.error, timeZone);
      if (text) show(text);
      else focusFirstProblem(formRef.current);
    },
  });
  const submitted = useStore(form.store, (state) => state.submissionAttempts > 0);
  const reason = useStore(form.store, (state) => state.values.reason);
  const errorOf = (name: string, errors: readonly unknown[]) => {
    const first = errors.find((error) => typeof error === 'string');
    return (submitted && typeof first === 'string' ? first : null) ?? serverErrors[name] ?? null;
  };

  return (
    <ActionDialog
      open
      title={moveBackTitle(card.number, to)}
      pending={pending}
      safeLabel={keepInColumnText(card.status)}
      actionLabel="Move back"
      pendingLabel="Moving back…"
      blocked={offline}
      blockedReason={offline ? "You're offline." : null}
      closeOnly={alert?.closeOnly ?? false}
      formRef={formRef}
      onClose={onClose}
      onCloseFocus={onCloseFocus}
      onSubmit={() => void form.handleSubmit()}
    >
      {node}
      {alert?.closeOnly ? null : (
        <>
          {courier && card.status === 'READY' ? (
            <FormAlert variant="warning">{moveBackCourierLine(courier)}</FormAlert>
          ) : null}
          {to === 'PLACED' ? (
            <FormAlert variant="warning">The customer will be able to cancel it again.</FormAlert>
          ) : null}
          <form.Field name="reason">
            {(field) => (
              <ReasonFieldset
                name="move-back-reason"
                reasons={reasons}
                labels={MOVE_BACK_REASON_LABELS}
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
                onChange={(note) => field.handleChange(note)}
                onBlur={field.handleBlur}
              />
            )}
          </form.Field>
        </>
      )}
    </ActionDialog>
  );
}

export function HandoverDialog({
  step,
  card,
  timeZone,
  offline,
  onClose,
  onCloseFocus,
  onFinished,
  onSignedOut,
}: Common & { step: 'pickUp' | 'deliver' }) {
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const { alert, show, node } = useDialogAlert();
  const deliver = step === 'deliver';
  // A9.2: a cash order's delivery needs the tick; card orders don't show it.
  const cashCents =
    deliver && card.payment.method === 'cash' && card.view === 'full'
      ? card.payment.totalCents
      : null;
  const schema = deliver ? markDeliveredInput : markPickedUpInput;
  // F7 (design 2.11, D30): with a courier on the order, "by the assigned courier" comes first and
  // is chosen already; without one it isn't offered at all.
  const courier = holdingCourier(card.courier);
  const reasons = HANDOVER_REASONS;
  const labels: Record<HandoverReason, string> = courier
    ? {
        ...HANDOVER_REASON_LABELS,
        'courier-app-down': deliver
          ? deliveredByCourierReason(courier)
          : assignedCourierReason(courier),
      }
    : HANDOVER_REASON_LABELS;

  const form = useForm({
    defaultValues: {
      reason: courier ? 'courier-app-down' : '',
      note: '',
      cashCollected: false,
    },
    validationLogic: revalidateLogic({ mode: 'submit', modeAfterSubmission: 'change' }),
    validators: {
      onDynamic: ({ value }) => {
        const fields =
          zodFieldErrors(schema, {
            orderId: card.id,
            expectedVersion: card.version,
            reason: value.reason,
            note: value.note,
            ...(deliver ? { cashCollected: value.cashCollected } : {}),
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
      const base = {
        orderId: card.id,
        expectedVersion: card.version,
        reason: value.reason,
        note: value.note,
      };
      setPending(true);
      setServerErrors({});
      const outcome = deliver
        ? await (() => {
            const parsed = markDeliveredInput.safeParse({
              ...base,
              cashCollected: value.cashCollected,
            });
            return parsed.success
              ? callAction(() => markDeliveredAction(parsed.data))
              : Promise.resolve({ ok: false as const, error: invalid(parsed.error.message) });
          })()
        : await (() => {
            const parsed = markPickedUpInput.safeParse(base);
            return parsed.success
              ? callAction(() => markPickedUpAction(parsed.data))
              : Promise.resolve({ ok: false as const, error: invalid(parsed.error.message) });
          })();
      setPending(false);
      if (outcome.ok) {
        announce(deliver ? deliveredAnnouncement(card.number) : pickedUpAnnouncement(card.number));
        onFinished({ card, result: outcome.data });
        return;
      }
      if (outcome.error.code === 'UNAUTHENTICATED') {
        onSignedOut();
        onClose();
        return;
      }
      setServerErrors(firstErrors(outcome.error));
      const text = failureText(outcome.error, timeZone);
      if (text) show(text);
      else focusFirstProblem(formRef.current);
    },
  });
  const submitted = useStore(form.store, (state) => state.submissionAttempts > 0);
  const reason = useStore(form.store, (state) => state.values.reason);
  const errorOf = (name: string, errors: readonly unknown[]) => {
    const first = errors.find((error) => typeof error === 'string');
    return (submitted && typeof first === 'string' ? first : null) ?? serverErrors[name] ?? null;
  };

  return (
    <ActionDialog
      open
      title={deliver ? deliverTitle(card.number) : pickUpTitle(card.number)}
      pending={pending}
      safeLabel="Not yet"
      actionLabel={deliver ? 'Mark delivered' : 'Mark picked up'}
      pendingLabel="Marking…"
      blocked={offline}
      blockedReason={offline ? "You're offline." : null}
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
              <ReasonFieldset<HandoverReason>
                name="handover-reason"
                reasons={reasons}
                labels={labels}
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
                onChange={(note) => field.handleChange(note)}
                onBlur={field.handleBlur}
              />
            )}
          </form.Field>
          {courier && !deliver && reason && reason !== 'courier-app-down' ? (
            <OutcomeBox lines={[otherWayLine(courier)]} />
          ) : null}
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
        </>
      )}
    </ActionDialog>
  );
}

const invalid = (message: string): ActionFailure => ({ code: 'INVALID_INPUT', message });
