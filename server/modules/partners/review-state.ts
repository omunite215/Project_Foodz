import type { PartnerStatus } from '@/server/db/enums';
import { clockAt } from '@/server/modules/orders/text';
import type { ChangedPart } from './rules';
import type {
  FlagOther,
  HistoryEntry,
  HistoryType,
  PartnerSort,
  PartnerTab,
  ReviewActionState,
  ReviewerRole,
  ReviewFlag,
  Waiting,
} from './review-schema';
import { WAITING_AMBER_WORKING_DAYS, WAITING_RED_WORKING_DAYS } from './review-schema';
import { DOCUMENT_WORDS, longDate, storeDate, weekdayDate } from './text';

/*
 * Pure rules of the staff review (F6 A19 to A28, design 7 and 8): which tab an application is
 * in, how long it has waited, which decisions a role may take on it and why not, and the flag
 * sentences. The service passes in what it read; nothing here touches storage or the clock.
 */

// ------------------------------------------------------------------ tabs

export interface TabFacts {
  status: PartnerStatus;
  changesRequestedAt: string | Date | null;
  fixedAt: string | Date | null;
}

const instantOf = (value: string | Date) => new Date(value).getTime();

/** Sent back and not fixed since (A19.1). */
export const isWaitingForApplicant = (facts: TabFacts): boolean =>
  facts.status === 'APPLIED' &&
  facts.changesRequestedAt !== null &&
  (facts.fixedAt === null || instantOf(facts.fixedAt) < instantOf(facts.changesRequestedAt));

const TAB_OF_STATUS: Record<PartnerStatus, Exclude<PartnerTab, 'all'>> = {
  APPLIED: 'review',
  APPROVED: 'approved',
  SUSPENDED: 'suspended',
  REJECTED: 'rejected',
};

/** A19.1's table. */
export const tabOf = (facts: TabFacts): Exclude<PartnerTab, 'all'> =>
  isWaitingForApplicant(facts) ? 'waiting' : TAB_OF_STATUS[facts.status];

export const TAB_WORDS: Record<Exclude<PartnerTab, 'all'>, string> = {
  review: 'To review',
  waiting: 'Waiting for the applicant',
  approved: 'Approved',
  suspended: 'Suspended',
  rejected: 'Rejected',
};

const CAPTION_TAB: Record<PartnerTab, string> = {
  review: 'Applications to review',
  waiting: 'Applications waiting for the applicant',
  approved: 'Approved partners',
  suspended: 'Suspended partners',
  rejected: 'Rejected applications',
  all: 'All applications',
};

const SORT_WORDS: Record<PartnerSort, { asc: string; desc: string }> = {
  name: { asc: 'name A to Z', desc: 'name Z to A' },
  sent: { asc: 'oldest first', desc: 'newest first' },
  decided: { asc: 'earliest decision first', desc: 'latest decision first' },
  changed: { asc: 'earliest change first', desc: 'latest change first' },
  rating: { asc: 'lowest rating first', desc: 'highest rating first' },
  week: { asc: 'least earned this week first', desc: 'most earned this week first' },
  cash: { asc: 'least cash owed first', desc: 'most cash owed first' },
};

const sortWords = (sort: PartnerSort, dir: 'asc' | 'desc') => SORT_WORDS[sort][dir];

/** A32.5: "Applications to review, oldest first, 2 results". */
export function listCaption(
  tab: PartnerTab,
  sort: PartnerSort,
  dir: 'asc' | 'desc',
  total: number,
): string {
  return `${CAPTION_TAB[tab]}, ${sortWords(sort, dir)}, ${total} ${total === 1 ? 'result' : 'results'}`;
}

// ------------------------------------------------------------------ waiting (A19.4, U33)

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function localParts(at: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(at));
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '0';
  return {
    weekday: value('weekday'),
    seconds: Number(value('hour')) * 3600 + Number(value('minute')) * 60 + Number(value('second')),
  };
}

/** The next local midnight after `at`, corrected for a daylight-saving change that day. */
function nextMidnight(at: number, timeZone: string): number {
  const guess = at + DAY_MS - localParts(at, timeZone).seconds * 1000 - (at % 1000);
  const off = localParts(guess, timeZone).seconds;
  if (off === 0) return guess;
  // Landed an hour late (23-hour day) or early (25-hour day).
  return off < 12 * 3600 ? guess - off * 1000 : guess + (24 * 3600 - off) * 1000;
}

