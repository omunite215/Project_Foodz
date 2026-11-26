'use client';

import { revalidateLogic, useForm, useStore } from '@tanstack/react-form';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import type { OrderStatus } from '@/server/db/enums';
import {
  cancelPreviewAction,
  refuseOrderAction,
  staffCancelOrderAction,
} from '@/server/modules/board/actions';
import {
  type BoardCard,
  type CancelPreview,
  REFUSE_REASONS,
  refuseOrderInput,
  STAFF_CANCEL_REASONS,
  type StaffCancelResult,
  staffCancelInput,
} from '@/server/modules/board/schema';
import { STAFF_CANCELLABLE } from '@/server/modules/board/state';
import { alreadyAcceptedMessage, CANCEL_REASON_LABELS } from '@/server/modules/board/text';
import { focusThenAnnounce } from '@/components/forms/feedback';
import { FormAlert } from '@/components/forms/form-alert';
import { type ActionFailure, callAction } from '@/lib/action-result';
import { announce } from '@/lib/announce';
import {
  alsoSoldOutText,
  cancelledAnnouncement,
  cancelOutcomeLines,
  cancelTitle,
  changedWhileDecidingText,
  conflictText,
  refusedAnnouncement,
  refuseOutcomeText,
  refuseTitle,
  stepUpLockedText,
} from '@/lib/board/text';
import { isOrderChangedDetails } from '@/lib/board/model';
import { cancelCourierLine, holdingCourier } from '@/lib/board/courier-text';
import { ActionDialog } from './action-dialog';
import {
  DishTicks,
  focusFirstProblem,
  OutcomeBox,
  ReasonFieldset,
  StaffNoteField,
  TickRow,
  zodFieldErrors,
} from './dialog-fields';
import { type StepUpMethod, StepUpField } from './step-up-field';

/*
 * "Can't make it" (KITCHEN, New orders, design 3.2) and staff "Cancel order" (SUPPORT, ADMIN,
 * New to Ready, design 3.3). They open with the order's cancel preview: what will happen to
 * the money, the dish ticks, and whether the step-up code shows from the start (D31). If the
 * order moves while the dialog is open, its content changes in place (design 3.4).
 */

export type CancelMode = 'refuse' | 'cancel';

export interface CancelFinished {
  card: BoardCard;
  result: StaffCancelResult;
}

const STEP_UP_PROMPT = 'Enter a code from your authenticator app to continue.';

type Alert =
  | { kind: 'changed'; text: string }
  | { kind: 'gone'; text: string }
  | { kind: 'error'; text: string };

const retryAtOf = (failure: ActionFailure): string | null => {
  const retryAt = failure.details?.retryAt;
  return typeof retryAt === 'string' ? retryAt : null;
};

