import 'server-only';
import { db } from '@/server/db/client';
import type { DbContext } from '@/server/db/context';
import type { PartnerStatus, UploadStatus, VehicleType } from '@/server/db/enums';
import { Prisma } from '@/server/db/generated/client';
import type { ChangedPart, IdDocumentType } from './rules';
import type { HistoryType, PartnerListQuery, PartnerTab } from './review-schema';
import type { OfflineReason } from './text';

/*
 * Partner applications, the partner's online state and the review history (F6). The applicant
 * and partner read and write their own row as themselves; staff read through the masked
 * directory views and decide as themselves. Row-level security and the
 * delivery_partners_guard_write trigger check every write again.
 */

// ------------------------------------------------------------------ the partner's own row

const OWN_COLUMNS = {
  id: true,
  userId: true,
  status: true,
  vehicleType: true,
  vehiclePlate: true,
  idDocumentType: true,
  idDocumentExpiresOn: true,
  idNumberLast4: true,
  idNumberHash: true,
  photoUploadId: true,
  idDocumentUploadId: true,
  isOnline: true,
  lastSeenAt: true,
  ratingAvg: true,
  ratingCount: true,
  approvedAt: true,
  submittedAt: true,
  editedAt: true,
  fixedAt: true,
  decidedAt: true,
  decisionReason: true,
  changesRequestedAt: true,
  changesRequestedNote: true,
  reapplyAfter: true,
  filesDeletedAt: true,
  suspendedAt: true,
  suspensionReason: true,
  onlineSince: true,
  onlineSessionId: true,
  offlineReason: true,
  offlineAt: true,
  partnerTermsVersion: true,
  partnerTermsAcceptedAt: true,
  adultConfirmedAt: true,
  welcomedAt: true,
  version: true,
  createdAt: true,
} as const satisfies Prisma.DeliveryPartnerSelect;

export type OwnPartnerRow = Prisma.DeliveryPartnerGetPayload<{ select: typeof OWN_COLUMNS }>;

export function findPartnerByUser(ctx: DbContext, userId: string): Promise<OwnPartnerRow | null> {
  return db(ctx).deliveryPartner.findUnique({ where: { userId }, select: OWN_COLUMNS });
}

export function findPartnerById(ctx: DbContext, id: string): Promise<OwnPartnerRow | null> {
  return db(ctx).deliveryPartner.findUnique({ where: { id }, select: OWN_COLUMNS });
}

/** Locks the row for the rest of the transaction; false when the caller can't see it. */
export async function lockPartner(ctx: DbContext, id: string): Promise<boolean> {
  const rows = await db(ctx).$queryRaw<{ id: string }[]>`
    SELECT id::text FROM delivery_partners WHERE id = ${id}::uuid FOR UPDATE`;
  return rows.length > 0;
}

export async function lockPartnerOfUser(ctx: DbContext, userId: string): Promise<string | null> {
  const rows = await db(ctx).$queryRaw<{ id: string }[]>`
    SELECT id::text FROM delivery_partners WHERE user_id = ${userId}::uuid FOR UPDATE`;
  return rows[0]?.id ?? null;
}

/** The application as sent (P5.4). Every field is named; nothing is spread from input. */
export interface ApplicationWrite {
  vehicleType: VehicleType;
  vehiclePlate: string | null;
  licenseNumberEnc: string;
  idNumberHash: string;
  idNumberLast4: string;
  idDocumentType: IdDocumentType;
  idDocumentExpiresOn: Date;
  photoUploadId: string;
  idDocumentUploadId: string;
}

export async function insertApplication(
  ctx: DbContext,
  row: ApplicationWrite & {
    id: string;
    userId: string;
    submittedAt: Date;
    partnerTermsVersion: number;
    partnerTermsAcceptedAt: Date;
    adultConfirmedAt: Date;
  },
) {
  await db(ctx).deliveryPartner.create({
    data: {
      id: row.id,
      userId: row.userId,
      status: 'APPLIED',
      vehicleType: row.vehicleType,
      vehiclePlate: row.vehiclePlate,
      licenseNumberEnc: row.licenseNumberEnc,
      idNumberHash: row.idNumberHash,
      idNumberLast4: row.idNumberLast4,
      idDocumentType: row.idDocumentType,
      idDocumentExpiresOn: row.idDocumentExpiresOn,
      photoUploadId: row.photoUploadId,
      idDocumentUploadId: row.idDocumentUploadId,
      submittedAt: row.submittedAt,
      partnerTermsVersion: row.partnerTermsVersion,
      partnerTermsAcceptedAt: row.partnerTermsAcceptedAt,
      adultConfirmedAt: row.adultConfirmedAt,
      version: 1,
    },
    select: { id: true },
  });
}

