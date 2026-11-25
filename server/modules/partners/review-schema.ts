import { z } from 'zod';
import type { PartnerStatus, VehicleType } from '@/server/db/enums';
import { stepUpInput } from '@/server/modules/staff/schema';
import type { ChangedPart, IdDocumentType, IsoDate } from './rules';
import { VEHICLE_TYPES } from './rules';
import type { StaffOnlineState } from './text';

/*
 * Staff review of partner applications (F6 A18 to A33): the Partners list, one application,
 * links to its photo and ID, and the six decisions. SUPPORT and ADMIN decide; only ADMIN
 * reinstates and reopens (U27); the demo admin reads, masked for real people (A29). Inputs are
 * strict; instants ISO 8601 UTC, shown in the store's time zone. No response ever carries the
 * full ID number, its ciphertext or keyed hash, or a storage key (A20.4, A30.5).
 */

// ------------------------------------------------------------------ constants

export const REVIEW_TEXT_MAX = 500;
export const LIST_PAGE_SIZE = 25;
/** A19.10, A20.10: quiet refreshes. */
export const LIST_REFRESH_MS = 60_000;
export const REVIEW_REFRESH_MS = 30_000;
/** A18.1: the sidebar badge recount. */
export const BADGE_REFRESH_MS = 60_000;
/** A21.1, A21.3: signed links live 5 minutes (shortened in tests through the environment). */
export const DOCUMENT_LINK_SECONDS = 300;
/** A19.4, U33: working days before the wait turns amber and red. Settings in F18. */
export const WAITING_AMBER_WORKING_DAYS = 1;
export const WAITING_RED_WORKING_DAYS = 2;
/** A23.5, A24.9: the same decision by the same person this soon after is a replay. */
export const DECISION_REPLAY_MS = 60_000;
/** A31.4, A25.6, A21.5: alerts (the limits themselves are rate-limit policies). */
export const SUSPEND_ALERT_AT = 6;
export const APPROVE_ALERT_ABOVE = 30;
export const DOCUMENT_PARTNERS_ALERT_ABOVE = 50;

export const REVIEW_FIELD_ERRORS = {
  message: 'Tell the applicant what to fix.',
  messageLength: 'Keep the message under 500 characters.',
  reasonLength: 'Keep the reason under 500 characters.',
  noteLength: 'Keep the note under 500 characters.',
  reopenNote: "Say why you're reopening it.",
  flags: 'Check this box to approve an application with flags.',
} as const;

// ------------------------------------------------------------------ tabs, list and sorting

export const PARTNER_TABS = [
  'review',
  'waiting',
  'approved',
  'suspended',
  'rejected',
  'all',
] as const;
export type PartnerTab = (typeof PARTNER_TABS)[number];

export const PARTNER_SORTS = ['name', 'sent', 'decided', 'changed'] as const;
export type PartnerSort = (typeof PARTNER_SORTS)[number];

/** A19.2, A19.7: the sorts each tab offers; the first is its default. */
export const TAB_SORTS: Record<PartnerTab, readonly [PartnerSort, ...PartnerSort[]]> = {
  review: ['sent', 'name'],
  waiting: ['sent', 'name'],
  approved: ['decided', 'name'],
  suspended: ['decided', 'name'],
  rejected: ['decided', 'name'],
  all: ['changed', 'name'],
};

/** Oldest first to review; latest first once decided (A19.2). */
export const defaultDir = (tab: PartnerTab): 'asc' | 'desc' =>
  tab === 'review' || tab === 'waiting' ? 'asc' : 'desc';

/**
 * The list's state, as the address carries it (A19.6, A19.7). Values the address can't mean
 * fall back to the defaults instead of failing, so an edited URL still shows a list. The
 * search is used from 2 characters; a plate matches without spaces or hyphens.
 */
export const partnerListInput = z
  .object({
    tab: z.enum(PARTNER_TABS).catch('review'),
    q: z
      .string()
      .catch('')
      .transform((value) => value.trim().slice(0, 100))
      .transform((value) => (value.length >= 2 ? value : '')),
    vehicle: z.enum(VEHICLE_TYPES).nullable().catch(null),
    flags: z.boolean().catch(false),
    sort: z.enum(PARTNER_SORTS).nullable().catch(null),
    dir: z.enum(['asc', 'desc']).nullable().catch(null),
    page: z.int().min(1).max(10_000).catch(1),
  })
  .strict()
  .transform((value) => {
    const sorts = TAB_SORTS[value.tab];
    return {
      ...value,
      sort: value.sort && sorts.includes(value.sort) ? value.sort : sorts[0],
      dir: value.dir ?? defaultDir(value.tab),
    };
  });
