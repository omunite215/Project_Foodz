import 'server-only';
import { v7 as uuidv7 } from 'uuid';
import type { z } from 'zod';
import { displayPhone } from '@/lib/phone';
import { can, type Permission } from '@/server/auth/roles';
import { requirePermission, type UserActor } from '@/server/auth/session';
import { runAs } from '@/server/db/context';
import type { PartnerStatus } from '@/server/db/enums';
import { AppError, forbidden } from '@/server/errors';
import { logger } from '@/server/logger';
import { audit } from '@/server/modules/audit/service';
import { activeDeliveryOf, partnerLeaving } from '@/server/modules/delivery/service';
import { getStoreStatus } from '@/server/modules/menu/service';
import { passStepUp, stepUpFreshUntilFor, stepUpRequired } from '@/server/modules/staff/service';
import { objectSize, presignDownload } from '@/server/storage/s3';
import { type PartnerEffect, runPartnerEffects } from './effects';
import { countHourly, readPoints } from './location-store';
import { freshnessOf } from './location';
import { PARTNER_NOTICES } from './notices';
import {
  countTabs,
  countToReview as countReview,
  type DecisionWrite,
  type DirectoryRow,
  findDirectoryRow,
  findFlagMatches,
  findHistory,
  findNextToReview,
  findStaffName,
  findWithdrawal,
  type HistoryRow,
  insertHistory,
  listDirectory,
  lockPartner,
  promoteToPartner,
  writeDecision,
} from './repo';
import {
  type ApplicationChange,
  approveInput,
  DECISION_REPLAY_MS,
  DOCUMENT_LINK_SECONDS,
  type DecisionResult,
  type DocumentLink,
  documentLinkInput,
  type FlagKind,
  type HistoryEntry,
  type HistoryType,
  type ImageState,
  LIST_PAGE_SIZE,
  type PartnerBadge,
  type PartnerListQuery,
  type PartnerListResult,
  type PartnerListRow,
  type PartnerReview,
  type PartnerVersion,
  partnerIdInput,
  reinstateInput,
  rejectInput,
  reopenInput,
  type ReviewActor,
  type ReviewFlag,
  type ReviewerRole,
  sendBackInput,
  suspendInput,
  APPROVE_ALERT_ABOVE,
  DOCUMENT_PARTNERS_ALERT_ABOVE,
  SUSPEND_ALERT_AT,
} from './review-schema';
import {
  changedSinceLastDecision,
  isWaitingForApplicant,
  listCaption,
  reviewActions,
  TAB_WORDS,
  tabOf,
  waitingOf,
} from './review-state';
import { type ChangedPart, expiryVerdict, reapplyDate } from './rules';
import {
  DOCUMENT_NOUN,
  DOCUMENT_WORDS,
  longDate,
  type StaffOnlineState,
  staffOnlineCell,
  staffOnlineWords,
  storeDate,
  vehicleLine,
} from './text';

/*
 * Staff review (F6 A18 to A33). Reads go through `partner_directory` and
 * `partner_event_directory`, which mask real people for the demo admin (B27). Every decision:
 * lock the row → not found / gone → replay (the caller's same decision within 60 s) → version
 * (`APPLICATION_CHANGED`) → state and role → decision rules → step-up → the row, the history row
 * and the audit entry in one transaction as the caller. A refusal changes nothing and writes
 * nothing. Effects run after commit.
 */

const READ: Permission = { partner: ['review-application'] };
const DECIDED_TYPES = new Set<HistoryType>(['approved', 'rejected', 'suspended', 'reinstated']);
const CHANGE_HOW: Partial<Record<HistoryType, ApplicationChange['how']>> = {
  approved: 'approved',
  rejected: 'rejected',
  'sent-back': 'sent-back',
  suspended: 'suspended',
  'taken-offline': 'suspended',
  reinstated: 'reinstated',
  reopened: 'reopened',
};
const isoDateOf = (date: Date) => date.toISOString().slice(0, 10);
const iso = (date: Date | null) => date?.toISOString() ?? null;

/**
 * The same gate as the action wrapper, again in the service, so server renders that call it
 * directly get it too: the permission, two-factor for staff, the 12-hour staff session, and the
 * demo admin reading only (security gate S4).
 */
async function requireReviewer(
  actor: UserActor,
  permission: Permission = READ,
  write = false,
): Promise<ReviewerRole> {
  const checked = await requirePermission(permission, { write });
  if (checked.userId !== actor.userId) throw forbidden();
  if (!can(actor.role, permission)) throw forbidden();
  if (actor.role !== 'support' && actor.role !== 'admin') throw forbidden();
  return actor.role;
}

const refuse = (
  code: AppError['code'],
  message: string,
  status: number,
  details?: Record<string, unknown>,
) => new AppError(code, message, status, details ? { details } : {});

const notFoundError = () => new AppError('NOT_FOUND', 'Application not found.', 404);

async function storeTime(now: Date) {
  const store = await getStoreStatus(now);
  return { timeZone: store.timeZone, today: storeDate(now, store.timeZone) };
}

const firstNameOf = (name: string) => name.split(/\s+/)[0] ?? name;
const pageOf = (n: number) => ({ offset: (n - 1) * LIST_PAGE_SIZE, limit: LIST_PAGE_SIZE });

// ------------------------------------------------------------------ shaping