/** Sending again from the reapply date: the same row, a fresh application (P7.6). */
export async function reapply(
  ctx: DbContext,
  id: string,
  row: ApplicationWrite & {
    submittedAt: Date;
    partnerTermsVersion: number;
    partnerTermsAcceptedAt: Date;
    adultConfirmedAt: Date;
    version: number;
  },
) {
  await db(ctx).deliveryPartner.update({
    where: { id },
    data: {
      status: 'APPLIED',
      vehicleType: row.vehicleType,
      vehiclePlate: row.vehiclePlate,
      licenseNumberEnc: row.licenseNumberEnc,
      idNumberHash: row.idNumberHash,
      idNumberLast4: row.idNumberLast4,
      idDocumentType: row.idDocumentType,
      idDocumentExpiresOn: row.idDocumentExpiresOn,
      photoUploadId: row.photoUploadId,
      idDocumentUploadId: row.idDocumentUploadId,
      submittedAt: row.submittedAt,
      editedAt: null,
      fixedAt: null,
      decidedAt: null,
      decidedBy: null,
      decisionReason: null,
      reapplyAfter: null,
      changesRequestedAt: null,
      changesRequestedNote: null,
      changesRequestedBy: null,
      filesDeletedAt: null,
      partnerTermsVersion: row.partnerTermsVersion,
      partnerTermsAcceptedAt: row.partnerTermsAcceptedAt,
      adultConfirmedAt: row.adultConfirmedAt,
      version: row.version,
    },
    select: { id: true },
  });
}

/** An edit or a fix while waiting (P6.3, P6.5): only the named fields change. */
export async function editApplication(
  ctx: DbContext,
  id: string,
  change: {
    vehicleType: VehicleType;
    vehiclePlate: string | null;
    idDocumentType: IdDocumentType;
    idDocumentExpiresOn: Date;
    photoUploadId: string;
    idDocumentUploadId: string;
    number: { licenseNumberEnc: string; idNumberHash: string; idNumberLast4: string } | null;
    editedAt: Date;
    fixedAt: Date | null;
    version: number;
  },
) {
  await db(ctx).deliveryPartner.update({
    where: { id },
    data: {
      vehicleType: change.vehicleType,
      vehiclePlate: change.vehiclePlate,
      idDocumentType: change.idDocumentType,
      idDocumentExpiresOn: change.idDocumentExpiresOn,
      photoUploadId: change.photoUploadId,
      idDocumentUploadId: change.idDocumentUploadId,
      ...(change.number && {
        licenseNumberEnc: change.number.licenseNumberEnc,
        idNumberHash: change.number.idNumberHash,
        idNumberLast4: change.number.idNumberLast4,
      }),
      editedAt: change.editedAt,
      ...(change.fixedAt && { fixedAt: change.fixedAt }),
      version: change.version,
    },
    select: { id: true },
  });
}

export async function deleteApplication(ctx: DbContext, id: string) {
  await db(ctx).deliveryPartner.delete({ where: { id }, select: { id: true } });
}

export async function markWelcomed(ctx: DbContext, id: string, at: Date) {
  await db(ctx).deliveryPartner.update({
    where: { id },
    data: { welcomedAt: at },
    select: { id: true },
  });
}

// ------------------------------------------------------------------ decisions

/** One decision's columns (§3.1). Only what the decision sets is passed. */
export interface DecisionWrite {
  status: PartnerStatus;
  version: number;
  approvedAt?: Date;
  decidedAt?: Date | null;
  decidedBy?: string | null;
  decisionReason?: string | null;
  reapplyAfter?: Date | null;
  changesRequestedAt?: Date | null;
  changesRequestedNote?: string | null;
  changesRequestedBy?: string | null;
  fixedAt?: Date | null;
  suspendedAt?: Date | null;
  suspensionReason?: string | null;
  /** Suspension takes the partner offline in the same statement. */
  offline?: { reason: OfflineReason; at: Date };
}

