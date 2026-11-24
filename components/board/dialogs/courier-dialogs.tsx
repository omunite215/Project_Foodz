'use client';

import { revalidateLogic, useForm, useStore } from '@tanstack/react-form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Info, RefreshCw } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import {
  assignableCouriersAction,
  sendStaffOfferAction,
  takeOffCourierAction,
} from '@/server/modules/delivery/actions';
import type { BoardCard } from '@/server/modules/board/schema';
import {
  type AssignableCouriers,
  type StaffDispatchResult,
  TAKE_OFF_REASONS,
  type TakeOffReason,
  takeOffCourierInput,
} from '@/server/modules/delivery/schema';
import { FormAlert } from '@/components/forms/form-alert';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/field';
import { Skeleton } from '@/components/ui/skeleton';
import { type ActionFailure, callAction } from '@/lib/action-result';
import { announce } from '@/lib/announce';
import {
  ASSIGN_COPY,
  assignRowLine,
  assignRowSpoken,
  assignTags,
  assignTitle,
  deliveryChangedText,
  isDeliveryChangedDetails,
  offerSentAnnouncement,
  offlineCountText,
  shortOf,
  TAKE_OFF_LABELS,
  takenOffAnnouncement,
  takeOffOutcome,
  takeOffTitle,
} from '@/lib/board/courier-text';
import { ActionDialog } from './action-dialog';
import {
  focusFirstProblem,
  OutcomeBox,
  ReasonFieldset,
  StaffNoteField,
  zodFieldErrors,
} from './dialog-fields';

/*
 * Sending a courier and taking one off (F7 design 2.7, 2.8): the assign dialog lists online
 * couriers in dispatch order, tagged ones still selectable and unavailable ones apart and
 * disabled; the take-off dialog asks for a reason. Both carry the delivery's version and say
 * what changed when it moved meanwhile (A42).
 */

export const assignableKey = (orderId: string) => ['delivery', 'assignable', orderId] as const;

class AssignableError extends Error {
  constructor(readonly failure: ActionFailure) {
    super(failure.message);
  }
}

async function readAssignable(orderId: string): Promise<AssignableCouriers> {
  const outcome = await callAction(() => assignableCouriersAction({ orderId }));
  if (!outcome.ok) throw new AssignableError(outcome.error);
  return outcome.data;
}

interface Common {
  card: BoardCard;
  timeZone: string;
  offline: boolean;
  /** The demo admin: everything shows, nothing sends. */
  readOnly?: boolean;
  onClose: () => void;
  onCloseFocus: () => boolean;
  onSignedOut: () => void;
}