function actorOf(row: Pick<HistoryRow, 'actorKind' | 'actorName' | 'actorRole'>): ReviewActor {
  if (row.actorKind === 'staff') {
    return {
      kind: 'staff',
      name: row.actorName,
      role: row.actorRole === 'admin' ? 'admin' : 'support',
    };
  }
  return row.actorKind === 'applicant' ? { kind: 'applicant' } : { kind: 'system' };
}

const historyEntry = (row: HistoryRow): HistoryEntry => ({
  id: row.id,
  type: row.type,
  at: row.at.toISOString(),
  actor: actorOf(row),
  applicantText: row.applicantText,
  staffNote: row.staffNote,
  changedParts: row.changedParts,
  masked: row.masked,
});

function onlineState(
  row: DirectoryRow,
  lastPointAt: string | null,
  now: Date,
): StaffOnlineState | null {
  if (row.status !== 'APPROVED' && row.status !== 'SUSPENDED') return null;
  if (row.isOnline && row.onlineSince) {
    return freshnessOf({ isOnline: true, lastPointAt }, now) === 'available' && lastPointAt
      ? { kind: 'online', since: row.onlineSince.toISOString(), lastPointAt }
      : { kind: 'stale', since: row.onlineSince.toISOString(), lastPointAt };
  }
  if (
    row.offlineAt &&
    (row.offlineReason === 'no-location' ||
      row.offlineReason === 'kitchen-closed' ||
      row.offlineReason === 'suspended')
  ) {
    return { kind: 'takenOffline', reason: row.offlineReason, at: row.offlineAt.toISOString() };
  }
  return { kind: 'offline', lastSeenAt: iso(row.lastSeenAt) };
}

function flagKinds(row: DirectoryRow, today: string): FlagKind[] {
  const kinds: FlagKind[] = [];
  if (row.plateShared) kinds.push('samePlate');
  if (row.idShared) kinds.push('sameIdNumber');
  if (
    row.status === 'APPLIED' &&
    row.idDocumentExpiresOn &&
    expiryVerdict(isoDateOf(row.idDocumentExpiresOn), today).kind === 'soon'
  ) {
    kinds.push('expiresSoon');
  }
  if (row.appliedBefore) kinds.push('appliedBefore');
  return kinds;
}

function decidedOf(row: DirectoryRow): Date | null {
  if (row.status === 'SUSPENDED') return row.suspendedAt;
  if (row.status === 'APPROVED') return row.decidedAt ?? row.approvedAt;
  if (row.status === 'REJECTED') return row.decidedAt;
  return null;
}

function listRow(
  row: DirectoryRow,
  lastPointAt: string | null,
  now: Date,
  timeZone: string,
  today: string,
): PartnerListRow {
  const tab = tabOf(row);
  const waiting = isWaitingForApplicant(row);
  const online = onlineState(row, lastPointAt, now);
  const reapplyFrom = row.reapplyAfter ? isoDateOf(row.reapplyAfter) : null;
  const decided = decidedOf(row);
  return {
    partnerId: row.id,
    name: row.name,
    email: row.email,
    status: row.status,
    tab,
    statusWords: TAB_WORDS[tab],
    vehicle: row.vehicleType,
    vehicleWords: vehicleLine(row.vehicleType, row.vehiclePlate),
    document:
      row.idDocumentType && row.idNumberLast4 && row.idDocumentExpiresOn
        ? {
            words: `${DOCUMENT_WORDS[row.idDocumentType]} ending ${row.idNumberLast4}`,
            expiresWords: `Expires ${longDate(isoDateOf(row.idDocumentExpiresOn))}`,
          }
        : null,
    submittedAt: (row.submittedAt ?? row.createdAt).toISOString(),
    updatedAt: iso(row.editedAt),
    fixedAfterSendBack: row.status === 'APPLIED' && !waiting && row.fixedAt !== null,
    waiting:
      tab === 'review'
        ? waitingOf((row.submittedAt ?? row.createdAt).toISOString(), now, timeZone)
        : null,
    sentBack:
      waiting && row.changesRequestedAt
        ? {
            at: row.changesRequestedAt.toISOString(),
            byName: row.sentBackByName,
            waiting: waitingOf(row.changesRequestedAt.toISOString(), now, timeZone),
          }
        : null,
    decided: decided ? { at: decided.toISOString(), byName: row.decidedByName } : null,
    online: online && { state: online.kind, words: staffOnlineCell(online, now, timeZone) },
    partnerSince: iso(row.approvedAt),
    rejected:
      row.status === 'REJECTED' && reapplyFrom
        ? {
            reapplyFrom,
            canReapplyNow: reapplyFrom <= today,
            filesDeletedOn: row.filesDeletedAt ? storeDate(row.filesDeletedAt, timeZone) : null,
          }
        : null,
    lastChangeAt: row.updatedAt.toISOString(),
    flags: flagKinds(row, today),
    banned: row.banned,
    isDemoPartner: row.isDemo,
    masked: row.masked,
  };
}

// ------------------------------------------------------------------ the list (A19)