export async function writeDecision(ctx: DbContext, id: string, change: DecisionWrite) {
  // Offline first, while the row is still APPROVED (only an approved partner is ever online).
  if (change.offline) {
    await db(ctx).$executeRaw`
      UPDATE delivery_partners
      SET is_online = false, online_since = NULL, online_session_id = NULL, last_location = NULL,
          offline_reason = ${change.offline.reason}, offline_at = ${change.offline.at}
      WHERE id = ${id}::uuid AND is_online`;
  }
  await db(ctx).deliveryPartner.update({
    where: { id },
    data: {
      status: change.status,
      version: change.version,
      ...('approvedAt' in change && { approvedAt: change.approvedAt }),
      ...('decidedAt' in change && { decidedAt: change.decidedAt }),
      ...('decidedBy' in change && { decidedBy: change.decidedBy }),
      ...('decisionReason' in change && { decisionReason: change.decisionReason }),
      ...('reapplyAfter' in change && { reapplyAfter: change.reapplyAfter }),
      ...('changesRequestedAt' in change && { changesRequestedAt: change.changesRequestedAt }),
      ...('changesRequestedNote' in change && {
        changesRequestedNote: change.changesRequestedNote,
      }),
      ...('changesRequestedBy' in change && { changesRequestedBy: change.changesRequestedBy }),
      ...('fixedAt' in change && { fixedAt: change.fixedAt }),
      ...('suspendedAt' in change && { suspendedAt: change.suspendedAt }),
      ...('suspensionReason' in change && { suspensionReason: change.suspensionReason }),
    },
    select: { id: true },
  });
}

/** Approving makes the applicant a partner in the same transaction (B6). */
export async function promoteToPartner(ctx: DbContext, partnerId: string): Promise<boolean> {
  const rows = await db(ctx).$queryRaw<{ promoted: boolean }[]>`
    SELECT app_set_partner_role(${partnerId}::uuid) AS promoted`;
  return rows[0]?.promoted ?? false;
}

// ------------------------------------------------------------------ history

export interface HistoryWrite {
  id: string;
  partnerId: string;
  type: HistoryType;
  actor:
    | { kind: 'staff'; id: string; name: string; role: string }
    | { kind: 'applicant'; id: string }
    | { kind: 'system' };
  at: Date;
  applicantText?: string | null;
  staffNote?: string | null;
  changedParts?: ChangedPart[];
  versionAfter: number;
}

/**
 * Appends one history row. No RETURNING: the applicant may add their own entries but never read
 * the history back (row-level security), so the insert can't ask for the row.
 */
export async function insertHistory(ctx: DbContext, entry: HistoryWrite) {
  await db(ctx).partnerApplicationEvent.createMany({
    data: {
      id: entry.id,
      partnerId: entry.partnerId,
      type: entry.type,
      actorKind: entry.actor.kind,
      actorId: entry.actor.kind === 'system' ? null : entry.actor.id,
      actorName: entry.actor.kind === 'staff' ? entry.actor.name : null,
      actorRole: entry.actor.kind === 'staff' ? entry.actor.role : null,
      at: entry.at,
      applicantText: entry.applicantText ?? null,
      staffNote: entry.staffNote ?? null,
      changedParts: entry.changedParts ?? [],
      versionAfter: entry.versionAfter,
    },
  });
}

export interface HistoryRow {
  id: string;
  type: HistoryType;
  actorKind: 'staff' | 'applicant' | 'system';
  actorId: string | null;
  actorName: string | null;
  actorRole: string | null;
  at: Date;
  applicantText: string | null;
  staffNote: string | null;
  changedParts: ChangedPart[];
  versionAfter: number | null;
  masked: boolean;
}

