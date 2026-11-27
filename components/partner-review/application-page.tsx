'use client';

import { useQueryClient } from '@tanstack/react-query';
import {
  CalendarClock,
  CircleCheck,
  History,
  IdCard,
  Info,
  ListChecks,
  type LucideIcon,
  PencilLine,
  Phone,
  RectangleHorizontal,
  ShieldBan,
  TriangleAlert,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
} from 'react';
import type { PartnerEarningsPage } from '@/server/modules/earnings/schema';
import { partnerVersionAction } from '@/server/modules/partners/review-actions';
import type {
  DecisionResult,
  FlagOther,
  HistoryEntry,
  PartnerListQuery,
  PartnerReview,
  ReviewAction,
  ReviewActionState,
  ReviewFlag,
} from '@/server/modules/partners/review-schema';
import { flagOtherLine, flagSentence } from '@/server/modules/partners/review-state';
import type { PartnerRatingsPage } from '@/server/modules/ratings/schema';
import { longDate, weekdayDate } from '@/server/modules/partners/text';
import { BackLink } from '@/components/account/back-link';
import { AdminPage, useSessionPhase } from '@/components/admin/admin-page';
import { SignedOutOverlay } from '@/components/admin/signed-out-overlay';
import { useStaffShell } from '@/components/admin/staff-shell-context';
import { FormAlert } from '@/components/forms/form-alert';
import { BLOCKED_BUTTON_CLASS } from '@/components/forms/submit-button';
import { Button } from '@/components/ui/button';
import { callAction } from '@/lib/action-result';
import type { PartnerSection } from '@/lib/admin/earnings-text';
import { announce } from '@/lib/announce';
import { useMotion } from '@/lib/motion';
import {
  ACTION_LABELS,
  agreedLine,
  callName,
  customerLine,
  type DecidedHow,
  decidedConflict,
  decidedLine,
  editedBanner,
  fixedLine,
  goneText,
  inDaysText,
  longDateOf,
  nextText,
  resultText,
  sentBackLine,
  showsNext,
  dateTime,
  whatToCheck,
} from '@/lib/partner-review/text';
import { applicationHref, listHref } from '@/lib/partner-review/url';
import { useOnline } from '@/lib/use-online';
import { cn } from '@/lib/utils';
import { ApplicationHistory } from './application-history';
import { DecisionDialog, type DialogDraft, EMPTY_DRAFT } from './decision-dialogs';
import { PartnerEarningsPanel } from './earnings-panel';
import { PartnerSectionsNav } from './partner-sections';
import { PartnerImages } from './partner-images';
import { BannedChip, ChangedChip, DemoChip, OnlineLine, StatusChip, WaitingBlock } from './parts';
import { partnerKeys, ReadError, usePartnerReview } from './queries';
import { PartnerRatingsPanel } from './ratings-panel';

/*
 * One application (F6 design 8, A20): everything a reviewer needs to decide, refreshed every
 * 30 s without moving focus. The header carries the decisions this role may take; the page
 * marks what the applicant changed since the last decision and says when someone else decided.
 */

const PLAIN = 'whitespace-pre-wrap [overflow-wrap:anywhere]';
const HIDDEN_FOR_DEMO = <p className="text-caption text-neutral-3">Hidden for demo staff</p>;

// ------------------------------------------------------------------ header (8.2)

const ACTION_STYLE: Record<ReviewAction, { variant: 'default' | 'outline'; danger: boolean }> = {
  approve: { variant: 'default', danger: false },
  reinstate: { variant: 'default', danger: false },
  sendBack: { variant: 'outline', danger: false },
  reopen: { variant: 'outline', danger: false },
  reject: { variant: 'outline', danger: true },
  suspend: { variant: 'outline', danger: true },
};