export function CancelDialog({
  mode,
  card,
  current,
  canMarkSoldOut,
  timeZone,
  offline,
  onClose,
  onCloseFocus,
  onFinished,
  onSignedOut,
}: {
  mode: CancelMode;
  card: BoardCard;
  /** The card as the board holds it now; null once it has left the board. */
  current: BoardCard | null;
  /** KITCHEN and ADMIN may tick "Also mark … sold out" (design 3.2 step 3). */
  canMarkSoldOut: boolean;
  timeZone: string;
  offline: boolean;
  onClose: () => void;
  onCloseFocus: () => boolean;
  onFinished: (finished: CancelFinished) => void;
  onSignedOut: () => void;
}) {
  const refuse = mode === 'refuse';
  const formRef = useRef<HTMLFormElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [alert, setAlert] = useState<Alert | null>(null);
  const [version, setVersion] = useState(card.version);
  const [stepUp, setStepUp] = useState<{ shown: boolean; method: StepUpMethod; code: string }>({
    shown: false,
    method: 'totp',
    code: '',
  });
  const [codeError, setCodeError] = useState<string | null>(null);
  const [lockedUntil, setLockedUntil] = useState<string | null>(null);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});

  const previewKey = ['board', 'cancelPreview', card.id] as const;
  const preview = useQuery({
    queryKey: previewKey,
    queryFn: async (): Promise<CancelPreview> => {
      const outcome = await callAction(() => cancelPreviewAction({ orderId: card.id }));
      if (!outcome.ok) {
        if (outcome.error.code === 'UNAUTHENTICATED') onSignedOut();
        throw new Error(outcome.error.message);
      }
      return outcome.data;
    },
    staleTime: 0,
    gcTime: 0,
  });
  const data = preview.data;

  // The preview decides the version sent and whether the code shows from the start (D31).
  useEffect(() => {
    if (!data) return undefined;
    const timer = setTimeout(() => {
      setVersion(data.version);
      if (data.view === 'full' && data.stepUpRequired) {
        setStepUp((value) => (value.shown ? value : { ...value, shown: true }));
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [data]);

  const allowed = (status: OrderStatus) =>
    refuse ? status === 'PLACED' : STAFF_CANCELLABLE.includes(status);

  /** Design 3.4: the order changed while the dialog was open. */
  const showChanged = (next: Alert) => {
    setAlert(next);
    // The one place a live change moves focus: inside this dialog, to the new alert.
    requestAnimationFrame(() => alertRef.current?.focus());
    announce(next.text);
  };

  const liveVersion = current?.version ?? null;
  const left = current === null;
  useEffect(() => {
    if (pending) return undefined;
    if (!left && (liveVersion === null || liveVersion <= version)) return undefined;
    let cancelled = false;
    void (async () => {
      const latest = (await preview.refetch()).data;
      if (cancelled || !latest) return;
      if (latest.version <= version) return;
      if (latest.possible && allowed(latest.status)) {
        setVersion(latest.version);
        showChanged({
          kind: 'changed',
          text: changedWhileDecidingText(
            card.number,
            latest.status,
            null,
            current?.preparingAt ?? current?.acceptedAt ?? null,
            timeZone,
            refuse ? 'Refuse it anyway?' : 'Cancel it anyway?',
          ),
        });
      } else {
        showChanged({
          kind: 'gone',
          text:
            refuse && latest.status !== 'CANCELLED'
              ? alreadyAcceptedMessage(card.number)
              : `Order ${card.number} was cancelled.`,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
    // Runs when the board's copy of the order moves past the version this dialog describes.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [liveVersion, left]);

  const schema = refuse ? refuseOrderInput : staffCancelInput;
  const form = useForm({
    defaultValues: { reason: '', lineIds: [] as string[], markSoldOut: true, note: '' },
    validationLogic: revalidateLogic({ mode: 'submit', modeAfterSubmission: 'change' }),
    validators: {
      onDynamic: ({ value }) => {
        const fields = zodFieldErrors(schema, {
          orderId: card.id,
          expectedVersion: version,
          reason: value.reason,
          lineIds: value.lineIds,
          markSoldOut: value.markSoldOut,
          note: value.note,
        });
        return fields ? { fields } : undefined;
      },
    },
    onSubmitInvalid: () => focusFirstProblem(formRef.current),
    onSubmit: async ({ value }) => {
      if (pending || lockedUntil) return;
      setPending(true);
      setServerErrors({});
      setCodeError(null);
      const lines = data?.lines ?? card.lines;
      const offerSoldOut =
        canMarkSoldOut &&
        value.reason === 'dish-unavailable' &&
        alsoSoldOutText(lines, value.lineIds) !== null;
      const input = {
        orderId: card.id,
        expectedVersion: version,
        reason: value.reason,
        lineIds: value.lineIds,
        markSoldOut: offerSoldOut && value.markSoldOut,
        note: value.note,
      };
      // The module's schemas shape what is sent (reasons, ticks, the note, the code).
      const outcome = await submitCancellation(
        refuse,
        input,
        !refuse && stepUp.shown && stepUp.code
          ? { method: stepUp.method, code: stepUp.code }
          : null,
      );
      setPending(false);
      if (outcome.ok) {
        announce(refuse ? refusedAnnouncement(card.number) : cancelledAnnouncement(card.number));
        onFinished({ card, result: outcome.data });
        return;
      }
      handleFailure(outcome.error);
    },
  });

  function handleFailure(failure: ActionFailure) {
    switch (failure.code) {
      case 'UNAUTHENTICATED':
        onSignedOut();
        onClose();
        return;
      case 'ORDER_CHANGED': {
        if (!isOrderChangedDetails(failure.details)) break;
        const details = failure.details;
        if (allowed(details.current.status)) {
          setVersion(details.current.version);
          void preview.refetch();
          showChanged({
            kind: 'changed',
            text: changedWhileDecidingText(
              card.number,
              details.current.status,
              details.lastChange?.by ?? null,
              details.lastChange?.at ?? null,
              timeZone,
              refuse ? 'Refuse it anyway?' : 'Cancel it anyway?',
            ),
          });
        } else {
          showChanged({ kind: 'gone', text: conflictText(details, null, timeZone) });
        }
        return;
      }
      case 'INVALID_STATE':
        showChanged({ kind: 'gone', text: failure.message });
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
        const retryAt = retryAtOf(failure);
        const text = retryAt ? stepUpLockedText(retryAt, timeZone) : failure.message;
        setLockedUntil(retryAt ?? 'locked');
        showChanged({ kind: 'error', text });
        return;
      }
      case 'INVALID_INPUT': {
        const fields = Object.fromEntries(
          Object.entries(failure.fieldErrors ?? {}).map(([key, messages]) => [
            key,
            messages[0] ?? '',
          ]),
        );
        setServerErrors(fields);
        focusFirstProblem(formRef.current);
        return;
      }
      default:
        break;
    }
    showChanged({ kind: 'error', text: failure.message });
  }

  const submitted = useStore(form.store, (state) => state.submissionAttempts > 0);
  const reason = useStore(form.store, (state) => state.values.reason);
  const fieldError = (name: string, errors: readonly unknown[]) => {
    const first = errors.find((error) => typeof error === 'string');
    return (submitted && typeof first === 'string' ? first : null) ?? serverErrors[name] ?? null;
  };

  const reasons = refuse ? REFUSE_REASONS : STAFF_CANCEL_REASONS;
  const lines = data?.lines ?? card.lines;
  // F7 (design 2.11): a courier on the way is told it's cancelled.
  const courier = holdingCourier(card.courier);
  const outcomeLines = data
    ? [
        ...(refuse ? [refuseOutcomeText(data)] : cancelOutcomeLines(data)),
        ...(courier && !refuse ? [cancelCourierLine(courier)] : []),
      ]
    : [];
  const closeOnly = alert?.kind === 'gone';
  const blockedReason = offline ? "You're offline." : lockedUntil ? alert?.text : null;

  return (
    <ActionDialog
      open
      title={refuse ? refuseTitle(card.number) : cancelTitle(card.number)}
      pending={pending}
      irreversible
      safeLabel="Keep order"
      actionLabel={refuse ? 'Refuse order' : 'Cancel order'}
      pendingLabel={refuse ? 'Refusing…' : 'Cancelling…'}
      danger
      blocked={offline || Boolean(lockedUntil)}
      blockedReason={blockedReason ?? null}
      closeOnly={closeOnly}
      formRef={formRef}
      onClose={onClose}
      onCloseFocus={onCloseFocus}
      onSubmit={() => void form.handleSubmit()}
    >
      {alert ? (
        <div ref={alertRef} tabIndex={-1} className="outline-none">
          <FormAlert
            variant={
              alert.kind === 'changed' ? 'warning' : alert.kind === 'gone' ? 'info' : 'error'
            }
          >
            {alert.text}
          </FormAlert>
        </div>
      ) : null}
      {closeOnly ? null : (
        <>
          <form.Field name="reason">
            {(field) => (
              <ReasonFieldset
                name="reason"
                reasons={reasons}
                labels={CANCEL_REASON_LABELS}
                value={field.state.value}
                error={fieldError('reason', field.state.meta.errors)}
                onChange={(chosen) => {
                  field.handleChange(chosen);
                  setServerErrors(({ reason: _gone, ...rest }) => rest);
                }}
                renderAfter={(shownFor) =>
                  shownFor === 'dish-unavailable' ? (
                    <form.Field name="lineIds">
                      {(ticks) => (
                        <>
                          <DishTicks
                            lines={lines}
                            value={ticks.state.value}
                            error={fieldError('lineIds', ticks.state.meta.errors)}
                            onChange={(ids) => ticks.handleChange(ids)}
                          />
                          {canMarkSoldOut ? (
                            <form.Field name="markSoldOut">
                              {(soldOut) => (
                                <SoldOutTick
                                  text={alsoSoldOutText(lines, ticks.state.value)}
                                  checked={soldOut.state.value}
                                  onChange={(checked) => soldOut.handleChange(checked)}
                                />
                              )}
                            </form.Field>
                          ) : null}
                        </>
                      )}
                    </form.Field>
                  ) : null
                }
              />
            )}
          </form.Field>
          <form.Field name="note">
            {(field) => (
              <StaffNoteField
                required={reason === 'other'}
                value={field.state.value}
                error={fieldError('note', field.state.meta.errors)}
                onChange={(note) => field.handleChange(note)}
                onBlur={field.handleBlur}
              />
            )}
          </form.Field>
          {outcomeLines.length ? (
            <OutcomeBox lines={outcomeLines} />
          ) : (
            <div aria-busy className="h-14 rounded-xl bg-neutral-7 motion-safe:animate-skeleton">
              <span className="sr-only">Loading what will happen</span>
            </div>
          )}
          {!refuse && stepUp.shown ? (
            <StepUpField
              method={stepUp.method}
              value={stepUp.code}
              error={codeError}
              disabled={Boolean(lockedUntil)}
              inputRef={codeRef}
              onChange={(code) => {
                setStepUp((value) => ({ ...value, code }));
                setCodeError(null);
              }}
              onSwap={() =>
                setStepUp((value) => ({
                  ...value,
                  method: value.method === 'totp' ? 'backup' : 'totp',
                  code: '',
                }))
              }
            />
          ) : null}
        </>
      )}
    </ActionDialog>
  );
}

const unparsed = (message: string): ActionFailure => ({ code: 'INVALID_INPUT', message });

/** Sends a refusal or a staff cancellation, shaped by the module's schema first. */
async function submitCancellation(
  refuse: boolean,
  input: {
    orderId: string;
    expectedVersion: number;
    reason: string;
    lineIds: string[];
    markSoldOut: boolean;
    note: string;
  },
  stepUp: { method: StepUpMethod; code: string } | null,
) {
  if (refuse) {
    const parsed = refuseOrderInput.safeParse(input);
    if (!parsed.success) return { ok: false as const, error: unparsed(parsed.error.message) };
    return callAction(() => refuseOrderAction(parsed.data));
  }
  const parsed = staffCancelInput.safeParse(stepUp ? { ...input, stepUp } : input);
  if (!parsed.success) {
    const codeIssue = parsed.error.issues.find((issue) => issue.path[0] === 'stepUp');
    return {
      ok: false as const,
      error: codeIssue
        ? {
            code: 'STEP_UP_INVALID',
            message: codeIssue.message,
            fieldErrors: { stepUp: [codeIssue.message] },
          }
        : unparsed(parsed.error.message),
    };
  }
  return callAction(() => staffCancelOrderAction(parsed.data));
}

/** "Also mark Pad Thai sold out on the menu", ticked by default (design 3.2 step 3, D21). */
function SoldOutTick({
  text,
  checked,
  onChange,
}: {
  text: string | null;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  if (!text) return null;
  return (
    <div className="pl-8">
      <TickRow id={id} checked={checked} onChange={onChange} describedBy={`${id}-hint`}>
        {text}
      </TickRow>
      <p id={`${id}-hint`} className="pl-8 text-body-5 text-muted-foreground">
        Customers can&apos;t order them until someone turns them back on.
      </p>
    </div>
  );
}