/** For staff, through the masked view (A31.1), oldest first. */
export function findHistory(ctx: DbContext, partnerId: string): Promise<HistoryRow[]> {
  return db(ctx).$queryRaw<HistoryRow[]>`
    SELECT id::text AS "id", type, actor_kind AS "actorKind", actor_id::text AS "actorId",
           actor_name AS "actorName", actor_role AS "actorRole", at,
           applicant_text AS "applicantText", staff_note AS "staffNote",
           changed_parts AS "changedParts", version_after AS "versionAfter", masked
    FROM partner_event_directory
    WHERE partner_id = ${partnerId}::uuid
    ORDER BY at, id`;
}

/** The latest history row of a type, read by the applicant's own service as the platform. */
export function findLatestHistory(ctx: DbContext, partnerId: string, types: HistoryType[]) {
  return db(ctx).partnerApplicationEvent.findFirst({
    where: { partnerId, type: { in: types } },
    orderBy: [{ at: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      type: true,
      actorName: true,
      actorRole: true,
      at: true,
      applicantText: true,
      staffNote: true,
    },
  });
}

export function findHistoryEntry(ctx: DbContext, id: string) {
  return db(ctx).partnerApplicationEvent.findUnique({
    where: { id },
    select: { id: true, partnerId: true, type: true, at: true, applicantText: true },
  });
}

// ------------------------------------------------------------------ accounts and uploads

export function findAccount(ctx: DbContext, userId: string) {
  return db(ctx).user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      emailVerified: true,
      phone: true,
      role: true,
      isDemo: true,
      banned: true,
      createdAt: true,
    },
  });
}

/** A staff member's own name, for the history snapshot. */
export async function findStaffName(ctx: DbContext, userId: string): Promise<string | null> {
  const user = await db(ctx).user.findUnique({ where: { id: userId }, select: { name: true } });
  return user?.name ?? null;
}

export async function setAccountPhone(ctx: DbContext, userId: string, phone: string) {
  await db(ctx).user.update({ where: { id: userId }, data: { phone }, select: { id: true } });
}

export interface UploadRow {
  id: string;
  ownerId: string;
  purpose: string;
  status: UploadStatus;
  bucket: string;
  key: string;
}

export function findUploads(ctx: DbContext, ids: string[]): Promise<UploadRow[]> {
  return db(ctx).upload.findMany({
    where: { id: { in: ids } },
    select: { id: true, ownerId: true, purpose: true, status: true, bucket: true, key: true },
  });
}

export async function deleteUploadRows(ctx: DbContext, ids: string[]) {
  if (ids.length === 0) return;
  await db(ctx).upload.deleteMany({ where: { id: { in: ids } } });
}

/** Partner uploads chosen but never sent, older than `before` (P15.6). */
export function findUnattachedUploads(ctx: DbContext, before: Date): Promise<UploadRow[]> {
  return db(ctx).upload.findMany({
    where: {
      purpose: { in: ['PARTNER_PHOTO', 'PARTNER_DOCUMENT'] },
      createdAt: { lt: before },
      partnerPhotos: { none: {} },
      partnerDocuments: { none: {} },
    },
    select: { id: true, ownerId: true, purpose: true, status: true, bucket: true, key: true },
    take: 500,
  });
}

/** Ends every session of an account (B6, P14.1): the next request is signed out. */
export async function deleteSessions(ctx: DbContext, userId: string) {
  await db(ctx).session.deleteMany({ where: { userId } });
}

/** The published Partner Terms version (U6). */
export async function findPartnerTermsVersion(ctx: DbContext): Promise<number | null> {
  const page = await db(ctx).contentPage.findUnique({
    where: { slug: 'partner-terms' },
    select: { publishedVersion: { select: { version: true } } },
  });
  return page?.publishedVersion?.version ?? null;
}

export function findKitchenPoint(ctx: DbContext) {
  return db(ctx).siteSettings.findUnique({
    where: { id: 1 },
    select: { lat: true, lng: true, deliveryRadiusKm: true },
  });
}

/** The `APPLICATION_GONE` tombstone (§3.2): the last withdrawal of this partner id. */
export function findWithdrawal(ctx: DbContext, partnerId: string, since: Date) {
  return db(ctx).auditLog.findFirst({
    where: {
      action: 'partner.withdrawn',
      targetType: 'partner',
      targetId: partnerId,
      createdAt: { gte: since },
    },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true, data: true },
  });
}

// ------------------------------------------------------------------ online state