/** `/admin/partners` and its refetches (A19). */
export async function listPartnerApplications(
  actor: UserActor,
  query: PartnerListQuery,
  now = new Date(),
): Promise<PartnerListResult> {
  await requireReviewer(actor);
  const { timeZone, today } = await storeTime(now);
  const day = new Date(`${today}T00:00:00Z`);
  const { rows, total, counts, page, pageCount } = await runAs(actor, async (ctx) => {
    let listed = await listDirectory(ctx, query, pageOf(query.page), day);
    const pages = Math.max(1, Math.ceil(listed.total / LIST_PAGE_SIZE));
    // A page past the end shows the last page (A19.7).
    const current = Math.min(query.page, pages);
    if (current !== query.page) listed = await listDirectory(ctx, query, pageOf(current), day);
    return { ...listed, counts: await countTabs(ctx), page: current, pageCount: pages };
  });
  const points = await readPoints(rows.filter((row) => row.isOnline).map((row) => row.id));
  return {
    asOf: now.toISOString(),
    query: { ...query, page },
    counts,
    rows: rows.map((row) =>
      listRow(row, points.get(row.id)?.acceptedAt ?? null, now, timeZone, today),
    ),
    total,
    page,
    pageCount,
    pageSize: LIST_PAGE_SIZE,
    caption: listCaption(query.tab, query.sort, query.dir, total),
  };
}

/** A18.1: the sidebar badge. */
export async function countToReview(actor: UserActor): Promise<PartnerBadge> {
  await requireReviewer(actor);
  return { toReview: await runAs(actor, countReview) };
}

// ------------------------------------------------------------------ one application (A20)

async function imageState(
  actor: UserActor,
  row: DirectoryRow,
  kind: 'photo' | 'idFront',
  now: Date,
  options: { audit: boolean },
): Promise<ImageState> {
  if (row.filesDeletedAt) return { state: 'deleted', deletedAt: row.filesDeletedAt.toISOString() };
  const uploadId = kind === 'photo' ? row.photoUploadId : row.idDocumentUploadId;
  const key = kind === 'photo' ? row.photoKey : row.idDocumentKey;
  const status = kind === 'photo' ? row.photoStatus : row.idDocumentStatus;
  if (!uploadId) return { state: 'none' };
  if (row.masked || !key) return row.masked ? { state: 'masked' } : { state: 'missing' };
  if (status !== 'READY') return { state: 'checking' };
  if ((await objectSize('PRIVATE', key)) === null) {
    logger.error({ partnerId: row.id, kind }, 'partner image missing from storage');
    return { state: 'missing' };
  }
  const url = await presignDownload('PRIVATE', key, linkSeconds());
  if (kind === 'idFront' && options.audit) await recordDocumentView(actor, row.id);
  return {
    state: 'ready',
    url,
    expiresAt: new Date(now.getTime() + linkSeconds() * 1000).toISOString(),
  };
}

/** A21.3: tests shorten links through the environment. */
function linkSeconds() {
  const override = Number(process.env.PARTNER_DOCUMENT_LINK_SECONDS);
  return Number.isInteger(override) && override > 0 && override <= DOCUMENT_LINK_SECONDS
    ? override
    : DOCUMENT_LINK_SECONDS;
}

/** A21.5: every link to an ID image is audited; 50 partners an hour by one account alerts. */
async function recordDocumentView(actor: UserActor, partnerId: string) {
  await runAs(actor, (ctx) =>
    audit(ctx, {
      action: 'partner.document-viewed',
      targetType: 'partner',
      targetId: partnerId,
      data: { kind: 'idFront' },
    }),
  );
  const partners = await countHourly('partner-documents', actor.userId, partnerId);
  if (partners === DOCUMENT_PARTNERS_ALERT_ABOVE + 1) {
    logger.error(
      { actorId: actor.userId, alert: 'partner-documents' },
      'ID images of many partners viewed',
    );
  }
}

function flagsOf(
  row: DirectoryRow,
  matches: Awaited<ReturnType<typeof findFlagMatches>>,
  history: HistoryRow[],
  today: string,
): ReviewFlag[] {
  const flags: ReviewFlag[] = [];
  const hidden = (match: (typeof matches)[number]) => row.masked || match.masked;
  const otherOf = (match: (typeof matches)[number]) => ({
    partnerId: hidden(match) ? null : match.id,
    name: hidden(match) ? null : match.name,
    status: match.status,
    banned: match.banned,
    decidedAt: iso(match.decidedAt),
  });
  const plates = matches.filter((match) => match.samePlate);
  if (plates.length > 0) {
    flags.push({
      kind: 'samePlate',
      plate: plates.some(hidden) ? null : row.vehiclePlate,
      others: plates.map(otherOf),
    });
  }
  const numbers = matches.filter((match) => match.sameIdNumber);
  if (numbers.length > 0) flags.push({ kind: 'sameIdNumber', others: numbers.map(otherOf) });
  if (row.status === 'APPLIED' && row.idDocumentExpiresOn && row.idDocumentType) {
    const expiresOn = isoDateOf(row.idDocumentExpiresOn);
    const verdict = expiryVerdict(expiresOn, today);
    if (verdict.kind === 'soon') {
      flags.push({
        kind: 'expiresSoon',
        documentType: row.idDocumentType,
        expiresOn,
        inDays: verdict.inDays,
      });
    }
  }
  const applied = history.filter((entry) => entry.type === 'applied');
  const lastApplied = applied.at(-1);
  const rejectedBefore = lastApplied
    ? history.findLast((entry) => entry.type === 'rejected' && entry.at < lastApplied.at)
    : undefined;
  if (applied.length > 1 && rejectedBefore) {
    flags.push({
      kind: 'appliedBefore',
      rejectedAt: rejectedBefore.at.toISOString(),
      reasonGiven: rejectedBefore.applicantText !== null,
    });
  }
  return flags;
}

async function stepUpFresh(actor: UserActor, now: Date) {
  const until = await stepUpFreshUntilFor(actor, now);
  return until !== null && until.getTime() > now.getTime();
}