/** Time between two instants that falls on Monday to Friday in the store's time zone. */
export function workingMs(fromIso: string, to: Date, timeZone: string): number {
  let cursor = Date.parse(fromIso);
  const end = to.getTime();
  let total = 0;
  for (let guard = 0; cursor < end && guard < 400; guard += 1) {
    const dayEnd = Math.min(nextMidnight(cursor, timeZone), end);
    const { weekday } = localParts(cursor, timeZone);
    if (weekday !== 'Sat' && weekday !== 'Sun') total += dayEnd - cursor;
    cursor = dayEnd;
  }
  return total;
}

/**
 * A19.4: the tone follows working days (amber from 1, red from 2); the words count ordinary
 * days and hours. "Waiting 25 min", "Waiting 9 h", "Waiting 1 day", "Over 2 working days" +
 * "waiting 3 days".
 */
export function waitingOf(fromIso: string, now: Date, timeZone: string): Waiting {
  const elapsed = Math.max(0, now.getTime() - Date.parse(fromIso));
  const workingDays = Math.floor(workingMs(fromIso, now, timeZone) / DAY_MS);
  const days = Math.floor(elapsed / DAY_MS);
  const ordinary =
    elapsed < HOUR_MS
      ? `${Math.floor(elapsed / 60_000)} min`
      : elapsed < DAY_MS
        ? `${Math.floor(elapsed / HOUR_MS)} h`
        : `${days} ${days === 1 ? 'day' : 'days'}`;
  if (workingDays >= WAITING_RED_WORKING_DAYS) {
    return {
      tone: 'red',
      words: `Over ${WAITING_RED_WORKING_DAYS} working days`,
      detail: `waiting ${ordinary}`,
    };
  }
  return {
    tone: workingDays >= WAITING_AMBER_WORKING_DAYS ? 'amber' : 'normal',
    words: `Waiting ${ordinary}`,
    detail: null,
  };
}

// ------------------------------------------------------------------ decisions per role

export interface ActionFacts {
  status: PartnerStatus;
  waitingForApplicant: boolean;
  /** "Sent back Thu, Nov 19" for the line that replaces "Send back". */
  sentBackOn: string | null;
  firstName: string;
  banned: boolean;
  isDemoPartner: boolean;
  /** Rejected and the files are gone (A28.3). */
  filesDeletedOn: string | null;
}

export interface ViewerFacts {
  role: ReviewerRole;
  /** The demo admin (A29.4). */
  readOnly: boolean;
  stepUpFresh: boolean;
}

export const ACTION_REASONS = {
  demo: 'Read-only in the demo',
  banned: 'Bans are managed on the account, not here.',
  bannedApprove: "This account is banned, so it can't be approved.",
  demoPartner: "The demo partner can't be suspended. It resets every night.",
  adminReinstates: 'Only an admin can reinstate a partner.',
} as const;

const line = (action: ReviewActionState['action'], reason: string): ReviewActionState => ({
  action,
  display: 'line',
  enabled: false,
  reason,
  stepUp: false,
});

const sentBackLine = (facts: ActionFacts) =>
  `${facts.sentBackOn ? `Sent back ${facts.sentBackOn}. ` : ''}Waiting for ${facts.firstName}.`;

const filesDeletedLine = (facts: ActionFacts) =>
  `${facts.firstName}'s photos and ID details were deleted on ${facts.filesDeletedOn ?? ''}, so this can't be reopened. ${facts.firstName} can apply again from the account.`;

/**
 * The header's actions for this role and state (design 8.2), in display order: primary first,
 * destructive last. The demo admin sees ADMIN's buttons, disabled. The service refuses the
 * same cases again when an action is called directly.
 */
export function reviewActions(facts: ActionFacts, viewer: ViewerFacts): ReviewActionState[] {
  const isAdmin = viewer.role === 'admin';
  const button = (action: ReviewActionState['action'], stepUp = false): ReviewActionState =>
    viewer.readOnly
      ? { action, display: 'button', enabled: false, reason: ACTION_REASONS.demo, stepUp: false }
      : {
          action,
          display: 'button',
          enabled: true,
          reason: null,
          stepUp: stepUp && !viewer.stepUpFresh,
        };
  switch (facts.status) {
    case 'APPLIED': {
      if (facts.banned) {
        return [line('approve', ACTION_REASONS.bannedApprove), button('reject')];
      }
      return facts.waitingForApplicant
        ? [button('approve', true), button('reject'), line('sendBack', sentBackLine(facts))]
        : [button('approve', true), button('sendBack'), button('reject')];
    }
    case 'APPROVED':
      if (facts.banned) return [line('suspend', ACTION_REASONS.banned)];
      if (facts.isDemoPartner) return [line('suspend', ACTION_REASONS.demoPartner)];
      return [button('suspend', true)];
    case 'SUSPENDED':
      if (facts.banned) return [line('reinstate', ACTION_REASONS.banned)];
      return isAdmin || viewer.readOnly
        ? [button('reinstate', true)]
        : [line('reinstate', ACTION_REASONS.adminReinstates)];
    default:
      if (facts.filesDeletedOn) return [line('reopen', filesDeletedLine(facts))];
      return isAdmin || viewer.readOnly ? [button('reopen')] : [];
  }
}