export interface OnlineRow {
  id: string;
  userId: string;
  status: PartnerStatus;
  isOnline: boolean;
  onlineSince: Date | null;
  onlineSessionId: string | null;
  offlineReason: string | null;
  offlineAt: Date | null;
  suspendedAt: Date | null;
  isDemo: boolean;
}

export async function findOnlineState(ctx: DbContext, userId: string): Promise<OnlineRow | null> {
  const rows = await db(ctx).$queryRaw<OnlineRow[]>`
    SELECT p.id::text AS "id", p.user_id::text AS "userId", p.status::text AS "status",
           p.is_online AS "isOnline", p.online_since AS "onlineSince",
           p.online_session_id::text AS "onlineSessionId", p.offline_reason AS "offlineReason",
           p.offline_at AS "offlineAt", p.suspended_at AS "suspendedAt", u.is_demo AS "isDemo"
    FROM delivery_partners p JOIN users u ON u.id = p.user_id
    WHERE p.user_id = ${userId}::uuid`;
  return rows[0] ?? null;
}

export async function goOnline(
  ctx: DbContext,
  id: string,
  change: {
    sessionId: string | null;
    since: Date;
    point: { lat: number; lng: number };
    seenAt: Date;
  },
) {
  await db(ctx).$executeRaw`
    UPDATE delivery_partners
    SET is_online = true, online_since = ${change.since},
        online_session_id = ${change.sessionId}::uuid,
        offline_reason = NULL, offline_at = NULL,
        last_location = ST_SetSRID(ST_MakePoint(${change.point.lng}, ${change.point.lat}), 4326)::geography,
        last_seen_at = ${change.seenAt}, updated_at = now()
    WHERE id = ${id}::uuid AND status = 'APPROVED'`;
}

/** Another session takes over while online (P9.11). */
export async function takeOverSession(ctx: DbContext, id: string, sessionId: string) {
  await db(ctx).$executeRaw`
    UPDATE delivery_partners SET online_session_id = ${sessionId}::uuid, updated_at = now()
    WHERE id = ${id}::uuid AND is_online`;
}

export async function writeLastLocation(
  ctx: DbContext,
  id: string,
  point: { lat: number; lng: number },
  seenAt: Date,
) {
  await db(ctx).$executeRaw`
    UPDATE delivery_partners
    SET last_location = ST_SetSRID(ST_MakePoint(${point.lng}, ${point.lat}), 4326)::geography,
        last_seen_at = ${seenAt}, updated_at = now()
    WHERE id = ${id}::uuid AND is_online`;
}

/** B11: true when this call took the partner offline (false when already offline). */
export async function goOffline(
  ctx: DbContext,
  id: string,
  reason: OfflineReason,
  at: Date,
): Promise<boolean> {
  const changed = await db(ctx).$executeRaw`
    UPDATE delivery_partners
    SET is_online = false, online_since = NULL, online_session_id = NULL, last_location = NULL,
        offline_reason = ${reason}, offline_at = ${at}, last_seen_at = coalesce(last_seen_at, ${at}),
        updated_at = now()
    WHERE id = ${id}::uuid AND is_online`;
  return changed > 0;
}

export function listOnlinePartners(ctx: DbContext) {
  return db(ctx).$queryRaw<
    { id: string; userId: string; onlineSince: Date; isDemo: boolean; holdsOrder: boolean }[]
  >`
    SELECT p.id::text AS "id", p.user_id::text AS "userId", p.online_since AS "onlineSince",
           u.is_demo AS "isDemo",
           EXISTS (SELECT 1 FROM deliveries d WHERE d.partner_id = p.id
                   AND d.status IN ('ASSIGNED', 'AT_RESTAURANT', 'PICKED_UP')) AS "holdsOrder"
    FROM delivery_partners p JOIN users u ON u.id = p.user_id
    WHERE p.is_online`;
}

// ------------------------------------------------------------------ files and retention

export function listRejectedDueForDeletion(ctx: DbContext, today: Date) {
  return db(ctx).deliveryPartner.findMany({
    where: { status: 'REJECTED', filesDeletedAt: null, reapplyAfter: { lte: today } },
    select: { id: true, photoUploadId: true, idDocumentUploadId: true, version: true },
    take: 200,
  });
}