/** `/admin/partners/<id>` (A20): null for an unknown, non-UUID or withdrawn id (404 page). */
export async function getPartnerReview(
  actor: UserActor,
  partnerId: string,
  now = new Date(),
): Promise<PartnerReview | null> {
  const role = await requireReviewer(actor);
  if (!partnerIdInput.safeParse({ partnerId }).success) return null;
  const { timeZone, today } = await storeTime(now);
  const data = await runAs(actor, async (ctx) => {
    const row = await findDirectoryRow(ctx, partnerId);
    if (!row) return null;
    return {
      row,
      history: await findHistory(ctx, partnerId),
      matches: await findFlagMatches(ctx, row),
    };
  });
  if (!data) return null;
  const { row, history, matches } = data;
  const [point] = row.isOnline ? [...(await readPoints([row.id])).values()] : [];
  const online = onlineState(row, point?.acceptedAt ?? null, now);
  const tab = tabOf(row);
  const waiting = isWaitingForApplicant(row);
  const fresh = await stepUpFresh(actor, now);
  const lastSentBack = history.findLast((entry) => entry.type === 'sent-back');
  const lastDecision = history.findLast((entry) => DECIDED_TYPES.has(entry.type));
  const reapplyFrom = row.reapplyAfter ? isoDateOf(row.reapplyAfter) : null;
  const filesDeletedOn = row.filesDeletedAt
    ? longDate(storeDate(row.filesDeletedAt, timeZone))
    : null;
  const decidedType =
    row.status === 'APPROVED'
      ? 'approved'
      : row.status === 'REJECTED'
        ? 'rejected'
        : row.status === 'SUSPENDED'
          ? 'suspended'
          : null;

  return {
    partnerId: row.id,
    version: row.version,
    asOf: now.toISOString(),
    status: row.status,
    tab,
    statusWords: TAB_WORDS[tab],
    name: row.name,
    firstName: firstNameOf(row.name),
    email: row.email,
    phone:
      row.phone && !row.masked
        ? { e164: row.phone, display: displayPhone(row.phone).display }
        : null,
    customer: { since: row.customerSince.toISOString(), orderCount: row.orderCount },
    submittedAt: (row.submittedAt ?? row.createdAt).toISOString(),
    updatedAt: iso(row.editedAt),
    waiting:
      tab === 'review'
        ? waitingOf((row.submittedAt ?? row.createdAt).toISOString(), now, timeZone)
        : null,
    vehicle: {
      type: row.vehicleType,
      words: vehicleLine(row.vehicleType, null),
      plate: row.vehiclePlate,
    },
    document:
      row.idDocumentType && row.idNumberLast4 && row.idDocumentExpiresOn
        ? {
            type: row.idDocumentType,
            typeWords: DOCUMENT_WORDS[row.idDocumentType],
            last4: row.idNumberLast4,
            expiresOn: isoDateOf(row.idDocumentExpiresOn),
            expiresInDays: (() => {
              const verdict = expiryVerdict(isoDateOf(row.idDocumentExpiresOn), today);
              return verdict.kind === 'expired' ? null : verdict.inDays;
            })(),
          }
        : null,
    agreed: {
      termsVersion: row.partnerTermsVersion ?? 1,
      acceptedAt: (row.partnerTermsAcceptedAt ?? row.createdAt).toISOString(),
      adultConfirmedAt: (row.adultConfirmedAt ?? row.createdAt).toISOString(),
    },
    images: {
      photo: await imageState(actor, row, 'photo', now, { audit: false }),
      idFront: await imageState(actor, row, 'idFront', now, { audit: true }),
    },
    flags: flagsOf(row, matches, history, today),
    decision: {
      sentBack:
        lastSentBack && row.changesRequestedAt
          ? {
              at: lastSentBack.at.toISOString(),
              by: actorOf(lastSentBack),
              message: row.changesRequestedNote,
            }
          : null,
      fixedAt: waiting ? null : iso(row.fixedAt),
      decided:
        decidedType && lastDecision
          ? { type: decidedType, at: lastDecision.at.toISOString(), by: actorOf(lastDecision) }
          : null,
      applicantText:
        row.status === 'SUSPENDED'
          ? row.suspensionReason
          : row.status === 'REJECTED'
            ? row.decisionReason
            : null,
      reapplyFrom,
      filesDeleteOn: row.status === 'REJECTED' && !row.filesDeletedAt ? reapplyFrom : null,
      filesDeletedAt: iso(row.filesDeletedAt),
    },
    online: online && { state: online, words: staffOnlineWords(online, now, timeZone) },
    partnerSince: iso(row.approvedAt),
    banned: row.banned ? { reason: row.banReason } : null,
    isDemoPartner: row.isDemo,
    actions: reviewActions(
      {
        status: row.status,
        waitingForApplicant: waiting,
        sentBackOn: row.changesRequestedAt
          ? new Date(row.changesRequestedAt).toLocaleDateString('en-US', {
              timeZone,
              weekday: 'short',
              month: 'short',
              day: 'numeric',
            })
          : null,
        firstName: firstNameOf(row.name),
        banned: row.banned,
        isDemoPartner: row.isDemo,
        filesDeletedOn,
      },
      { role, readOnly: actor.isDemo, stepUpFresh: fresh },
    ),
    stepUpRequired: !fresh,
    changedParts: changedSinceLastDecision(history.map(historyEntry)),
    history: history.map(historyEntry),
    masked: { applicant: row.masked, vehicle: row.masked, document: row.masked, texts: row.masked },
  };
}