export type PartnerListInput = z.input<typeof partnerListInput>;
export type PartnerListQuery = z.output<typeof partnerListInput>;

/** `?tab=review&q=6vh&vehicle=car&flags=1&sort=sent&dir=asc&page=2` → the list input. */
export function listQueryFromSearch(search: Record<string, string | string[] | undefined>) {
  const one = (key: string) => {
    const value = search[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const vehicle = one('vehicle')?.toUpperCase();
  return partnerListInput.parse({
    tab: one('tab'),
    q: one('q'),
    vehicle: vehicle === undefined || vehicle === '' ? null : vehicle,
    flags: one('flags') === '1',
    sort: one('sort') ?? null,
    dir: one('dir') ?? null,
    page: Number.parseInt(one('page') ?? '1', 10),
  });
}

// ------------------------------------------------------------------ who did it

export type ReviewerRole = 'support' | 'admin';

/** A31.1: "Morgan Diaz (Support)", "Applicant", "Foodz (automatic)". */
export type ReviewActor =
  | { kind: 'staff'; name: string | null; role: ReviewerRole }
  | { kind: 'applicant' }
  | { kind: 'system' };

// ------------------------------------------------------------------ shared pieces

/** A19.4: a word, an icon and a border, never colour alone. */
export interface Waiting {
  tone: 'normal' | 'amber' | 'red';
  /** "Waiting 9 h", "Waiting 1 day", "Over 2 working days". */
  words: string;
  /** Red only: "waiting 3 days". */
  detail: string | null;
}

export type FlagKind = 'samePlate' | 'sameIdNumber' | 'expiresSoon' | 'appliedBefore';

/** The other side of a flag: name, state and date only (B28, A30.5). */
export interface FlagOther {
  /** Null for the demo admin when a real person is on either side (A22.8). */
  partnerId: string | null;
  name: string | null;
  status: PartnerStatus;
  banned: boolean;
  decidedAt: string | null;
}

export type ReviewFlag =
  | { kind: 'samePlate'; plate: string | null; others: FlagOther[] }
  | { kind: 'sameIdNumber'; others: FlagOther[] }
  | { kind: 'expiresSoon'; documentType: IdDocumentType; expiresOn: IsoDate; inDays: number }
  | { kind: 'appliedBefore'; rejectedAt: string; reasonGiven: boolean };

/** A21, design 8.6: each image's state, with a 5-minute link when it can be shown. */
export type ImageState =
  | { state: 'ready'; url: string; expiresAt: string }
  | { state: 'checking' }
  | { state: 'missing' }
  | { state: 'deleted'; deletedAt: string }
  | { state: 'none' }
  | { state: 'masked' };

export const HISTORY_TYPES = [
  'applied',
  'updated',
  'sent-back',
  'fixed',
  'approved',
  'rejected',
  'reopened',
  'suspended',
  'taken-offline',
  'reinstated',
  'files-deleted',
] as const;
export type HistoryType = (typeof HISTORY_TYPES)[number];

/** A31.1: one row of `partner_application_events`, oldest first. */
export interface HistoryEntry {
  id: string;
  type: HistoryType;
  at: string;
  actor: ReviewActor;
  /** The message or reason the applicant read; null when none (or masked). */
  applicantText: string | null;
  staffNote: string | null;
  changedParts: ChangedPart[];
  /** Demo admin, real person: names, texts and notes withheld (A29.3). */
  masked: boolean;
}

export const REVIEW_ACTIONS = [
  'approve',
  'sendBack',
  'reject',
  'suspend',
  'reinstate',
  'reopen',
] as const;
export type ReviewAction = (typeof REVIEW_ACTIONS)[number];

/**
 * One entry of the header's actions (design 8.2), in display order. A `button` may be
 * disabled with its reason as a caption; a `line` replaces the button with its reason.
 */
export interface ReviewActionState {
  action: ReviewAction;
  display: 'button' | 'line';
  enabled: boolean;
  reason: string | null;
  /** Approve, suspend and reinstate when the last code check is over 10 minutes old (A27). */
  stepUp: boolean;
}

// ------------------------------------------------------------------ list rows and result

export interface PartnerListRow {
  partnerId: string;
  name: string;
  email: string;
  status: PartnerStatus;
  tab: Exclude<PartnerTab, 'all'>;
  /** "To review", "Waiting for the applicant", "Approved", "Suspended", "Rejected". */
  statusWords: string;
  vehicle: VehicleType;
  /** "Car · 6VH 450", "Bicycle or e-bike". */
  vehicleWords: string;
  /** "Driver's license ending 5521" and "Expires Dec 10, 2026"; null after files are deleted. */
  document: { words: string; expiresWords: string } | null;
  submittedAt: string;
  /** Set when the applicant edited after sending (A19.3). */
  updatedAt: string | null;
  fixedAfterSendBack: boolean;
  waiting: Waiting | null;
  sentBack: { at: string; byName: string | null; waiting: Waiting } | null;
  decided: { at: string; byName: string | null } | null;
  /** Approved and suspended rows (A19.5). */
  online: { state: StaffOnlineState['kind']; words: string } | null;
  partnerSince: string | null;
  rejected: { reapplyFrom: IsoDate; canReapplyNow: boolean; filesDeletedOn: IsoDate | null } | null;
  lastChangeAt: string;
  flags: FlagKind[];
  banned: boolean;
  isDemoPartner: boolean;
  /** Name, email and plate arrive masked for the demo admin (A29.3). */
  masked: boolean;
}

export interface PartnerListResult {
  asOf: string;
  query: PartnerListQuery;
  /** Every application in each state, whatever the search and filters (A19.1). */
  counts: Record<PartnerTab, number>;
  rows: PartnerListRow[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
  /** "Applications to review, oldest first, 2 results" (A32.5). */
  caption: string;
}

/** A18.1: "Partners, 2 applications to review". */
export interface PartnerBadge {
  toReview: number;
}

// ------------------------------------------------------------------ one application

export interface PartnerReview {
  partnerId: string;
  /** Send back as `expectedVersion` with every decision (A26.1). */
  version: number;
  asOf: string;
  status: PartnerStatus;
  tab: Exclude<PartnerTab, 'all'>;
  statusWords: string;
  name: string;
  firstName: string;
  email: string;
  /** SUPPORT and ADMIN only; null when masked or none (A20.2). */
  phone: { e164: string; display: string } | null;
  customer: { since: string; orderCount: number };
  submittedAt: string;
  updatedAt: string | null;
  waiting: Waiting | null;
  vehicle: { type: VehicleType; words: string; plate: string | null };
  /** "Ending 5521" is all anyone sees (U26). Null once the files are deleted. */
  document: {
    type: IdDocumentType;
    typeWords: string;
    last4: string;
    expiresOn: IsoDate;
    expiresInDays: number | null;
  } | null;
  agreed: { termsVersion: number; acceptedAt: string; adultConfirmedAt: string };
  images: { photo: ImageState; idFront: ImageState };
  flags: ReviewFlag[];
  /** Design 8.3, decided and sent-back states. */
  decision: {
    sentBack: { at: string; by: ReviewActor; message: string | null } | null;
    fixedAt: string | null;
    decided: { type: 'approved' | 'rejected' | 'suspended'; at: string; by: ReviewActor } | null;
    applicantText: string | null;
    reapplyFrom: IsoDate | null;
    filesDeleteOn: IsoDate | null;
    filesDeletedAt: string | null;
  };
  /** Approved and suspended partners: online or not, never where (A20.5, B33). */
  online: { state: StaffOnlineState; words: string } | null;
  partnerSince: string | null;
  banned: { reason: string | null } | null;
  isDemoPartner: boolean;
  actions: ReviewActionState[];
  stepUpRequired: boolean;
  /** Changed by the applicant since the last decision: the "Changed" chips (A20.10, A24.4). */
  changedParts: ChangedPart[];
  history: HistoryEntry[];
  /** Per block: "Hidden for demo staff" (A29.3). */
  masked: { applicant: boolean; vehicle: boolean; document: boolean; texts: boolean };
}

/** The dialog's opening check (A26.5) and the suspend dialog's online line (A25.1). */
export interface PartnerVersion {
  partnerId: string;
  version: number;
  status: PartnerStatus;
  online: boolean;
  lastChange: ApplicationChange | null;
}

export interface ApplicationChange {
  how: 'edited' | 'approved' | 'rejected' | 'sent-back' | 'suspended' | 'reinstated' | 'reopened';
  by: ReviewActor;
  at: string;
  changedParts: ChangedPart[];
}

// ------------------------------------------------------------------ inputs

const partnerId = z.uuid();
const expectedVersion = z.int().min(0).max(2_147_483_647);

// Every control character but the line feed.
// oxlint-disable-next-line no-control-regex
const CONTROL_EXCEPT_NEWLINE = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]+/g;
const FORMAT = /\p{Cf}/gu;
const keepJoiners = (char: string) => (char === '‌' || char === '‍' ? char : '');

/**
 * Text the applicant reads exactly as typed (A20.9, P7.7): line breaks kept, other control
 * characters become a space, invisible format characters removed, ends trimmed. Plain text;
 * nothing is rendered as markup. Blank is none.
 */
export function cleanApplicantText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL_EXCEPT_NEWLINE, ' ')
    .replace(FORMAT, keepJoiners)
    .trim();
}