export async function clearFiles(ctx: DbContext, id: string, at: Date) {
  await db(ctx).deliveryPartner.update({
    where: { id },
    data: {
      photoUploadId: null,
      idDocumentUploadId: null,
      licenseNumberEnc: null,
      idNumberHash: null,
      idNumberLast4: null,
      vehiclePlate: null,
      filesDeletedAt: at,
    },
    select: { id: true },
  });
}

// ------------------------------------------------------------------ the staff directory

export interface DirectoryRow {
  id: string;
  userId: string;
  status: PartnerStatus;
  name: string;
  email: string;
  phone: string | null;
  banned: boolean;
  banReason: string | null;
  isDemo: boolean;
  isSample: boolean;
  customerSince: Date;
  orderCount: number;
  vehicleType: VehicleType;
  vehiclePlate: string | null;
  plateKey: string | null;
  idNumberHash: string | null;
  idDocumentType: IdDocumentType | null;
  idNumberLast4: string | null;
  idDocumentExpiresOn: Date | null;
  photoUploadId: string | null;
  photoKey: string | null;
  photoStatus: UploadStatus | null;
  idDocumentUploadId: string | null;
  idDocumentKey: string | null;
  idDocumentStatus: UploadStatus | null;
  submittedAt: Date | null;
  editedAt: Date | null;
  fixedAt: Date | null;
  decidedAt: Date | null;
  decidedBy: string | null;
  decisionReason: string | null;
  changesRequestedAt: Date | null;
  changesRequestedNote: string | null;
  changesRequestedBy: string | null;
  reapplyAfter: Date | null;
  filesDeletedAt: Date | null;
  suspendedAt: Date | null;
  suspensionReason: string | null;
  approvedAt: Date | null;
  isOnline: boolean;
  onlineSince: Date | null;
  offlineReason: string | null;
  offlineAt: Date | null;
  lastSeenAt: Date | null;
  partnerTermsVersion: number | null;
  partnerTermsAcceptedAt: Date | null;
  adultConfirmedAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  masked: boolean;
  /** Names from the latest decision rows, through the masked history view. */
  sentBackByName: string | null;
  decidedByName: string | null;
  decidedByRole: string | null;
  /** The latest decision event's type. */
  lastDecision: string | null;
  /** Flags in the list (A22.6): computed on every read, both directions. */
  plateShared: boolean;
  idShared: boolean;
  appliedBefore: boolean;
}

const DIRECTORY_COLUMNS = Prisma.sql`
  d.id::text AS "id", d.user_id::text AS "userId", d.status::text AS "status", d.name, d.email,
  d.phone, d.banned, d.ban_reason AS "banReason", d.is_demo AS "isDemo", d.is_sample AS "isSample",
  d.customer_since AS "customerSince", d.order_count AS "orderCount",
  d.vehicle_type::text AS "vehicleType", d.vehicle_plate AS "vehiclePlate", d.plate_key AS "plateKey",
  d.id_number_hash AS "idNumberHash", d.id_document_type::text AS "idDocumentType",
  d.id_number_last4 AS "idNumberLast4", d.id_document_expires_on AS "idDocumentExpiresOn",
  d.photo_upload_id::text AS "photoUploadId", d.photo_key AS "photoKey",
  d.photo_status::text AS "photoStatus", d.id_document_upload_id::text AS "idDocumentUploadId",
  d.id_document_key AS "idDocumentKey", d.id_document_status::text AS "idDocumentStatus",
  d.submitted_at AS "submittedAt", d.edited_at AS "editedAt", d.fixed_at AS "fixedAt",
  d.decided_at AS "decidedAt", d.decided_by::text AS "decidedBy",
  d.decision_reason AS "decisionReason", d.changes_requested_at AS "changesRequestedAt",
  d.changes_requested_note AS "changesRequestedNote",
  d.changes_requested_by::text AS "changesRequestedBy", d.reapply_after AS "reapplyAfter",
  d.files_deleted_at AS "filesDeletedAt", d.suspended_at AS "suspendedAt",
  d.suspension_reason AS "suspensionReason", d.approved_at AS "approvedAt",
  d.is_online AS "isOnline", d.online_since AS "onlineSince", d.offline_reason AS "offlineReason",
  d.offline_at AS "offlineAt", d.last_seen_at AS "lastSeenAt",
  d.partner_terms_version AS "partnerTermsVersion",
  d.partner_terms_accepted_at AS "partnerTermsAcceptedAt",
  d.adult_confirmed_at AS "adultConfirmedAt", d.version, d.created_at AS "createdAt",
  d.updated_at AS "updatedAt", d.masked,
  sb.actor_name AS "sentBackByName", dec.actor_name AS "decidedByName",
  dec.actor_role AS "decidedByRole", dec.type AS "lastDecision",
  EXISTS (SELECT 1 FROM app_partner_flag_matches(d.id) f WHERE f.same_plate) AS "plateShared",
  EXISTS (SELECT 1 FROM app_partner_flag_matches(d.id) f WHERE f.same_id) AS "idShared",
  (d.status = 'APPLIED'
    AND (SELECT count(*) FROM partner_event_directory e WHERE e.partner_id = d.id AND e.type = 'applied') > 1
    AND EXISTS (SELECT 1 FROM partner_event_directory e WHERE e.partner_id = d.id AND e.type = 'rejected')
  ) AS "appliedBefore"`;