function lastChangeOf(history: HistoryRow[], since: number): ApplicationChange | null {
  const last = history.at(-1);
  if (!last) return null;
  if (last.type === 'updated' || last.type === 'fixed' || last.type === 'applied') {
    const parts = new Set<ChangedPart>();
    for (const entry of history) {
      if (
        (entry.type === 'updated' || entry.type === 'fixed') &&
        (entry.versionAfter ?? 0) > since
      ) {
        entry.changedParts.forEach((part) => parts.add(part));
      }
    }
    return {
      how: 'edited',
      by: { kind: 'applicant' },
      at: last.at.toISOString(),
      changedParts: [...parts],
    };
  }
  const how = CHANGE_HOW[last.type] ?? 'edited';
  return { how, by: actorOf(last), at: last.at.toISOString(), changedParts: [] };
}

/** A26.5: the dialog's opening check; also the suspend dialog's online line. */
export async function getPartnerVersion(actor: UserActor, input: unknown): Promise<PartnerVersion> {
  await requireReviewer(actor);
  const { partnerId } = partnerIdInput.parse(input);
  const found = await runAs(actor, async (ctx) => {
    const row = await findDirectoryRow(ctx, partnerId);
    return row ? { row, history: await findHistory(ctx, partnerId) } : null;
  });
  if (!found) throw await goneOrNotFound(actor, partnerId);
  return {
    partnerId,
    version: found.row.version,
    status: found.row.status,
    online: found.row.isOnline,
    lastChange: lastChangeOf(found.history, 0),
    assignedOrderNumber: (await activeDeliveryOf(partnerId))?.orderNumber ?? null,
  };
}

/**
 * A21.4: a fresh 5-minute link. ID images write `partner.document-viewed`. The demo admin gets
 * links to sample and demo accounts only; anything else answers `NOT_FOUND` (A29.4).
 */
export async function getDocumentLink(
  actor: UserActor,
  input: z.input<typeof documentLinkInput>,
  now = new Date(),
): Promise<DocumentLink | ImageState> {
  await requireReviewer(actor);
  const { partnerId, kind } = documentLinkInput.parse(input);
  const row = await runAs(actor, (ctx) => findDirectoryRow(ctx, partnerId));
  if (!row || row.masked) throw notFoundError();
  const state = await imageState(actor, row, kind, now, { audit: true });
  return state.state === 'ready' ? { url: state.url, expiresAt: state.expiresAt } : state;
}

// ------------------------------------------------------------------ decisions (A23 to A28)

type Decision = 'approve' | 'sendBack' | 'reject' | 'suspend' | 'reinstate' | 'reopen';

const HISTORY_OF: Record<Decision, HistoryType> = {
  approve: 'approved',
  sendBack: 'sent-back',
  reject: 'rejected',
  suspend: 'suspended',
  reinstate: 'reinstated',
  reopen: 'reopened',
};

const STATUS_AFTER: Record<Decision, PartnerStatus> = {
  approve: 'APPROVED',
  sendBack: 'APPLIED',
  reject: 'REJECTED',
  suspend: 'SUSPENDED',
  reinstate: 'APPROVED',
  reopen: 'APPLIED',
};

const NEEDS_STEP_UP = new Set<Decision>(['approve', 'suspend', 'reinstate']);

interface DecisionInput {
  partnerId: string;
  expectedVersion: number;
  staffNote?: string | undefined;
  applicantText?: string | undefined;
  flagsChecked?: boolean;
  stepUp?: unknown;
}

async function goneOrNotFound(actor: UserActor, partnerId: string): Promise<AppError> {
  const withdrawal = await runAs({ kind: 'system', reason: 'partner tombstone' }, (ctx) =>
    findWithdrawal(ctx, partnerId, new Date(Date.now() - 24 * 60 * 60 * 1000)),
  );
  if (!withdrawal) return notFoundError();
  const data = withdrawal.data;
  const how =
    data && typeof data === 'object' && !Array.isArray(data) && data.how === 'account-deleted'
      ? 'account-deleted'
      : 'withdrawn';
  return refuse(
    'APPLICATION_GONE',
    how === 'withdrawn'
      ? 'The applicant withdrew the application.'
      : 'The applicant deleted their Foodz account.',
    410,
    {
      how,
      at: withdrawal.createdAt.toISOString(),
    },
  );
}

function changedError(row: DirectoryRow, change: ApplicationChange | null) {
  return refuse('APPLICATION_CHANGED', 'This application changed after you opened it.', 409, {
    partnerId: row.id,
    current: { status: row.status, version: row.version },
    how: change?.how ?? 'edited',
    by: change?.by ?? { kind: 'applicant' },
    at: change?.at ?? row.updatedAt.toISOString(),
    changedParts: change?.changedParts ?? [],
  });
}