// ------------------------------------------------------------------ flags (A22)

const STATUS_FLAG_WORDS: Record<PartnerStatus, string> = {
  APPLIED: 'To review',
  APPROVED: 'Approved',
  SUSPENDED: 'Suspended',
  REJECTED: 'Rejected',
};

/** "Suspended Thu, Nov 19, 2026", "Approved · account banned". */
function otherState(other: FlagOther, timeZone: string): string {
  const status = STATUS_FLAG_WORDS[other.status];
  if (other.banned) return `${status} · account banned`;
  if (other.decidedAt && other.status !== 'APPLIED') {
    return `${status} ${weekdayDate(storeDate(other.decidedAt, timeZone))}`;
  }
  return status;
}

const anyMasked = (others: readonly FlagOther[]) => others.some((other) => other.name === null);

const otherApplications = (count: number) =>
  `${count} other ${count === 1 ? 'application' : 'applications'}`;

/**
 * The flag's sentence (A22.1 to A22.4, design 8.4). With a real person on either side, the
 * demo admin's sentence names nobody (A22.8).
 */
export function flagSentence(flag: ReviewFlag, timeZone: string): string {
  switch (flag.kind) {
    case 'samePlate': {
      const [only] = flag.others;
      if (flag.plate === null || anyMasked(flag.others)) {
        return `Plate is also on ${otherApplications(flag.others.length)}.`;
      }
      return flag.others.length === 1 && only
        ? `Plate ${flag.plate} is also on ${only.name ?? ''}'s application (${otherState(only, timeZone)})`
        : `Plate ${flag.plate} is also on ${otherApplications(flag.others.length)}`;
    }
    case 'sameIdNumber': {
      const [only] = flag.others;
      if (anyMasked(flag.others)) {
        return `The same ID number is on ${otherApplications(flag.others.length)}.`;
      }
      return flag.others.length === 1 && only
        ? `The same ID number is on ${only.name ?? ''}'s application (${otherState(only, timeZone)})`
        : `The same ID number is on ${otherApplications(flag.others.length)}`;
    }
    case 'expiresSoon': {
      const noun =
        flag.documentType === 'DRIVER_LICENSE' ? 'License' : DOCUMENT_WORDS[flag.documentType];
      return `${noun} expires ${longDate(flag.expiresOn)}, in ${flag.inDays} ${flag.inDays === 1 ? 'day' : 'days'}. They'll need to send a new one before then.`;
    }
    default:
      return `Applied before: rejected ${weekdayDate(storeDate(flag.rejectedAt, timeZone))}${flag.reasonGiven ? '' : ' · no reason given'}`;
  }
}

/** One row of a multi-application flag: "Victor Hale · Suspended Thu, Nov 19, 2026". */
export const flagOtherLine = (other: FlagOther, timeZone: string): string =>
  `${other.name ?? 'Hidden for demo staff'} · ${otherState(other, timeZone)}`;

// ------------------------------------------------------------------ what changed (A20.10)

const DECISIONS = new Set<HistoryType>([
  'sent-back',
  'approved',
  'rejected',
  'reopened',
  'suspended',
  'reinstated',
]);

/** Parts the applicant changed since the last staff decision: the "Changed" chips. */
export function changedSinceLastDecision(history: readonly HistoryEntry[]): ChangedPart[] {
  const parts = new Set<ChangedPart>();
  for (const entry of history) {
    if (DECISIONS.has(entry.type)) parts.clear();
    if (entry.type === 'updated' || entry.type === 'fixed') {
      entry.changedParts.forEach((part) => parts.add(part));
    }
  }
  return [...parts];
}

/** "Morgan Diaz approved this application at 6:04 pm." (A26.3). */
export function decidedBySentence(
  how: 'approved' | 'rejected' | 'sent-back' | 'suspended' | 'reinstated' | 'reopened',
  byName: string | null,
  at: string,
  timeZone: string,
): string {
  const verb = how === 'sent-back' ? 'sent back' : how;
  return `${byName ?? 'Someone'} ${verb} this application at ${clockAt(at, timeZone)}.`;
}