const reviewText = (lengthError: string) =>
  z
    .string()
    .max(REVIEW_TEXT_MAX * 4, lengthError)
    .transform(cleanApplicantText)
    .pipe(z.string().max(REVIEW_TEXT_MAX, lengthError));

const optionalText = (lengthError: string) =>
  reviewText(lengthError)
    .transform((value) => value || undefined)
    .optional();

const staffNote = optionalText(REVIEW_FIELD_ERRORS.noteLength);

export const partnerIdInput = z.object({ partnerId }).strict();
export type PartnerIdInput = z.input<typeof partnerIdInput>;

export const badgeInput = z.object({}).strict();

/** A21.4: a fresh 5-minute link. ID images are audited (A21.5). */
export const documentLinkInput = z
  .object({ partnerId, kind: z.enum(['photo', 'idFront']) })
  .strict();
export type DocumentLinkInput = z.input<typeof documentLinkInput>;

/** A23: flags need the tick; the code comes with it when the last check is stale. */
export const approveInput = z
  .object({
    partnerId,
    expectedVersion,
    flagsChecked: z.boolean().default(false),
    staffNote,
    stepUp: stepUpInput.optional(),
  })
  .strict();
export type ApproveInput = z.input<typeof approveInput>;

/** A24.2: the message is required. No code (U28). */
export const sendBackInput = z
  .object({
    partnerId,
    expectedVersion,
    message: reviewText(REVIEW_FIELD_ERRORS.messageLength).pipe(
      z.string().min(1, REVIEW_FIELD_ERRORS.message),
    ),
    staffNote,
  })
  .strict();