/** State, role and rule checks of a decision (§3.1), before anything is written. */
function checkDecision(
  decision: Decision,
  role: ReviewerRole,
  row: DirectoryRow,
  flags: FlagKind[],
  input: DecisionInput,
  today: string,
) {
  const invalid = () =>
    refuse('INVALID_STATE', "This application can't take that decision now.", 409, {
      partnerId: row.id,
      status: row.status,
    });
  const waiting = isWaitingForApplicant(row);
  switch (decision) {
    case 'approve': {
      if (row.status !== 'APPLIED') throw invalid();
      if (row.banned) {
        throw refuse('ACCOUNT_BANNED', "This account is banned, so it can't be approved.", 409, {
          partnerId: row.id,
        });
      }
      if (row.idDocumentExpiresOn && row.idDocumentType) {
        const expiresOn = isoDateOf(row.idDocumentExpiresOn);
        if (expiryVerdict(expiresOn, today).kind === 'expired') {
          throw refuse(
            'ID_EXPIRED',
            `${firstNameOf(row.name)}'s ${DOCUMENT_NOUN[row.idDocumentType]} expired on ${longDate(expiresOn)}. Send the application back to ask for a new one.`,
            422,
            { expiredOn: expiresOn, documentType: row.idDocumentType },
          );
        }
      }
      for (const image of ['photo', 'idFront'] as const) {
        const status = image === 'photo' ? row.photoStatus : row.idDocumentStatus;
        if (status !== 'READY') {
          throw refuse(
            'IMAGE_NOT_READY',
            status === 'PENDING'
              ? `${firstNameOf(row.name)}'s new ${image === 'photo' ? 'photo' : 'ID photo'} is still being checked. Try again in a minute.`
              : `The ${image === 'photo' ? 'photo' : 'ID photo'} is missing from storage. Send the application back to ask for a new one.`,
            409,
            { image, kind: status === 'PENDING' ? 'checking' : 'missing' },
          );
        }
      }
      if (flags.length > 0 && !input.flagsChecked) {
        const message = 'Check this box to approve an application with flags.';
        throw new AppError('FLAGS_NOT_CHECKED', message, 422, {
          fieldErrors: { flagsChecked: [message] },
          details: { flags },
        });
      }
      return;
    }
    case 'sendBack':
      if (row.status !== 'APPLIED') throw invalid();
      if (waiting && row.changesRequestedAt) {
        throw refuse(
          'ALREADY_SENT_BACK',
          `This application was already sent back. It's waiting for ${firstNameOf(row.name)}.`,
          409,
          {
            partnerId: row.id,
            sentBackAt: row.changesRequestedAt.toISOString(),
          },
        );
      }
      return;
    case 'reject':
      if (row.status !== 'APPLIED') throw invalid();
      return;
    case 'suspend':
      if (row.status !== 'APPROVED') throw invalid();
      if (row.banned) {
        throw refuse(
          'ACCOUNT_BANNED',
          'This account is banned. Bans are managed on the account, not here.',
          409,
          { partnerId: row.id },
        );
      }
      if (row.isDemo) {
        throw refuse(
          'DEMO_PARTNER',
          "The demo partner can't be suspended. It resets every night.",
          409,
          { partnerId: row.id },
        );
      }
      return;
    case 'reinstate':
      if (role !== 'admin') throw forbidden('Only an admin can reinstate a partner.');
      if (row.status !== 'SUSPENDED') throw invalid();
      if (row.banned) {
        throw refuse(
          'ACCOUNT_BANNED',
          'This account is banned. Bans are managed on the account, not here.',
          409,
          { partnerId: row.id },
        );
      }
      return;
    default:
      if (role !== 'admin') throw forbidden('Only an admin can reopen an application.');
      if (row.status !== 'REJECTED') throw invalid();
      if (row.filesDeletedAt || (row.reapplyAfter && isoDateOf(row.reapplyAfter) <= today)) {
        const deletedOn = row.filesDeletedAt ? isoDateOf(row.filesDeletedAt) : today;
        throw refuse(
          'FILES_DELETED',
          `${firstNameOf(row.name)}'s photos and ID details were deleted on ${longDate(deletedOn)}, so this can't be reopened. ${firstNameOf(row.name)} can apply again from the account.`,
          409,
          { deletedOn },
        );
      }
  }
}

function writeFor(
  decision: Decision,
  actor: UserActor,
  row: DirectoryRow,
  input: DecisionInput,
  now: Date,
  today: string,
): DecisionWrite {
  const version = row.version + 1;
  switch (decision) {
    case 'approve':
      return {
        status: 'APPROVED',
        version,
        approvedAt: now,
        decidedAt: now,
        decidedBy: actor.userId,
        changesRequestedAt: null,
        changesRequestedNote: null,
        changesRequestedBy: null,
      };
    case 'sendBack':
      return {
        status: 'APPLIED',
        version,
        changesRequestedAt: now,
        changesRequestedNote: input.applicantText ?? null,
        changesRequestedBy: actor.userId,
      };
    case 'reject':
      return {
        status: 'REJECTED',
        version,
        decidedAt: now,
        decidedBy: actor.userId,
        decisionReason: input.applicantText ?? null,
        reapplyAfter: new Date(`${reapplyDate(today)}T00:00:00Z`),
        changesRequestedAt: null,
        changesRequestedNote: null,
        changesRequestedBy: null,
      };
    case 'suspend':
      return {
        status: 'SUSPENDED',
        version,
        decidedAt: now,
        decidedBy: actor.userId,
        suspendedAt: now,
        suspensionReason: input.applicantText ?? null,
        offline: { reason: 'suspended', at: now },
      };
    case 'reinstate':
      return {
        status: 'APPROVED',
        version,
        decidedAt: now,
        decidedBy: actor.userId,
        suspendedAt: null,
        suspensionReason: null,
      };
    default:
      return {
        status: 'APPLIED',
        version,
        decidedAt: null,
        decidedBy: null,
        decisionReason: null,
        reapplyAfter: null,
      };
  }
}