/** The dialog's alert: a refusal (error) or a change that ends it (info, Close only). */
function useAlert() {
  const ref = useRef<HTMLDivElement>(null);
  const [alert, setAlert] = useState<{ text: string; closeOnly: boolean } | null>(null);
  const show = (next: { text: string; closeOnly: boolean }) => {
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

function failureText(
  failure: ActionFailure,
  orderNumber: string,
  timeZone: string,
): { text: string; closeOnly: boolean } {
  if (failure.code === 'DELIVERY_CHANGED' && isDeliveryChangedDetails(failure.details)) {
    return {
      text: deliveryChangedText(orderNumber, failure.details, timeZone, failure.message),
      closeOnly: true,
    };
  }
  if (failure.code === 'INVALID_STATE' || failure.code === 'NOT_ASSIGNED') {
    return { text: failure.message, closeOnly: true };
  }
  return { text: failure.message, closeOnly: false };
}

export function AssignCourierDialog({
  card,
  timeZone,
  offline,
  readOnly = false,
  onClose,
  onCloseFocus,
  onSignedOut,
  onFinished,
}: Common & { onFinished: (result: StaffDispatchResult, shortName: string) => void }) {
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const { alert, show, clear, node } = useAlert();
  const query = useQuery({
    queryKey: assignableKey(card.id),
    queryFn: () => readAssignable(card.id),
    staleTime: 0,
    retry: false,
  });
  const data = query.data;
  const choosable = data?.rows.filter((row) => !row.disabledReason) ?? [];
  const unable = data?.rows.filter((row) => row.disabledReason) ?? [];
  const nobody = data !== undefined && data.rows.length === 0;

  const form = useForm({
    defaultValues: { partnerId: '' },
    validationLogic: revalidateLogic({ mode: 'submit', modeAfterSubmission: 'change' }),
    validators: {
      onDynamic: ({ value }) =>
        value.partnerId ? undefined : { fields: { partnerId: ASSIGN_COPY.choose } },
    },
    onSubmitInvalid: () => focusFirstProblem(formRef.current),
    onSubmit: async ({ value }) => {
      if (pending || !data) return;
      const row = data.rows.find((item) => item.partnerId === value.partnerId);
      if (!row) return;
      setPending(true);
      clear();
      const outcome = await callAction(() =>
        sendStaffOfferAction({
          orderId: card.id,
          partnerId: row.partnerId,
          expectedVersion: data.deliveryVersion,
        }),
      );
      setPending(false);
      if (outcome.ok) {
        const short = shortOf(row.name);
        announce(offerSentAnnouncement(short));
        onFinished(outcome.data, short);
        return;
      }
      if (outcome.error.code === 'UNAUTHENTICATED') {
        onSignedOut();
        onClose();
        return;
      }
      show(failureText(outcome.error, card.number, timeZone));
      if (outcome.error.code === 'COURIER_UNAVAILABLE') {
        // The list refreshes and the choice is cleared (A37.5).
        form.reset();
        void queryClient.invalidateQueries({ queryKey: assignableKey(card.id) });
      }
    },
  });
  const submitted = useStore(form.store, (state) => state.submissionAttempts > 0);
  const blockedReason = offline
    ? "You're offline."
    : readOnly
      ? 'Read-only in the demo'
      : nobody
        ? ASSIGN_COPY.nobody
        : null;

  return (
    <ActionDialog
      open
      title={assignTitle(card.number)}
      pending={pending}
      safeLabel={ASSIGN_COPY.safe}
      actionLabel={ASSIGN_COPY.action}
      pendingLabel={ASSIGN_COPY.pending}
      blocked={Boolean(blockedReason)}
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
          <p className="text-body-4 text-neutral-2">{ASSIGN_COPY.description}</p>
          <div>
            <div className="flex items-center justify-between gap-3">
              <p className="text-body-5 font-medium text-neutral-2">{ASSIGN_COPY.online}</p>
              <Button
                type="button"
                variant="ghost"
                className="h-11 gap-1.5 px-2 text-body-5 font-medium text-neutral-1 underline underline-offset-4"
                onClick={() => {
                  form.reset();
                  void query.refetch();
                }}
              >
                <RefreshCw className="size-4" aria-hidden />
                {ASSIGN_COPY.refresh}
              </Button>
            </div>
            {query.isPending ? (
              <output className="mt-2 block space-y-2">
                <span className="sr-only">{ASSIGN_COPY.loading}</span>
                {[0, 1, 2].map((row) => (
                  <Skeleton key={row} className="h-16 rounded-xl motion-reduce:animate-none" />
                ))}
              </output>
            ) : query.isError ? (
              <FormAlert variant="error" className="mt-2">
                {query.error instanceof AssignableError
                  ? query.error.failure.message
                  : "We couldn't load the couriers. Try Refresh list."}
              </FormAlert>
            ) : nobody ? (
              <FormAlert variant="info" className="mt-2">
                {ASSIGN_COPY.nobody}
              </FormAlert>
            ) : (
              <form.Field name="partnerId">
                {(field) => {
                  const first = field.state.meta.errors.find((error) => typeof error === 'string');
                  const error = submitted && typeof first === 'string' ? first : null;
                  const errorId = error ? `${id}-error` : undefined;
                  return (
                    <fieldset aria-describedby={errorId} className="mt-2 min-w-0">
                      <legend className="sr-only">{ASSIGN_COPY.online}</legend>
                      <FieldError id={errorId}>{error}</FieldError>
                      <div className="space-y-2">
                        {choosable.map((row, index) => {
                          const tags = assignTags(row.tags, timeZone);
                          const tagsId = `${id}-${row.partnerId}-tags`;
                          return (
                            <label
                              key={row.partnerId}
                              className="flex min-h-16 cursor-pointer gap-3 rounded-xl border border-neutral-6 bg-white px-4 py-3 has-[:checked]:border-2 has-[:checked]:border-brand-strong has-[:checked]:bg-brand-soft has-[:checked]:px-[15px] has-[:checked]:py-[11px] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring has-[:focus-visible]:outline-solid"
                            >
                              <input
                                type="radio"
                                name="assign-courier"
                                value={row.partnerId}
                                checked={field.state.value === row.partnerId}
                                onChange={() => field.handleChange(row.partnerId)}
                                aria-label={assignRowSpoken(row)}
                                aria-describedby={tags.length ? tagsId : undefined}
                                data-invalid={error && index === 0 ? 'true' : undefined}
                                className="mt-1 size-5 shrink-0 accent-brand-strong outline-none"
                              />
                              <span className="min-w-0">
                                <span className="block text-body-4 font-medium text-neutral-1 [overflow-wrap:anywhere]">
                                  {row.name}
                                </span>
                                <span className="block text-body-5 text-neutral-3">
                                  {assignRowLine(row)}
                                </span>
                                {tags.length ? (
                                  <span id={tagsId} className="mt-1.5 flex flex-wrap gap-1.5">
                                    {tags.map((tag) => (
                                      <span
                                        key={tag}
                                        className="inline-flex h-6 items-center gap-1 rounded-md bg-tag-6-bg px-2 text-caption font-medium text-neutral-1"
                                      >
                                        <Info className="size-3 text-warning-strong" aria-hidden />
                                        {tag}
                                      </span>
                                    ))}
                                  </span>
                                ) : null}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </fieldset>
                  );
                }}
              </form.Field>
            )}
            {unable.length ? (
              <div className="mt-5">
                <p className="text-body-5 font-medium text-neutral-2">{ASSIGN_COPY.unable}</p>
                <ul className="mt-2 space-y-2">
                  {unable.map((row) => (
                    <li
                      key={row.partnerId}
                      className="flex min-h-16 gap-3 rounded-xl border border-neutral-6 bg-neutral-7 px-4 py-3 text-neutral-3"
                    >
                      <input
                        type="radio"
                        disabled
                        aria-label={`${row.name}, ${row.disabledReason ?? ''}`}
                        className="mt-1 size-5 shrink-0"
                      />
                      <span className="min-w-0">
                        <span className="block text-body-4 font-medium [overflow-wrap:anywhere]">
                          {row.name}
                        </span>
                        <span className="block text-body-5">{row.disabledReason}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {data && data.offlineCount > 0 ? (
              <p className="mt-4 text-body-5 text-neutral-3">
                {offlineCountText(data.offlineCount)}
              </p>
            ) : null}
          </div>
        </>
      )}
    </ActionDialog>
  );
}

export function TakeOffCourierDialog({
  card,
  shortName,
  expectedVersion,
  chooseAnother = false,
  timeZone,
  offline,
  readOnly = false,
  onClose,
  onCloseFocus,
  onSignedOut,
  onFinished,
}: Common & {
  shortName: string;
  expectedVersion: number;
  /** "Choose another courier": the same dialog, then the assign dialog (D23). */
  chooseAnother?: boolean;
  onFinished: (result: StaffDispatchResult) => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const { alert, show, node } = useAlert();

  const form = useForm({
    defaultValues: { reason: '', note: '' },
    validationLogic: revalidateLogic({ mode: 'submit', modeAfterSubmission: 'change' }),
    validators: {
      onDynamic: ({ value }) => {
        const fields = zodFieldErrors(takeOffCourierInput, {
          orderId: card.id,
          expectedVersion,
          reason: value.reason,
          note: value.note,
        });
        return fields ? { fields } : undefined;
      },
    },
    onSubmitInvalid: () => focusFirstProblem(formRef.current),
    onSubmit: async ({ value }) => {
      if (pending) return;
      const parsed = takeOffCourierInput.safeParse({
        orderId: card.id,
        expectedVersion,
        reason: value.reason,
        note: value.note,
      });
      if (!parsed.success) return;
      setPending(true);
      setServerErrors({});
      const outcome = await callAction(() => takeOffCourierAction(parsed.data));
      setPending(false);
      if (outcome.ok) {
        announce(takenOffAnnouncement(shortName, card.number));
        onFinished(outcome.data);
        return;
      }
      if (outcome.error.code === 'UNAUTHENTICATED') {
        onSignedOut();
        onClose();
        return;
      }
      const fields = Object.fromEntries(
        Object.entries(outcome.error.fieldErrors ?? {}).map(([key, list]) => [key, list[0] ?? '']),
      );
      setServerErrors(fields);
      if (outcome.error.code === 'INVALID_INPUT' && Object.keys(fields).length) {
        focusFirstProblem(formRef.current);
        return;
      }
      show(failureText(outcome.error, card.number, timeZone));
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
      title={takeOffTitle(card.number, shortName)}
      pending={pending}
      safeLabel="Keep courier"
      actionLabel={chooseAnother ? 'Take off and choose another' : 'Take off courier'}
      pendingLabel="Taking off…"
      danger
      blocked={Boolean(blockedReason)}
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
              <ReasonFieldset<TakeOffReason>
                name="take-off-reason"
                reasons={TAKE_OFF_REASONS}
                labels={TAKE_OFF_LABELS}
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
          <OutcomeBox lines={[takeOffOutcome(shortName)]} />
        </>
      )}
    </ActionDialog>
  );
}