const DIRECTORY_FROM = Prisma.sql`
  FROM partner_directory d
  LEFT JOIN LATERAL (
    SELECT e.actor_name FROM partner_event_directory e
    WHERE e.partner_id = d.id AND e.type = 'sent-back' ORDER BY e.at DESC LIMIT 1
  ) sb ON true
  LEFT JOIN LATERAL (
    SELECT e.actor_name, e.actor_role, e.type FROM partner_event_directory e
    WHERE e.partner_id = d.id AND e.type IN ('approved', 'rejected', 'suspended', 'reinstated', 'reopened')
    ORDER BY e.at DESC LIMIT 1
  ) dec ON true`;

/** Sent back and not fixed since (A19.1), in SQL. */
const WAITING = Prisma.sql`(d.status = 'APPLIED' AND d.changes_requested_at IS NOT NULL
  AND (d.fixed_at IS NULL OR d.fixed_at < d.changes_requested_at))`;

function tabCondition(tab: PartnerTab): Prisma.Sql {
  switch (tab) {
    case 'review':
      return Prisma.sql`(d.status = 'APPLIED' AND NOT ${WAITING})`;
    case 'waiting':
      return WAITING;
    case 'approved':
      return Prisma.sql`d.status = 'APPROVED'`;
    case 'suspended':
      return Prisma.sql`d.status = 'SUSPENDED'`;
    case 'rejected':
      return Prisma.sql`d.status = 'REJECTED'`;
    default:
      return Prisma.sql`true`;
  }
}

/** Shares a plate or an ID number with another row, or expires within 30 days (A22.6). */
function flaggedCondition(today: Date): Prisma.Sql {
  return Prisma.sql`(
    EXISTS (SELECT 1 FROM app_partner_flag_matches(d.id))
    OR (d.status = 'APPLIED' AND d.id_document_expires_on IS NOT NULL AND d.id_document_expires_on <= ${today}::date + 30)
  )`;
}

function sortColumn(query: PartnerListQuery): Prisma.Sql {
  const dir = query.dir === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
  switch (query.sort) {
    case 'name':
      return Prisma.sql`lower(d.name) ${dir}, d.id`;
    case 'sent':
      return Prisma.sql`d.submitted_at ${dir} NULLS LAST, d.id`;
    case 'decided':
      return Prisma.sql`coalesce(d.suspended_at, d.decided_at, d.approved_at) ${dir} NULLS LAST, d.id`;
    default:
      return Prisma.sql`d.updated_at ${dir}, d.id`;
  }
}

