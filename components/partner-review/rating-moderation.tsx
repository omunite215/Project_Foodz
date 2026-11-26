'use client';

import { revalidateLogic, useForm, useStore } from '@tanstack/react-form';
import { EyeOff, PencilLine } from 'lucide-react';
import Link from 'next/link';
import { type ReactNode, useId, useRef, useState } from 'react';
import { excludeRatingAction, includeRatingAction } from '@/server/modules/ratings/actions';
import {
  EXCLUDE_REASONS,
  type ExcludeReason,
  excludeRatingInput,
  RATING_ERRORS,
  type StaffRatingRow,
} from '@/server/modules/ratings/schema';
import { showBoardNotice } from '@/components/admin/board-notices';
import { useStaffShell } from '@/components/admin/staff-shell-context';
import { ActionDialog } from '@/components/board/dialogs/action-dialog';
import {
  focusFirstProblem,
  OutcomeBox,
  ReasonFieldset,
  StaffNoteField,
  zodFieldErrors,
} from '@/components/board/dialogs/dialog-fields';
import { FormAlert } from '@/components/forms/form-alert';
import { BLOCKED_BUTTON_CLASS, useSlowPending } from '@/components/forms/submit-button';
import { StarsDisplay } from '@/components/ratings/stars-display';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { type ActionFailure, callAction } from '@/lib/action-result';
import {
  commentPreview,
  excludeButtonName,
  excludedLine,
  excludeOutcome,
  excludeReasonLabels,
  excludeTitle,
  MONEY_COPY,
  READ_ONLY_DEMO,
  ratingWhen,
  tagWord,
} from '@/lib/admin/earnings-text';
import { announce } from '@/lib/announce';
import { starsCount } from '@/lib/rating-text';
import { cn } from '@/lib/utils';

/*
 * Taking a rating out of an average and putting it back (F9 design 3.10, 3.11, 3.16): one row
 * of the staff ratings list or the order's feedback, the Exclude dialog (a reason, a note,
 * reversible, so primary rather than danger) and "Include again", which acts at once. When two
 * staff race, the second is told who moved it first.
 */

export type ModerationChange =
  | { status: 'excluded'; excluded: NonNullable<StaffRatingRow['excluded']> }
  | { status: 'counted' };

const CHIP = 'inline-flex h-6 items-center rounded-md bg-neutral-7 px-2 text-caption font-medium';

/** "Late", "Friendly": a rating's tags as static chips. */
export function TagChips({ tags }: { tags: readonly string[] }) {
  if (tags.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {tags.map((tag) => (
        <li key={tag} className={cn(CHIP, 'text-neutral-1')}>
          {tagWord(tag)}
        </li>
      ))}
    </ul>
  );
}

export function EditedChip() {
  return (
    <span className={cn(CHIP, 'gap-1 text-neutral-1')}>
      <PencilLine className="size-3" aria-hidden />
      Edited
    </span>
  );
}

/** Plain text, line breaks kept, links never clickable (S9.4). */
export function CommentQuote({ comment }: { comment: string | null }) {
  if (!comment) return null;
  return (
    <blockquote className="border-l-2 border-neutral-6 pl-3 text-body-4 whitespace-pre-wrap text-neutral-1 [overflow-wrap:anywhere]">
      {comment}
    </blockquote>
  );
}

export function ExcludedBlock({ row }: { row: StaffRatingRow }) {
  const line = excludedLine(row);
  if (!line || !row.excluded) return null;
  return (
    <p className="inline-flex items-start gap-1.5 rounded-md border-l-4 border-l-neutral-5 bg-neutral-7 px-2 py-1 text-body-5 font-medium text-neutral-1">
      <EyeOff className="mt-[3px] size-3.5 shrink-0 text-neutral-3" aria-hidden />
      <span className="[overflow-wrap:anywhere]">
        {line}
        {row.excluded.note ? (
          <span className="block font-normal whitespace-pre-wrap">Note: {row.excluded.note}</span>
        ) : null}
      </span>
    </p>
  );
}