async function decide(
  decision: Decision,
  actor: UserActor,
  permission: Permission,
  input: DecisionInput,
  now = new Date(),
): Promise<DecisionResult> {
  const role = await requireReviewer(actor, permission, true);
  const { today } = await storeTime(now);
  const actorName = (await runAs(actor, (ctx) => findStaffName(ctx, actor.userId))) ?? 'Staff';

  // Checks that need nothing locked, so a refusal never holds the row: version, state, rules.
  const peek = await runAs(actor, async (ctx) => {
    const row = await findDirectoryRow(ctx, input.partnerId);
    if (!row) return null;
    return {
      row,
      history: await findHistory(ctx, input.partnerId),
      matches: await findFlagMatches(ctx, row),
    };
  });
  if (!peek) throw await goneOrNotFound(actor, input.partnerId);
  if (peek.row.userId === actor.userId)
    throw forbidden("You can't decide on your own application.");
  const replay = replayed(decision, actor, peek.row, peek.history, now);
  if (replay) return replay;
  if (peek.row.version !== input.expectedVersion) {
    throw changedError(peek.row, lastChangeOf(peek.history, input.expectedVersion));
  }
  const flags = flagsOf(peek.row, peek.matches, peek.history, today).map((flag) => flag.kind);
  checkDecision(decision, role, peek.row, flags, input, today);
  if (decision === 'approve') {
    const [photo, id] = await Promise.all(
      [peek.row.photoKey, peek.row.idDocumentKey].map((key) =>
        key ? objectSize('PRIVATE', key) : Promise.resolve(0),
      ),
    );
    if (photo === null || id === null) {
      throw refuse(
        'IMAGE_NOT_READY',
        'An image is missing from storage. Send the application back to ask for a new one.',
        409,
        { image: photo === null ? 'photo' : 'idFront', kind: 'missing' },
      );
    }
  }
  // Recorded in the audit only when a code was actually checked (security gate S5).
  let codeChecked = false;
  if (NEEDS_STEP_UP.has(decision) && !(await stepUpFresh(actor, now))) {
    if (input.stepUp === undefined || input.stepUp === null) throw stepUpRequired('partner');
    await passStepUp(actor, input.stepUp, now, 'partner');
    codeChecked = true;
  }

  const outcome = await runAs(actor, async (ctx) => {
    if (!(await lockPartner(ctx, input.partnerId))) throw notFoundError();
    const row = await findDirectoryRow(ctx, input.partnerId);
    if (!row) throw notFoundError();
    if (row.version !== input.expectedVersion) {
      throw changedError(
        row,
        lastChangeOf(await findHistory(ctx, input.partnerId), input.expectedVersion),
      );
    }
    checkDecision(decision, role, row, flags, input, today);
    const write = writeFor(decision, actor, row, input, now, today);
    await writeDecision(ctx, row.id, write);
    if (decision === 'approve') await promoteToPartner(ctx, row.id);
    const eventId = uuidv7();
    const staff = { kind: 'staff' as const, id: actor.userId, name: actorName, role };
    await insertHistory(ctx, {
      id: eventId,
      partnerId: row.id,
      type: HISTORY_OF[decision],
      actor: staff,
      at: now,
      applicantText: input.applicantText ?? null,
      staffNote: input.staffNote ?? null,
      versionAfter: write.version,
    });
    const wasOnline = decision === 'suspend' ? row.isOnline : null;
    if (decision === 'suspend' && row.isOnline) {
      await insertHistory(ctx, {
        id: uuidv7(),
        partnerId: row.id,
        type: 'taken-offline',
        actor: staff,
        at: now,
        versionAfter: write.version,
      });
    }
    await audit(ctx, {
      action: `partner.${HISTORY_OF[decision] === 'sent-back' ? 'sent-back' : HISTORY_OF[decision]}`,
      targetType: 'partner',
      targetId: row.id,
      data: {
        version: input.expectedVersion,
        ...(input.applicantText !== undefined && { reason: input.applicantText }),
        ...(input.staffNote !== undefined && { staffNote: input.staffNote }),
        ...(decision === 'approve' && { flags }),
        ...(wasOnline !== null && { wasOnline }),
        ...(codeChecked && { stepUp: true }),
      },
    });
    const next = ['approve', 'sendBack', 'reject'].includes(decision)
      ? await findNextToReview(ctx, row.id)
      : null;
    return { row, eventId, version: write.version, wasOnline, next };
  });

  await runPartnerEffects(
    effectsOf(decision, outcome.row, outcome.eventId, outcome.wasOnline, now),
  );
  // A25 (F7): an open offer is withdrawn and an order held before pickup goes back to dispatch.
  if (decision === 'suspend') await partnerLeaving(outcome.row.id, 'suspended');
  await alerts(decision, actor);
  return {
    partnerId: outcome.row.id,
    status: STATUS_AFTER[decision],
    version: outcome.version,
    at: now.toISOString(),
    eventId: outcome.eventId,
    next: outcome.next,
    wasOnline: outcome.wasOnline,
    replayed: false,
  };
}

/** A23.5, A24.9: the same decision by the same person within 60 s answers the same result. */
function replayed(
  decision: Decision,
  actor: UserActor,
  row: DirectoryRow,
  history: HistoryRow[],
  now: Date,
): DecisionResult | null {
  const last = history.at(-1);
  const own = history.findLast((entry) => entry.type === HISTORY_OF[decision]);
  if (
    !own ||
    own.actorId !== actor.userId ||
    now.getTime() - own.at.getTime() > DECISION_REPLAY_MS ||
    row.status !== STATUS_AFTER[decision] ||
    (last && last.id !== own.id && last.type !== 'taken-offline')
  ) {
    return null;
  }
  return {
    partnerId: row.id,
    status: row.status,
    version: row.version,
    at: own.at.toISOString(),
    eventId: own.id,
    next: null,
    wasOnline: null,
    replayed: true,
  };
}