function filters(query: PartnerListQuery, today: Date): Prisma.Sql {
  const parts: Prisma.Sql[] = [tabCondition(query.tab)];
  if (query.vehicle) parts.push(Prisma.sql`d.vehicle_type = ${query.vehicle}::"VehicleType"`);
  if (query.flags) parts.push(flaggedCondition(today));
  if (query.q) {
    const like = `%${query.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const plate = query.q.toUpperCase().replace(/[\s-]/g, '');
    parts.push(
      Prisma.sql`(d.name ILIKE ${like} OR d.email ILIKE ${like}
        OR (NOT d.masked AND ${plate} <> '' AND d.plate_key LIKE ${`%${plate.replace(/[\\%_]/g, (c) => `\\${c}`)}%`}))`,
    );
  }
  return Prisma.join(parts, ' AND ');
}

export async function listDirectory(
  ctx: DbContext,
  query: PartnerListQuery,
  page: { offset: number; limit: number },
  today: Date,
): Promise<{ rows: DirectoryRow[]; total: number }> {
  const where = filters(query, today);
  const [count] = await db(ctx).$queryRaw<{ total: number }[]>`
    SELECT count(*)::int AS total FROM partner_directory d WHERE ${where}`;
  const rows = await db(ctx).$queryRaw<DirectoryRow[]>`
    SELECT ${DIRECTORY_COLUMNS} ${DIRECTORY_FROM}
    WHERE ${where}
    ORDER BY ${sortColumn(query)}
    LIMIT ${page.limit} OFFSET ${page.offset}`;
  return { rows, total: count?.total ?? 0 };
}

/** Every application in each state, whatever the filters (A19.1). */
export async function countTabs(ctx: DbContext): Promise<Record<PartnerTab, number>> {
  const [row] = await db(ctx).$queryRaw<Record<PartnerTab, number>[]>`
    SELECT
      count(*) FILTER (WHERE ${tabCondition('review')})::int AS "review",
      count(*) FILTER (WHERE ${tabCondition('waiting')})::int AS "waiting",
      count(*) FILTER (WHERE d.status = 'APPROVED')::int AS "approved",
      count(*) FILTER (WHERE d.status = 'SUSPENDED')::int AS "suspended",
      count(*) FILTER (WHERE d.status = 'REJECTED')::int AS "rejected",
      count(*)::int AS "all"
    FROM partner_directory d`;
  return row ?? { review: 0, waiting: 0, approved: 0, suspended: 0, rejected: 0, all: 0 };
}

export async function countToReview(ctx: DbContext): Promise<number> {
  const [row] = await db(ctx).$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM partner_directory d WHERE ${tabCondition('review')}`;
  return row?.n ?? 0;
}

export async function findDirectoryRow(ctx: DbContext, id: string): Promise<DirectoryRow | null> {
  const rows = await db(ctx).$queryRaw<DirectoryRow[]>`
    SELECT ${DIRECTORY_COLUMNS} ${DIRECTORY_FROM} WHERE d.id = ${id}::uuid`;
  return rows[0] ?? null;
}

/** The oldest application left to review, after a decision (A23.3). */
export async function findNextToReview(ctx: DbContext, exceptId: string) {
  const rows = await db(ctx).$queryRaw<{ partnerId: string; name: string }[]>`
    SELECT d.id::text AS "partnerId", d.name FROM partner_directory d
    WHERE ${tabCondition('review')} AND d.id <> ${exceptId}::uuid
    ORDER BY d.submitted_at NULLS LAST, d.id LIMIT 1`;
  return rows[0] ?? null;
}

export interface FlagMatch {
  id: string;
  name: string;
  status: PartnerStatus;
  banned: boolean;
  decidedAt: Date | null;
  masked: boolean;
  samePlate: boolean;
  sameIdNumber: boolean;
}

/**
 * Other applications with the same plate or ID number (A22.1, A22.2), both directions. The
 * database compares the keys (`app_partner_flag_matches`); only ids and the kind of match come
 * back, so a masked row's plate can't be probed (security gate S1).
 */
export function findFlagMatches(ctx: DbContext, self: { id: string }): Promise<FlagMatch[]> {
  return db(ctx).$queryRaw<FlagMatch[]>`
    SELECT d.id::text AS "id", d.name, d.status::text AS "status", d.banned,
           coalesce(d.suspended_at, d.decided_at, d.approved_at) AS "decidedAt", d.masked,
           f.same_plate AS "samePlate", f.same_id AS "sameIdNumber"
    FROM app_partner_flag_matches(${self.id}::uuid) f
    JOIN partner_directory d ON d.id = f.id
    ORDER BY d.submitted_at`;
}