function HeaderActions({
  actions,
  onOpen,
  openerRefs,
}: {
  actions: readonly ReviewActionState[];
  onOpen: (action: ReviewAction) => void;
  openerRefs: React.RefObject<Partial<Record<ReviewAction, HTMLButtonElement | null>>>;
}) {
  const reasonId = useId();
  const buttons = actions.filter((state) => state.display === 'button');
  const lines = actions.filter((state) => state.display === 'line');
  // One caption for disabled buttons, F5 2.7 ("Read-only in the demo").
  const disabledReason = buttons.find((state) => !state.enabled)?.reason ?? null;
  if (actions.length === 0) return null;
  return (
    <div className="mt-4 xl:mt-0 xl:ml-auto">
      {buttons.length ? (
        <div className="flex flex-col gap-2 md:flex-row md:flex-wrap">
          {buttons.map((state) => {
            const style = ACTION_STYLE[state.action];
            return (
              <Button
                key={state.action}
                ref={(element) => {
                  openerRefs.current[state.action] = element;
                }}
                type="button"
                size="kitchen"
                variant={style.variant}
                aria-disabled={!state.enabled || undefined}
                aria-describedby={!state.enabled && disabledReason ? reasonId : undefined}
                onClick={() => {
                  if (state.enabled) onOpen(state.action);
                  else if (state.reason) announce(state.reason);
                }}
                className={cn(
                  'w-full md:w-auto',
                  style.danger &&
                    'border-destructive bg-white text-destructive hover:bg-tag-4-bg hover:text-destructive',
                  !state.enabled && BLOCKED_BUTTON_CLASS,
                )}
              >
                {ACTION_LABELS[state.action]}
              </Button>
            );
          })}
        </div>
      ) : null}
      {disabledReason ? (
        <p id={reasonId} className="mt-2 text-body-5 text-neutral-3">
          {disabledReason}
        </p>
      ) : null}
      {lines.map((state) => (
        <p
          key={state.action}
          className={cn(
            'flex items-start gap-2 text-body-5 text-neutral-3',
            buttons.length && 'mt-2',
          )}
        >
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          {state.reason}
        </p>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ status block (8.3)

function TextBlock({
  label,
  text,
  masked,
}: {
  label: string;
  text: string | null;
  masked: boolean;
}) {
  if (masked) {
    return (
      <div>
        <p>{label}</p>
        {HIDDEN_FOR_DEMO}
      </div>
    );
  }
  if (!text) return null;
  return (
    <div>
      <p>{label}</p>
      <p className={cn('mt-2 rounded-lg bg-white p-3', PLAIN)}>{text}</p>
    </div>
  );
}

function DecisionBlock({ review, timeZone }: { review: PartnerReview; timeZone: string }) {
  const { decision } = review;
  const lines: ReactNode[] = [];
  const masked = review.masked.texts;

  if (review.banned) {
    return (
      <section
        aria-label="Decision"
        className="space-y-2 rounded-2xl bg-tag-4-bg p-5 text-body-4 text-neutral-1"
      >
        <p className="flex items-start gap-2">
          <ShieldBan className="mt-1 size-4 shrink-0 text-destructive" aria-hidden />
          <span className={PLAIN}>
            Account banned{review.banned.reason ? ` · ${review.banned.reason}` : ''}
          </span>
        </p>
        <p>Bans are managed on the account, not here.</p>
      </section>
    );
  }

  if (decision.sentBack && review.status === 'APPLIED') {
    lines.push(
      <p key="sent">{sentBackLine(decision.sentBack.at, decision.sentBack.by, timeZone)}</p>,
    );
    lines.push(
      <TextBlock
        key="message"
        label="Message to the applicant:"
        text={decision.sentBack.message}
        masked={masked}
      />,
    );
    if (decision.fixedAt) {
      lines.push(
        <p key="fixed" className="flex gap-2">
          <CircleCheck className="mt-1 size-4 shrink-0 text-brand-strong" aria-hidden />
          {fixedLine(review.firstName, review.changedParts)}
        </p>,
      );
    }
  }

  const decided = decision.decided;
  if (decided && review.status === 'REJECTED') {
    lines.push(<p key="rejected">{decidedLine('rejected', decided.at, decided.by, timeZone)}</p>);
    if (masked) lines.push(<TextBlock key="reason" label="Reason given:" text={null} masked />);
    else if (decision.applicantText) {
      lines.push(
        <TextBlock
          key="reason"
          label="Reason given:"
          text={decision.applicantText}
          masked={false}
        />,
      );
    } else lines.push(<p key="none">No reason given to the applicant</p>);
    if (decision.filesDeletedAt) {
      lines.push(<p key="again">Can apply again now</p>);
      lines.push(
        <p key="files">
          Photos and ID details were deleted on {weekdayDate(decision.filesDeletedAt.slice(0, 10))},
          30 days after the decision.
        </p>,
      );
    } else if (decision.reapplyFrom) {
      lines.push(<p key="again">Can apply again from {weekdayDate(decision.reapplyFrom)}</p>);
      if (decision.filesDeleteOn) {
        lines.push(
          <p key="files">
            Photos and ID details will be deleted on {longDate(decision.filesDeleteOn)}.
          </p>,
        );
      }
    }
  }

  if (decided && review.status === 'SUSPENDED') {
    lines.push(<p key="suspended">{decidedLine('suspended', decided.at, decided.by, timeZone)}</p>);
    if (masked) {
      lines.push(
        <TextBlock key="reason" label={`Reason for ${review.firstName}:`} text={null} masked />,
      );
    } else if (decision.applicantText) {
      lines.push(
        <TextBlock
          key="reason"
          label={`Reason for ${review.firstName}:`}
          text={decision.applicantText}
          masked={false}
        />,
      );
      lines.push(<p key="sees">{review.firstName} sees this reason on the suspension screen.</p>);
    } else lines.push(<p key="none">No reason given to the partner</p>);
  }

  if (decided && review.status === 'APPROVED') {
    lines.push(<p key="approved">{decidedLine('approved', decided.at, decided.by, timeZone)}</p>);
    if (review.partnerSince) {
      lines.push(<p key="since">Partner since {longDateOf(review.partnerSince, timeZone)}</p>);
    }
  }

  if (lines.length === 0) return null;
  return (
    <section
      aria-label="Decision"
      className="space-y-2 rounded-2xl bg-neutral-7 p-5 text-body-4 text-neutral-1"
    >
      {lines}
    </section>
  );
}

// ------------------------------------------------------------------ flags (8.4)

const FLAG_ICONS: Record<ReviewFlag['kind'], LucideIcon> = {
  samePlate: RectangleHorizontal,
  sameIdNumber: IdCard,
  expiresSoon: CalendarClock,
  appliedBefore: History,
};

function linkedSentence(sentence: string, other: FlagOther | undefined) {
  if (!other?.name || !other.partnerId) return sentence;
  const at = sentence.indexOf(other.name);
  if (at < 0) return sentence;
  return (
    <>
      {sentence.slice(0, at)}
      <Link
        href={applicationHref(other.partnerId)}
        className="underline underline-offset-4 hover:text-neutral-2"
      >
        {other.name}
      </Link>
      {sentence.slice(at + other.name.length)}
    </>
  );
}

function FlagsList({ flags, timeZone }: { flags: readonly ReviewFlag[]; timeZone: string }) {
  const id = useId();
  if (flags.length === 0) return null;
  return (
    <section aria-labelledby={id}>
      <h2
        id={id}
        aria-label={`Flags, ${flags.length}`}
        className="flex items-center gap-2 text-body-3 font-semibold text-neutral-1"
      >
        Flags
        <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-md bg-tag-6-bg px-1.5 text-caption font-semibold text-neutral-1 tabular-nums">
          {flags.length}
        </span>
      </h2>
      <ul className="mt-3 space-y-2">
        {flags.map((flag) => {
          const Icon = FLAG_ICONS[flag.kind];
          const sentence = flagSentence(flag, timeZone);
          const others =
            flag.kind === 'samePlate' || flag.kind === 'sameIdNumber' ? flag.others : [];
          const many = others.length > 1 && others.every((other) => other.partnerId && other.name);
          return (
            <li
              key={flag.kind}
              className="flex gap-3 rounded-xl border border-l-4 border-neutral-6 border-l-warning-strong bg-white p-4"
            >
              <span
                aria-hidden
                className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-tag-6-bg"
              >
                <Icon className="size-[18px] text-warning-strong" />
              </span>
              <div className="min-w-0 text-body-4 font-medium text-neutral-1">
                <p>{others.length === 1 ? linkedSentence(sentence, others[0]) : sentence}</p>
                {many ? (
                  <ul className="mt-2 space-y-1 text-body-5 font-normal">
                    {others.map((other) => (
                      <li key={other.partnerId}>
                        <Link
                          href={applicationHref(other.partnerId ?? '')}
                          className="underline underline-offset-4"
                        >
                          {flagOtherLine(other, timeZone)}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ------------------------------------------------------------------ facts (8.5, 8.7)

function Card({ title, children, id }: { title: ReactNode; children: ReactNode; id: string }) {
  return (
    <section aria-labelledby={id} className="rounded-2xl border border-neutral-6 bg-white p-5">
      <h2 id={id} className="flex items-center gap-2 text-body-3 font-semibold text-neutral-1">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Facts({
  rows,
}: {
  rows: readonly { label: string; value: ReactNode; changed?: boolean }[];
}) {
  return (
    <dl className="mt-3 grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-body-4">
      {rows.map((row) => (
        <div key={row.label} className="contents">
          <dt className="flex flex-col items-start gap-1 text-neutral-3">
            {row.label}
            {row.changed ? <ChangedChip /> : null}
          </dt>
          <dd className="text-neutral-1 [overflow-wrap:anywhere]">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function FactsCards({ review, timeZone }: { review: PartnerReview; timeZone: string }) {
  const id = useId();
  const parts = review.changedParts;
  const document = review.document;
  return (
    <>
      <Card id={`${id}-applicant`} title="Applicant">
        <Facts
          rows={[
            { label: 'Name', value: review.name },
            { label: 'Email', value: review.email },
            {
              label: 'Phone',
              changed: parts.includes('phone'),
              value: review.phone ? (
                <a
                  href={`tel:${review.phone.e164}`}
                  aria-label={callName(review.name, review.phone.display)}
                  className="inline-flex h-11 items-center gap-2 underline underline-offset-4"
                >
                  <Phone className="size-4" aria-hidden />
                  {review.phone.display}
                </a>
              ) : (
                '—'
              ),
            },
            {
              label: 'Customer',
              value: customerLine(review.customer.since, review.customer.orderCount, timeZone),
            },
          ]}
        />
        {review.masked.applicant ? <div className="mt-3">{HIDDEN_FOR_DEMO}</div> : null}
      </Card>
      <Card id={`${id}-vehicle`} title="Vehicle">
        <Facts
          rows={[
            { label: 'Type', value: review.vehicle.words, changed: parts.includes('vehicle') },
            ...(review.vehicle.plate || review.vehicle.type !== 'BICYCLE'
              ? [
                  {
                    label: 'Plate',
                    value: review.vehicle.plate ?? '—',
                    changed: parts.includes('plate'),
                  },
                ]
              : []),
          ]}
        />
        {review.masked.vehicle ? <div className="mt-3">{HIDDEN_FOR_DEMO}</div> : null}
      </Card>
      <Card id={`${id}-id`} title="ID">
        {document ? (
          <Facts
            rows={[
              { label: 'Type', value: document.typeWords, changed: parts.includes('idType') },
              {
                label: 'Number',
                value: `Ending ${document.last4}`,
                changed: parts.includes('idNumber'),
              },
              {
                label: 'Expires',
                changed: parts.includes('idExpiry'),
                value: (
                  <>
                    {longDate(document.expiresOn)}
                    {document.expiresInDays !== null && document.expiresInDays <= 30 ? (
                      <span className="ml-2 inline-flex items-center gap-1 text-body-5 text-neutral-1">
                        <TriangleAlert className="size-3.5 text-warning-strong" aria-hidden />
                        {inDaysText(document.expiresInDays)}
                      </span>
                    ) : null}
                  </>
                ),
              },
            ]}
          />
        ) : (
          <p className="mt-3 text-body-4 text-neutral-3">
            {review.decision.filesDeletedAt ? 'ID details were deleted.' : 'No ID on file.'}
          </p>
        )}
        {review.masked.document ? <div className="mt-3">{HIDDEN_FOR_DEMO}</div> : null}
      </Card>
      <Card id={`${id}-agreed`} title="Agreed">
        <ul className="mt-3 space-y-2.5 text-body-4 text-neutral-1">
          <li>{agreedLine(review.agreed.termsVersion, review.agreed.acceptedAt, timeZone)}</li>
          <li>Confirmed they&apos;re 18 or older</li>
        </ul>
      </Card>
      {review.online ? (
        <Card id={`${id}-partner`} title="Partner">
          <Facts
            rows={[
              {
                label: 'Status',
                value: <OnlineLine state={review.online.state.kind} words={review.online.words} />,
              },
              ...(review.partnerSince
                ? [
                    {
                      label: 'Since',
                      value: `Partner since ${longDateOf(review.partnerSince, timeZone)}`,
                    },
                  ]
                : []),
            ]}
          />
        </Card>
      ) : null}
    </>
  );
}

function WhatToCheck({ review }: { review: PartnerReview }) {
  const id = useId();
  return (
    <Card
      id={id}
      title={
        <>
          <ListChecks className="size-5 text-neutral-3" aria-hidden />
          What to check
        </>
      }
    >
      <ul className="mt-3 list-disc space-y-2 pl-5 text-body-4 text-neutral-1 marker:text-neutral-4">
        {whatToCheck({
          name: review.name,
          last4: review.document?.last4 ?? null,
          vehicle: review.vehicle.type,
        }).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </Card>
  );
}

// ------------------------------------------------------------------ banners (8.9, 8.10)

function RiseIn({
  children,
  alertRef,
}: {
  children: ReactNode;
  alertRef?: React.Ref<HTMLDivElement>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useMotion(
    (motion) => {
      if (!ref.current) return;
      motion.from(ref.current, {
        y: -4,
        opacity: 0,
        duration: motion.reduced ? 0 : 0.15,
        ease: 'power2.out',
      });
    },
    { scope: ref },
  );
  return (
    <div ref={ref}>
      <div ref={alertRef} tabIndex={-1} className="outline-none">
        {children}
      </div>
    </div>
  );
}

const DECISION_TYPES: Partial<Record<HistoryEntry['type'], DecidedHow>> = {
  approved: 'approved',
  rejected: 'rejected',
  'sent-back': 'sent-back',
  suspended: 'suspended',
  reinstated: 'reinstated',
  reopened: 'reopened',
};

/** What changed since the page last showed it, from the newest history entry. */
function changeText(review: PartnerReview, timeZone: string): string | null {
  const entries = review.history.filter((entry) => entry.type !== 'taken-offline');
  const last = entries.at(-1);
  if (!last) return null;
  if (last.type === 'updated' || last.type === 'fixed') {
    return editedBanner(review.name, last.at, last.changedParts, timeZone);
  }
  const how = DECISION_TYPES[last.type];
  return how ? decidedConflict(how, last.actor, last.at, timeZone) : null;
}

// ------------------------------------------------------------------ the page

interface Result {
  action: ReviewAction;
  text: string;
  next: DecisionResult['next'];
}

const EMPTY_DRAFTS: Record<ReviewAction, DialogDraft> = {
  approve: EMPTY_DRAFT,
  sendBack: EMPTY_DRAFT,
  reject: EMPTY_DRAFT,
  suspend: EMPTY_DRAFT,
  reinstate: EMPTY_DRAFT,
  reopen: EMPTY_DRAFT,
};

/** F9 (design 3.3): an approved or suspended partner's page has three sections. */
export interface PartnerSectionsData {
  view: PartnerSection;
  /** The server's first read of the section shown; null when it failed. */
  earnings: PartnerEarningsPage | null;
  ratings: PartnerRatingsPage | null;
}

export function ApplicationPage({
  initial,
  list,
  sections = null,
}: {
  initial: PartnerReview;
  /** The list it was opened from (its address carries the query, A20.1). */
  list: PartnerListQuery;
  sections?: PartnerSectionsData | null;
}) {
  const shell = useStaffShell();
  const router = useRouter();
  const queryClient = useQueryClient();
  const online = useOnline();
  const sessionEnded = useSessionPhase(shell.sessionExpiresAt) === 'ended';
  const [signedOut, setSignedOut] = useState(false);
  const [gone, setGone] = useState<string | null>(null);
  const review = usePartnerReview(initial, !signedOut && !sessionEnded && !gone);
  const data = review.data ?? initial;
  const timeZone = shell.timeZone;
  const historyId = useId();
  const backHref = listHref(list);
  const [dialog, setDialog] = useState<ReviewAction | null>(null);
  const [drafts, setDrafts] = useState(EMPTY_DRAFTS);
  const [result, setResult] = useState<Result | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [knownVersion, setKnownVersion] = useState(initial.version);
  const ownVersion = useRef<number | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const openers = useRef<Partial<Record<ReviewAction, HTMLButtonElement | null>>>({});
  const focusResult = useRef(false);
  // F9 3.3: after switching sections, focus goes to the new panel's h2.
  const panelHeading = useRef<HTMLHeadingElement>(null);
  const view = sections?.view ?? null;
  const shownView = useRef(view);
  useEffect(() => {
    if (!view || shownView.current === view) return;
    shownView.current = view;
    requestAnimationFrame(() => panelHeading.current?.focus());
  }, [view]);

  // Someone else changed or decided it: say so once, in place (8.9). Our own decision doesn't.
  useEffect(() => {
    if (data.version === knownVersion) return undefined;
    const timer = setTimeout(() => {
      setKnownVersion(data.version);
      if (ownVersion.current === data.version) return;
      const text = changeText(data, timeZone);
      if (text) {
        setBanner(text);
        announce(text);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [data, knownVersion, timeZone]);

  // A refresh that finds nothing: withdrawn, or the session ended (8.9).
  const readFailure = useEffectEvent(async (error: ReadError) => {
    if (error.failure.code === 'UNAUTHENTICATED') {
      setSignedOut(true);
      return;
    }
    if (error.failure.code !== 'NOT_FOUND') return;
    const outcome = await callAction(() => partnerVersionAction({ partnerId: initial.partnerId }));
    if (outcome.ok) return;
    const details = outcome.error.details;
    const at = typeof details?.at === 'string' ? details.at : null;
    if (outcome.error.code === 'APPLICATION_GONE' && at) {
      const text = goneText(
        details?.how === 'account-deleted' ? 'account-deleted' : 'withdrawn',
        data.name,
        at,
        timeZone,
      );
      setGone(text);
      announce(text);
    }
  });
  useEffect(() => {
    const error = review.error;
    if (!(error instanceof ReadError)) return undefined;
    const timer = setTimeout(() => void readFailure(error), 0);
    return () => clearTimeout(timer);
  }, [review.error]);

  const finished = (action: ReviewAction, decision: DecisionResult) => {
    ownVersion.current = decision.version;
    const text = resultText(action, data.name, data.firstName, decision.wasOnline);
    setResult({ action, text, next: decision.next });
    setBanner(null);
    setDrafts(EMPTY_DRAFTS);
    focusResult.current = true;
    setDialog(null);
    announce(text);
    void queryClient.invalidateQueries({ queryKey: partnerKeys.all });
  };

  // The result line takes focus once the dialog has closed (8.10).
  useEffect(() => {
    if (!result || !focusResult.current || dialog) return undefined;
    const timer = setTimeout(() => {
      focusResult.current = false;
      resultRef.current?.focus();
    }, 0);
    return () => clearTimeout(timer);
  }, [result, dialog]);

  const markSignedOut = useCallback(() => setSignedOut(true), []);

  const checkChanges = () => {
    setDialog(null);
    void (async () => {
      await review.refetch();
      requestAnimationFrame(() => {
        const chip = document.querySelector<HTMLElement>('[data-changed-chip]');
        if (chip) chip.focus();
        else titleRef.current?.focus();
      });
    })();
  };

  const actions = gone ? [] : data.actions;
  const images = (
    <section aria-labelledby={`${historyId}-images`}>
      <h2 id={`${historyId}-images`} className="text-body-3 font-semibold text-neutral-1">
        Photo and ID
      </h2>
      <PartnerImages review={data} timeZone={timeZone} />
    </section>
  );

  return (
    <AdminPage title="Partners" titleAs="p">
      <div
        className="mx-auto w-full max-w-[1200px] px-4 pb-12 lg:px-6"
        inert={signedOut || undefined}
      >
        <div className="pt-6">
          <BackLink href={backHref}>Back to partners</BackLink>
        </div>

        <header className="mt-6 xl:sticky xl:top-14 xl:z-20 xl:-mx-6 xl:flex xl:items-start xl:gap-6 xl:border-b xl:border-neutral-6 xl:bg-white xl:px-6 xl:py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h1
                ref={titleRef}
                tabIndex={-1}
                className="font-heading text-title-1 text-neutral-2 outline-none [overflow-wrap:anywhere] xl:text-h4"
              >
                {data.name}
              </h1>
              <StatusChip tab={data.tab} />
              {data.banned ? <BannedChip /> : null}
              {data.isDemoPartner ? <DemoChip /> : null}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-body-5 text-neutral-3">
              <span>Sent {dateTime(data.submittedAt, timeZone)}</span>
              {data.waiting ? <WaitingBlock waiting={data.waiting} /> : null}
              {data.updatedAt ? (
                <span className="inline-flex items-center gap-1">
                  <PencilLine className="size-3.5" aria-hidden />
                  Updated {dateTime(data.updatedAt, timeZone)}
                </span>
              ) : null}
            </div>
            {data.masked.applicant ? <div className="mt-2">{HIDDEN_FOR_DEMO}</div> : null}
          </div>
          <HeaderActions actions={actions} onOpen={setDialog} openerRefs={openers} />
        </header>

        {sections ? (
          <PartnerSectionsNav partnerId={data.partnerId} list={list} current={sections.view} />
        ) : null}

        <div className="mt-6 space-y-6 xl:space-y-8">
          {result ? (
            <RiseIn alertRef={resultRef}>
              <FormAlert
                variant="success"
                action={
                  showsNext(result.action) ? (
                    result.next ? (
                      <Button asChild variant="outline" size="touch" className="bg-white">
                        <Link href={applicationHref(result.next.partnerId, list)}>
                          {nextText(result.next.name)}
                        </Link>
                      </Button>
                    ) : (
                      <span className="flex flex-wrap items-center gap-3">
                        <span>Nothing else to review.</span>
                        <Button asChild variant="outline" size="touch" className="bg-white">
                          <Link href={backHref}>Back to partners</Link>
                        </Button>
                      </span>
                    )
                  ) : undefined
                }
              >
                {result.text}
              </FormAlert>
            </RiseIn>
          ) : null}
          {gone ? (
            <RiseIn>
              <FormAlert
                variant="info"
                action={
                  <Button asChild variant="outline" size="touch" className="bg-white">
                    <Link href={backHref}>Back to partners</Link>
                  </Button>
                }
              >
                {gone}
              </FormAlert>
            </RiseIn>
          ) : banner ? (
            <RiseIn>
              <FormAlert variant="info">{banner}</FormAlert>
            </RiseIn>
          ) : null}

          {sections?.view === 'earnings' ? (
            <PartnerEarningsPanel
              key="earnings"
              initial={sections.earnings}
              partnerId={data.partnerId}
              partnerName={data.name}
              timeZone={timeZone}
              offline={!online}
              enabled={!signedOut && !sessionEnded}
              headingRef={panelHeading}
              onSignedOut={markSignedOut}
            />
          ) : sections?.view === 'ratings' ? (
            <PartnerRatingsPanel
              key="ratings"
              initial={sections.ratings}
              partnerId={data.partnerId}
              partnerName={data.name}
              timeZone={timeZone}
              offline={!online}
              enabled={!signedOut && !sessionEnded}
              headingRef={panelHeading}
              onSignedOut={markSignedOut}
            />
          ) : (
            <section
              aria-labelledby={sections ? `${historyId}-application` : undefined}
              className="space-y-6 xl:space-y-8"
            >
              {sections ? (
                <h2
                  id={`${historyId}-application`}
                  ref={panelHeading}
                  tabIndex={-1}
                  className="sr-only"
                >
                  Application
                </h2>
              ) : null}
              <DecisionBlock review={data} timeZone={timeZone} />
              <FlagsList flags={data.flags} timeZone={timeZone} />

              <div className="space-y-6 xl:grid xl:grid-cols-[480px_minmax(0,1fr)] xl:items-start xl:gap-8 xl:space-y-0">
                <div className="space-y-6 xl:space-y-8">
                  {images}
                  <WhatToCheck review={data} />
                </div>
                <div className="space-y-6 xl:space-y-8">
                  <FactsCards review={data} timeZone={timeZone} />
                  <ApplicationHistory
                    entries={data.history}
                    timeZone={timeZone}
                    headingId={historyId}
                  />
                </div>
              </div>
            </section>
          )}
        </div>
      </div>

      {dialog ? (
        <DecisionDialog
          key={dialog}
          action={dialog}
          review={data}
          timeZone={timeZone}
          offline={!online}
          draft={drafts[dialog]}
          onDraft={(draft) => setDrafts((current) => ({ ...current, [dialog]: draft }))}
          onClose={() => setDialog(null)}
          onCloseFocus={() => {
            if (focusResult.current) return true;
            const opener = openers.current[dialog];
            if (opener) {
              opener.focus();
              return true;
            }
            return false;
          }}
          onFinished={finished}
          onSignedOut={() => setSignedOut(true)}
          onCheckChanges={checkChanges}
          onBackToList={() => router.push(backHref)}
          onSendBackInstead={(draft) => {
            setDrafts((current) => ({ ...current, sendBack: draft, reject: draft }));
            setDialog('sendBack');
          }}
        />
      ) : null}
      {signedOut || sessionEnded ? <SignedOutOverlay /> : null}
    </AdminPage>
  );
}

/** A remembered list address, kept only when it is the list on this site. */