function effectsOf(
  decision: Decision,
  row: DirectoryRow,
  eventId: string,
  wasOnline: boolean | null,
  now: Date,
): PartnerEffect[] {
  const user = row.userId;
  switch (decision) {
    case 'approve':
      return [
        { kind: 'notify', userId: user, notice: PARTNER_NOTICES.approved },
        { kind: 'email', partnerId: row.id, eventId, email: 'approved' },
        { kind: 'endSessions', userId: user },
        { kind: 'approved', partnerId: row.id, at: now },
      ];
    case 'sendBack':
      return [
        { kind: 'notify', userId: user, notice: PARTNER_NOTICES.sentBack },
        { kind: 'email', partnerId: row.id, eventId, email: 'sent-back' },
      ];
    case 'reject':
      return [
        { kind: 'notify', userId: user, notice: PARTNER_NOTICES.rejected },
        { kind: 'email', partnerId: row.id, eventId, email: 'rejected' },
      ];
    case 'suspend':
      return [
        { kind: 'deletePoint', partnerId: row.id },
        { kind: 'status', partnerId: row.id, status: 'SUSPENDED', at: now },
        ...(wasOnline
          ? [
              {
                kind: 'availability' as const,
                partnerId: row.id,
                online: false,
                reason: 'suspended' as const,
                changeId: uuidv7(),
                at: now,
              },
            ]
          : []),
        { kind: 'notify', userId: user, notice: PARTNER_NOTICES.suspended },
        { kind: 'email', partnerId: row.id, eventId, email: 'suspended' },
        { kind: 'endSessions', userId: user },
        { kind: 'suspended', partnerId: row.id, wasOnline: Boolean(wasOnline), at: now },
        ...(wasOnline
          ? [{ kind: 'offline' as const, partnerId: row.id, reason: 'suspended' as const, at: now }]
          : []),
      ];
    case 'reinstate':
      return [
        { kind: 'status', partnerId: row.id, status: 'APPROVED', at: now },
        { kind: 'notify', userId: user, notice: PARTNER_NOTICES.reinstated },
        { kind: 'email', partnerId: row.id, eventId, email: 'reinstated' },
      ];
    default:
      return [
        { kind: 'notify', userId: user, notice: PARTNER_NOTICES.reopened },
        { kind: 'email', partnerId: row.id, eventId, email: 'reopened' },
      ];
  }
}

/** A25.6, A31.4. */
async function alerts(decision: Decision, actor: UserActor) {
  if (decision === 'suspend') {
    const count = await countHourly('partner-suspensions', actor.userId);
    if (count === SUSPEND_ALERT_AT) {
      logger.error(
        { actorId: actor.userId, alert: 'partner-suspensions' },
        'many partners suspended',
      );
    }
  }
  if (decision === 'approve') {
    const count = await countHourly('partner-approvals', actor.userId);
    if (count === APPROVE_ALERT_ABOVE + 1) {
      logger.error({ actorId: actor.userId, alert: 'partner-approvals' }, 'many partners approved');
    }
  }
}

export async function approvePartner(
  actor: UserActor,
  input: z.output<typeof approveInput>,
): Promise<DecisionResult> {
  return decide('approve', actor, READ, {
    partnerId: input.partnerId,
    expectedVersion: input.expectedVersion,
    flagsChecked: input.flagsChecked,
    staffNote: input.staffNote,
    stepUp: input.stepUp,
  });
}

export async function sendBackPartner(
  actor: UserActor,
  input: z.output<typeof sendBackInput>,
): Promise<DecisionResult> {
  return decide('sendBack', actor, READ, {
    partnerId: input.partnerId,
    expectedVersion: input.expectedVersion,
    applicantText: input.message,
    staffNote: input.staffNote,
  });
}

export async function rejectPartner(
  actor: UserActor,
  input: z.output<typeof rejectInput>,
): Promise<DecisionResult> {
  return decide('reject', actor, READ, {
    partnerId: input.partnerId,
    expectedVersion: input.expectedVersion,
    applicantText: input.reason,
    staffNote: input.staffNote,
  });
}

export async function suspendPartner(
  actor: UserActor,
  input: z.output<typeof suspendInput>,
): Promise<DecisionResult> {
  return decide(
    'suspend',
    actor,
    { partner: ['suspend'] },
    {
      partnerId: input.partnerId,
      expectedVersion: input.expectedVersion,
      applicantText: input.reason,
      staffNote: input.staffNote,
      stepUp: input.stepUp,
    },
  );
}

export async function reinstatePartner(
  actor: UserActor,
  input: z.output<typeof reinstateInput>,
): Promise<DecisionResult> {
  return decide(
    'reinstate',
    actor,
    { partner: ['reinstate'] },
    {
      partnerId: input.partnerId,
      expectedVersion: input.expectedVersion,
      staffNote: input.staffNote,
      stepUp: input.stepUp,
    },
  );
}

export async function reopenPartner(
  actor: UserActor,
  input: z.output<typeof reopenInput>,
): Promise<DecisionResult> {
  return decide(
    'reopen',
    actor,
    { partner: ['reinstate'] },
    {
      partnerId: input.partnerId,
      expectedVersion: input.expectedVersion,
      staffNote: input.staffNote,
    },
  );
}