export type SendBackInput = z.input<typeof sendBackInput>;

/** A24.6: the reason is optional. No code. */
export const rejectInput = z
  .object({
    partnerId,
    expectedVersion,
    reason: optionalText(REVIEW_FIELD_ERRORS.reasonLength),
    staffNote,
  })
  .strict();
export type RejectInput = z.input<typeof rejectInput>;

/** A25.1: the reason is optional; a code when stale. */
export const suspendInput = z
  .object({
    partnerId,
    expectedVersion,
    reason: optionalText(REVIEW_FIELD_ERRORS.reasonLength),
    staffNote,
    stepUp: stepUpInput.optional(),
  })
  .strict();
export type SuspendInput = z.input<typeof suspendInput>;

/** A25.3: ADMIN only; a code when stale. */
export const reinstateInput = z
  .object({ partnerId, expectedVersion, staffNote, stepUp: stepUpInput.optional() })
  .strict();
export type ReinstateInput = z.input<typeof reinstateInput>;

/** A28.1: ADMIN only; the staff note is required. No code. */
export const reopenInput = z
  .object({
    partnerId,
    expectedVersion,
    staffNote: reviewText(REVIEW_FIELD_ERRORS.noteLength).pipe(
      z.string().min(1, REVIEW_FIELD_ERRORS.reopenNote),
    ),
  })
  .strict();
export type ReopenInput = z.input<typeof reopenInput>;

// ------------------------------------------------------------------ results and refusals

export interface DecisionResult {
  partnerId: string;
  status: PartnerStatus;
  version: number;
  at: string;
  eventId: string;
  /** A23.3: the oldest application left to review, after approve, send back and reject. */
  next: { partnerId: string; name: string } | null;
  /** Suspend: whether the partner was online and was taken offline (A25.1, A25.2). */
  wasOnline: boolean | null;
  replayed: boolean;
}

export interface DocumentLink {
  url: string;
  expiresAt: string;
}

/** `details` per refusal code (server/errors.ts). */
export interface ReviewRefusalDetails {
  APPLICATION_CHANGED: {
    partnerId: string;
    current: { status: PartnerStatus; version: number };
  } & ApplicationChange;
  APPLICATION_GONE: { how: 'withdrawn' | 'account-deleted'; at: string };
  INVALID_STATE: { partnerId: string; status: PartnerStatus };
  ALREADY_SENT_BACK: { partnerId: string; sentBackAt: string };
  ID_EXPIRED: { expiredOn: IsoDate; documentType: IdDocumentType };
  IMAGE_NOT_READY: { image: 'photo' | 'idFront'; kind: 'checking' | 'missing' };
  FILES_DELETED: { deletedOn: IsoDate };
  ACCOUNT_BANNED: { partnerId: string };
  DEMO_PARTNER: { partnerId: string };
  FLAGS_NOT_CHECKED: { flags: FlagKind[] };
}