// ------------------------------------------------------------------ the action button

/**
 * "Exclude from average" (opens the dialog) or "Include again" (acts at once). The button
 * element stays the same when its state flips, so focus stays on it (design, Focus).
 */
export function ModerationButton({
  row,
  timeZone,
  offline,
  onChanged,
  onSignedOut,
}: {
  row: StaffRatingRow;
  timeZone: string;
  offline: boolean;
  onChanged: (row: StaffRatingRow, change: ModerationChange | null) => void;
  onSignedOut: () => void;
}) {
  const captionId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [dialog, setDialog] = useState(false);
  const [including, setIncluding] = useState(false);
  const slow = useSlowPending(including);
  const excluded = row.excluded !== null;
  const demo = row.actions.readOnlyDemo;
  const label = excluded ? 'Include again' : 'Exclude from average';

  const include = async () => {
    setIncluding(true);
    const outcome = await callAction(() =>
      includeRatingAction({ kind: row.kind, ratingId: row.id }),
    );
    setIncluding(false);
    if (outcome.ok) {
      showBoardNotice(outcome.data.boardNotice);
      onChanged(row, { status: 'counted' });
      return;
    }
    if (outcome.error.code === 'UNAUTHENTICATED') {
      onSignedOut();
      return;
    }
    // A race reads who moved it first; a limit or failure reads the server's words.
    showBoardNotice(outcome.error.message, {
      variant: outcome.error.code === 'RATING_CHANGED' ? 'info' : 'error',
    });
    onChanged(row, null);
  };

  return (
    <div className="flex shrink-0 flex-col items-start gap-1">
      <Button
        ref={buttonRef}
        type="button"
        variant="outline"
        size="touch"
        data-rating-button={row.id}
        aria-disabled={demo || offline || including || undefined}
        aria-describedby={demo || offline ? captionId : undefined}
        className={cn('bg-white', (demo || offline) && BLOCKED_BUTTON_CLASS)}
        onClick={() => {
          if (including) return;
          if (demo) {
            announce(READ_ONLY_DEMO);
            return;
          }
          if (offline) {
            announce(MONEY_COPY.offline);
            return;
          }
          if (excluded) void include();
          else setDialog(true);
        }}
      >
        {slow ? (
          <>
            <Spinner className="size-4" aria-hidden />
            Including…
          </>
        ) : (
          <>
            {label}
            <span className="sr-only">
              {excludeButtonName(row, timeZone, excluded).slice(label.length)}
            </span>
          </>
        )}
      </Button>
      {demo || offline ? (
        <span id={captionId} className="text-body-5 text-neutral-3">
          {demo ? READ_ONLY_DEMO : MONEY_COPY.offline}
        </span>
      ) : null}
      {dialog ? (
        <ExcludeRatingDialog
          row={row}
          timeZone={timeZone}
          offline={offline}
          onClose={() => setDialog(false)}
          onCloseFocus={() => {
            buttonRef.current?.focus();
            return true;
          }}
          onDone={(change) => {
            setDialog(false);
            onChanged(row, change);
          }}
          onRace={() => onChanged(row, null)}
          onSignedOut={onSignedOut}
        />
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ one rating

/**
 * One rating (design 3.10's list item, 3.16's feedback row): stars and when, the order and the
 * customer on the partner's list, the action, tags, the comment and the excluded block.
 */
export function StaffRatingItem({
  row,
  timeZone,
  offline,
  title,
  withOrder,
  onChanged,
  onSignedOut,
}: {
  row: StaffRatingRow;
  timeZone: string;
  offline: boolean;
  /** The order's feedback names the dish or the courier above the stars. */
  title?: ReactNode;
  /** The partner's list shows the order link and the customer. */
  withOrder: boolean;
  onChanged: (row: StaffRatingRow, change: ModerationChange | null) => void;
  onSignedOut: () => void;
}) {
  const orderHref = `/admin/orders/${row.orderId}` as const;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          {row.excluded ? <span className="sr-only">Not counted. </span> : null}
          {title ? (
            <p className="text-body-4 font-medium text-neutral-1 [overflow-wrap:anywhere]">
              {title}
            </p>
          ) : null}
          <div
            className={cn(
              'flex flex-wrap items-center gap-2 text-body-5 text-neutral-3 tabular-nums',
              title && 'mt-0.5',
            )}
          >
            <StarsDisplay stars={row.stars} />
            <span>
              {ratingWhen(row, timeZone)}
              {withOrder ? (
                <>
                  {' · '}
                  <Link
                    href={orderHref}
                    className="text-neutral-1 underline underline-offset-4 hover:text-neutral-2"
                  >
                    Order {row.orderNumber}
                  </Link>
                  {` · ${row.customerShort}`}
                </>
              ) : null}
            </span>
            {row.editedAt ? <EditedChip /> : null}
          </div>
        </div>
        <ModerationButton
          row={row}
          timeZone={timeZone}
          offline={offline}
          onChanged={onChanged}
          onSignedOut={onSignedOut}
        />
      </div>
      <TagChips tags={row.tags} />
      <CommentQuote comment={row.comment} />
      <ExcludedBlock row={row} />
    </div>
  );
}

// ------------------------------------------------------------------ the dialog (3.11)

/** The moment this staff member excluded it, until the refetch brings the server's. */
const nowIso = () => new Date().toISOString();

interface ExcludeValues {
  reason: string;
  note: string;
}

export function ExcludeRatingDialog({
  row,
  timeZone,
  offline,
  onClose,
  onCloseFocus,
  onDone,
  onRace,
  onSignedOut,
}: {
  row: StaffRatingRow;
  timeZone: string;
  offline: boolean;
  onClose: () => void;
  onCloseFocus: () => boolean;
  onDone: (change: ModerationChange) => void;
  /** Someone else moved it first: the list refreshes behind the dialog. */
  onRace: () => void;
  onSignedOut: () => void;
}) {
  const id = useId();
  const shell = useStaffShell();
  const formRef = useRef<HTMLFormElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState(false);
  const [race, setRace] = useState<string | null>(null);
  const [alert, setAlert] = useState<string | null>(null);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const labels = excludeReasonLabels(row.kind);

  const inputOf = (value: ExcludeValues) => ({
    kind: row.kind,
    ratingId: row.id,
    reason: value.reason,
    ...(value.note.trim() ? { note: value.note } : {}),
  });

  const defaults: ExcludeValues = { reason: '', note: '' };
  const form = useForm({
    defaultValues: defaults,
    validationLogic: revalidateLogic({ mode: 'submit', modeAfterSubmission: 'change' }),
    validators: {
      onDynamic: ({ value }) => {
        const fields = zodFieldErrors(excludeRatingInput, inputOf(value));
        if (!fields) return undefined;
        const shown: Record<string, string> = {};
        if (fields.reason) shown.reason = RATING_ERRORS.reason;
        if (fields.note)
          shown.note =
            value.reason === 'other' && !value.note.trim() ? RATING_ERRORS.note : fields.note;
        return Object.keys(shown).length ? { fields: shown } : undefined;
      },
    },
    onSubmitInvalid: () => focusFirstProblem(formRef.current),
    onSubmit: async ({ value }) => {
      if (pending) return;
      const parsed = excludeRatingInput.safeParse(inputOf(value));
      if (!parsed.success) return;
      setPending(true);
      setAlert(null);
      setServerErrors({});
      const outcome = await callAction(() =>
        excludeRatingAction({ ...parsed.data, note: parsed.data.note ?? undefined }),
      );
      setPending(false);
      if (outcome.ok) {
        showBoardNotice(outcome.data.boardNotice);
        const reason = EXCLUDE_REASONS.find((choice) => choice === value.reason) ?? 'other';
        onDone({
          status: 'excluded',
          excluded: {
            reason,
            note: value.note.trim() || null,
            byName: shell.user.name,
            at: nowIso(),
          },
        });
        return;
      }
      handleFailure(outcome.error);
    },
  });

  function handleFailure(failure: ActionFailure) {
    if (failure.code === 'UNAUTHENTICATED') {
      onSignedOut();
      onClose();
      return;
    }
    if (failure.code === 'RATING_CHANGED') {
      setRace(failure.message);
      announce(failure.message);
      onRace();
      requestAnimationFrame(() => alertRef.current?.focus());
      return;
    }
    if (failure.code === 'INVALID_INPUT' && failure.fieldErrors) {
      const fields: Record<string, string> = {};
      for (const [key, messages] of Object.entries(failure.fieldErrors)) {
        if (messages[0]) fields[key] = messages[0];
      }
      setServerErrors(fields);
      focusFirstProblem(formRef.current);
      return;
    }
    setAlert(failure.message);
    announce(failure.message, { assertive: true });
    requestAnimationFrame(() => alertRef.current?.focus());
  }

  const values = useStore(form.store, (state) => state.values);
  const submitted = useStore(form.store, (state) => state.submissionAttempts > 0);
  const errorOf = (field: keyof ExcludeValues, errors: readonly unknown[]) => {
    const first = errors.find((error) => typeof error === 'string');
    return (submitted && typeof first === 'string' ? first : null) ?? (serverErrors[field] || null);
  };

  const title = excludeTitle(row);
  if (race) {
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
          <FormAlert variant="info">{race}</FormAlert>
        </div>
      </ActionDialog>
    );
  }

  const comment = commentPreview(row.comment);
  return (
    <ActionDialog
      open
      title={title}
      pending={pending}
      safeLabel="Keep it"
      actionLabel="Exclude"
      pendingLabel="Excluding…"
      blocked={offline}
      blockedReason={offline ? MONEY_COPY.offline : null}
      formRef={formRef}
      onClose={onClose}
      onCloseFocus={onCloseFocus}
      onSubmit={() => void form.handleSubmit()}
    >
      {alert ? (
        <div ref={alertRef} tabIndex={-1} className="outline-none">
          <FormAlert variant="error">{alert}</FormAlert>
        </div>
      ) : null}
      <div className="space-y-2 rounded-xl bg-neutral-7 p-4 text-body-5 text-neutral-1">
        <p className="flex items-center gap-2">
          <StarsDisplay stars={row.stars} />
          <span aria-hidden>{starsCount(row.stars)}</span>
        </p>
        <p className="tabular-nums">
          {[
            ratingWhen(row, timeZone).split(' · ')[0],
            `Order ${row.orderNumber}`,
            row.customerShort,
          ].join(' · ')}
        </p>
        <TagChips tags={row.tags} />
        {comment ? <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{comment}</p> : null}
      </div>
      <form.Field name="reason">
        {(field) => (
          <ReasonFieldset<ExcludeReason>
            name={`${id}-reason`}
            reasons={EXCLUDE_REASONS}
            labels={labels}
            value={field.state.value}
            error={errorOf('reason', field.state.meta.errors)}
            onChange={(value) => {
              field.handleChange(value);
              setServerErrors((current) => ({ ...current, reason: '' }));
            }}
          />
        )}
      </form.Field>
      <form.Field name="note">
        {(field) => (
          <StaffNoteField
            required={values.reason === 'other'}
            value={field.state.value}
            error={errorOf('note', field.state.meta.errors)}
            onChange={(value) => {
              field.handleChange(value);
              setServerErrors((current) => ({ ...current, note: '' }));
            }}
            onBlur={field.handleBlur}
          />
        )}
      </form.Field>
      <OutcomeBox lines={excludeOutcome(row)} />
    </ActionDialog>
  );
}
