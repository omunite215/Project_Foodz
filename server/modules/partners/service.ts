import 'server-only';
import { todayLineIn } from '@/server/modules/earnings/service';
import { partnerRatingLineIn } from '@/server/modules/ratings/service';
import { v7 as uuidv7 } from 'uuid';
import type { z } from 'zod';
import { displayPhone } from '@/lib/phone';
import { can, isStaff } from '@/server/auth/roles';
import { getSession, type UserActor } from '@/server/auth/session';
import type { Actor, DbContext } from '@/server/db/context';
import { runAs, runAsSystem } from '@/server/db/context';
import { AppError, forbidden, invalidInput, notFound } from '@/server/errors';
import { logger } from '@/server/logger';
import type { PartnerExport } from '@/server/modules/account/schema';
import { audit } from '@/server/modules/audit/service';
import { pointAccepted } from '@/server/modules/tracking/service';
import {
  activeDeliveryOf,
  giveBackCurrent,
  partnerDispatchState,
  partnerLeaving,
} from '@/server/modules/delivery/service';
import { lastClosing, openState } from '@/server/modules/menu/hours';
import type { OpeningHours } from '@/server/modules/menu/schema';
import { getStoreStatus } from '@/server/modules/menu/service';
import { clockAt } from '@/server/modules/orders/text';
import { encryptField } from '@/server/security/field-encryption';
import { idNumberHash } from '@/server/security/keyed-hash';
import { checkTurnstile, turnstileError } from '@/server/security/turnstile';
import { letterEmail, sendEmail } from '@/server/notifications/email';
import { presignDownload } from '@/server/storage/s3';
import { deleteUploads, runPartnerEffects } from './effects';
import {
  type AcceptedPoint,
  autoOfflineReason,
  DEMO_POINT,
  freshnessOf,
  judgeBatch,
  pointClocks,
  lastLocationWriteDue,
  type LocationPoint,
  pointRefusal,
  type PointRefusal,
} from './location';
import { countJumps, readPoint, readPoints, type StoredPoint, writePoint } from './location-store';
import { offlineNoticeText, PARTNER_NOTICES, partnerEmail, type PartnerEmailKind } from './notices';
import {
  deleteApplication,
  editApplication,
  findAccount,
  findHistoryEntry,
  findPartnerById,
  findKitchenPoint,
  findOnlineState,
  findPartnerByUser,
  findPartnerTermsVersion,
  findUnattachedUploads,
  findUploads,
  goOffline,
  goOnline,
  insertApplication,
  insertHistory,
  listOnlinePartners,
  listRejectedDueForDeletion,
  lockPartnerOfUser,
  markWelcomed as writeWelcomed,
  type OnlineRow,
  type OwnPartnerRow,
  reapply,
  setAccountPhone,
  takeOverSession,
  writeLastLocation,
  clearFiles,
} from './repo';
import { isWaitingForApplicant } from './review-state';
import { type ApplicationFacts, changedParts, expiryVerdict, idLast4, mayReapply } from './rules';
import type {
  ApplicationSummary,
  Availability,
  AvailabilityResult,
  LocationsResult,
  OwnImage,
  PartnerKitchen,
  PartnerState,
  SubmitResult,
  UpdateResult,
} from './schema';
import {
  availabilityInput,
  idExpiredError,
  locationsInput,
  PARTNER_FIELD_ERRORS,
  submitApplicationInput,
  updateApplicationInput,
} from './schema';
import {
  documentLine,
  kitchenOfflineLine,
  kitchenOnlineLine,
  maskedEmail,
  type NoticedOfflineReason,
  offlineNotice,
  type OfflineReason,
  storeDate,
  vehicleLine,
  VEHICLE_WORDS,
  DOCUMENT_WORDS,
} from './text';

/*
 * The partner's own side (F6). Every function re-checks what the action wrapper or route
 * checked (role, demo) and writes as the caller through `runAs`, so row-level security and the
 * `delivery_partners` guard trigger apply as a second layer. Effects (notifications, emails,
 * realtime, jobs) run after commit.
 */

const LINK_SECONDS = 300;
const REPLAY_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const NOTICED = new Set<string>([
  'no-location',
  'kitchen-closed',
  'other-device',
  'demo-other-visitor',
  'missed-offers',
]);
const isNoticed = (reason: string | null): reason is NoticedOfflineReason =>
  reason !== null && NOTICED.has(reason);

const numberContext = (partnerId: string) => `delivery_partners.license_number:${partnerId}`;
const dateOf = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const isoDateOf = (date: Date) => date.toISOString().slice(0, 10);

// ------------------------------------------------------------------ refusals

const refuse = (
  code: AppError['code'],
  message: string,
  status: number,
  details?: Record<string, unknown>,
) => new AppError(code, message, status, details ? { details } : {});

export const notACustomer = () =>
  refuse(
    'NOT_A_CUSTOMER',
    "Staff accounts can't apply to deliver. Apply with a personal account instead.",
    403,
  );
const notApproved = () =>
  refuse('NOT_APPROVED', 'Your partner account is not approved to deliver.', 403);
const suspendedError = (since: Date | null) =>
  refuse('PARTNER_SUSPENDED', 'Your partner account has been suspended.', 403, {
    since: since?.toISOString() ?? null,
  });
const applicationNotFound = () => new AppError('NOT_FOUND', 'Application not found.', 404);
const decided = (status: string) =>
  refuse(
    'APPLICATION_DECIDED',
    'Your application was just reviewed. See the decision below.',
    409,
    {
      status,
    },
  );

/** The application moved on since the form opened: another tab or phone saved it first. */
const changedElsewhere = (status: string, version: number) =>
  refuse(
    'APPLICATION_CHANGED',
    'Your application was changed on another tab or phone. Open it again to see the latest version.',
    409,
    { how: 'edited', current: { status, version } },
  );

const POINT_MESSAGES: Record<PointRefusal, string> = {
  LOW_ACCURACY:
    'Your phone is sharing an approximate location. Turn on Precise Location, then try again.',
  FUTURE_POINT: "Your phone's clock is ahead. Check its date and time, then try again.",
  STALE_POINT: "We couldn't use that location because it's too old. Try again.",
  IMPLAUSIBLE_JUMP: "We couldn't use that location. Try again.",
};

function applicantGuard(actor: UserActor) {
  if (isStaff(actor.role)) throw notACustomer();
  if (!can(actor.role, { partner: ['apply'] })) throw forbidden();
}

// ------------------------------------------------------------------ shared reads

async function storeFacts(now: Date) {
  const store = await getStoreStatus(now);
  const hours = Object.fromEntries(
    store.weeklyHours.flatMap((day) => (day.hours ? [[day.weekday, day.hours]] : [])),
  ) as OpeningHours;
  return { store, hours, timeZone: store.timeZone, today: storeDate(now, store.timeZone) };
}

async function ownImage(uploadId: string | null, ownerId: string): Promise<OwnImage | null> {
  if (!uploadId) return null;
  const [upload] = await runAsSystem('own image', (ctx) => findUploads(ctx, [uploadId]));
  if (!upload || upload.ownerId !== ownerId || upload.status !== 'READY') {
    return { uploadId, url: null, expiresAt: null };
  }
  return {
    uploadId,
    url: await presignDownload('PRIVATE', upload.key, LINK_SECONDS),
    expiresAt: new Date(Date.now() + LINK_SECONDS * 1000).toISOString(),
  };
}

function phoneOf(e164: string | null) {
  if (!e164) return null;
  const { country, display } = displayPhone(e164);
  return {
    e164,
    display,
    country,
    masked: `${display.slice(0, Math.max(0, display.length - 4))}…`,
  };
}

async function summaryOf(
  row: OwnPartnerRow,
  account: { phone: string | null },
): Promise<ApplicationSummary> {
  const type = row.idDocumentType ?? 'DRIVER_LICENSE';
  const expiresOn = row.idDocumentExpiresOn ? isoDateOf(row.idDocumentExpiresOn) : '';
  const last4 = row.idNumberLast4 ?? '';
  const phone = phoneOf(account.phone);
  return {
    version: row.version,
    submittedAt: (row.submittedAt ?? row.createdAt).toISOString(),
    updatedAt: row.editedAt?.toISOString() ?? null,
    vehicleType: row.vehicleType,
    plate: row.vehiclePlate,
    vehicleWords: vehicleLine(row.vehicleType, row.vehiclePlate),
    idDocumentType: type,
    idLast4: last4,
    idExpiresOn: expiresOn,
    documentWords: expiresOn ? documentLine(type, last4, expiresOn) : DOCUMENT_WORDS[type],
    photo: (await ownImage(row.photoUploadId, row.userId)) ?? {
      uploadId: '',
      url: null,
      expiresAt: null,
    },
    idPhoto: (await ownImage(row.idDocumentUploadId, row.userId)) ?? {
      uploadId: '',
      url: null,
      expiresAt: null,
    },
    phone: phone && { e164: phone.e164, display: phone.display, masked: phone.masked },
    terms: {
      version: row.partnerTermsVersion ?? 1,
      acceptedAt: (row.partnerTermsAcceptedAt ?? row.createdAt).toISOString(),
      adultConfirmedAt: (row.adultConfirmedAt ?? row.createdAt).toISOString(),
    },
  };
}

function availabilityOf(
  row: { isOnline: boolean; onlineSince: Date | null; onlineSessionId: string | null },
  point: StoredPoint | null,
  sessionId: string | null,
  isDemo: boolean,
  now: Date,
): Availability {
  const lastPointAt = row.isOnline ? (point?.acceptedAt ?? null) : null;
  return {
    online: row.isOnline,
    onlineSince: row.onlineSince?.toISOString() ?? null,
    lastPointAt,
    freshness: freshnessOf({ isOnline: row.isOnline, lastPointAt }, now),
    onThisDevice:
      row.isOnline && (isDemo || (sessionId !== null && row.onlineSessionId === sessionId)),
  };
}

async function currentSessionId(actor: UserActor): Promise<string | null> {
  const session = await getSession();
  return session && session.user.id === actor.userId ? session.session.id : null;
}

// ------------------------------------------------------------------ what /partner shows

/** The server render of `/partner` and `GET /api/v1/partner/me`: one DTO per state (B3). */
export async function getMyPartnerState(
  actor: Actor,
  options: { sessionId?: string | null; now?: Date } = {},
): Promise<PartnerState | null> {
  if (actor.kind !== 'user') return null;
  const now = options.now ?? new Date();
  const { account, row } = await runAs(actor, async (ctx) => ({
    account: await findAccount(ctx, actor.userId),
    row: await findPartnerByUser(ctx, actor.userId),
  }));
  if (!account) return null;
  const email = { masked: maskedEmail(account.email), full: account.email };

  if (isStaff(actor.role)) return { screen: 'gate', gate: 'staff', email: null };
  if (!row) {
    if (actor.isDemo) return { screen: 'gate', gate: 'demoCustomer', email: null };
    if (!account.emailVerified) return { screen: 'gate', gate: 'emailNotConfirmed', email };
    return applyState(account, 'new');
  }

  const { today, timeZone, store, hours } = await storeFacts(now);
  switch (row.status) {
    case 'APPLIED': {
      const application = await summaryOf(row, account);
      if (isWaitingForApplicant(row) && row.changesRequestedAt) {
        return {
          screen: 'sentBack',
          application,
          email,
          sentBack: {
            at: row.changesRequestedAt.toISOString(),
            message: row.changesRequestedNote ?? '',
          },
        };
      }
      return { screen: 'pending', application, email };
    }
    case 'REJECTED': {
      const reapplyFrom = row.reapplyAfter ? isoDateOf(row.reapplyAfter) : today;
      return {
        screen: 'rejected',
        decidedAt: (row.decidedAt ?? row.createdAt).toISOString(),
        reason: row.decisionReason,
        reapplyFrom,
        canReapply: mayReapply(reapplyFrom, today),
        filesDeleteOn: row.filesDeletedAt ? null : reapplyFrom,
        filesDeletedAt: row.filesDeletedAt?.toISOString() ?? null,
      };
    }
    case 'SUSPENDED':
      return {
        screen: 'suspended',
        since: (row.suspendedAt ?? row.decidedAt ?? row.createdAt).toISOString(),
        reason: row.suspensionReason,
      };
    default:
      break;
  }

  const firstName = account.name.split(/\s+/)[0] ?? account.name;
  if (!row.welcomedAt) return { screen: 'welcome', firstName, isDemo: actor.isDemo };

  const sessionId =
    options.sessionId === undefined ? await currentSessionId(actor) : options.sessionId;
  const point = row.isOnline ? await readPoint(row.id) : null;
  const kitchen = await kitchenOf(store, timeZone);
  let lastOffline: Extract<PartnerState, { screen: 'home' }>['lastOffline'] = null;
  const reason = row.offlineReason;
  if (!row.isOnline && row.offlineAt && isNoticed(reason)) {
    const kitchenClosed = reason === 'kitchen-closed';
    const closed = kitchenClosed ? lastClosing(hours, timeZone, row.offlineAt) : null;
    const opensAt = kitchenClosed ? openState(hours, timeZone, row.offlineAt).opensAt : null;
    lastOffline = {
      reason,
      at: row.offlineAt.toISOString(),
      ...offlineNotice(reason, row.offlineAt.toISOString(), timeZone, closed?.at ?? null, opensAt),
    };
  }
  // F9: his rating as of the end of yesterday (V8) and today's line (P51.3).
  const { rating, todayLine } = await runAs(actor, async (ctx) => ({
    rating: actor.isDemo
      ? row.ratingCount > 0
        ? { average: row.ratingAvg, count: row.ratingCount }
        : null
      : await partnerRatingLineIn(ctx, now),
    todayLine: await todayLineIn(ctx, row.id, actor.isDemo),
  }));
  return {
    screen: 'home',
    today: todayLine,
    partner: {
      id: row.id,
      name: account.name,
      firstName,
      vehicleWords: vehicleLine(row.vehicleType, row.vehiclePlate),
      photo: await ownImage(row.photoUploadId, row.userId),
      rating,
      partnerSince: (row.approvedAt ?? row.createdAt).toISOString(),
      isDemo: actor.isDemo,
    },
    availability: availabilityOf(row, point, sessionId, actor.isDemo, now),
    lastOffline,
    kitchen,
    demoPoint: actor.isDemo ? DEMO_POINT : null,
    dispatch: await partnerDispatchState(row.id, now),
  };
}

/**
 * The storefront account menu's partner entry (P6.7, contract 8): "Partner app" for approved and
 * suspended partners, "Partner application" for applicants, nothing for everyone else. One read.
 */
export async function partnerMenuEntry(actor: Actor): Promise<'app' | 'application' | null> {
  if (actor.kind !== 'user' || isStaff(actor.role)) return null;
  if (actor.role === 'partner') return 'app';
  const row = await runAs(actor, (ctx) => findPartnerByUser(ctx, actor.userId));
  if (!row) return null;
  return row.status === 'APPROVED' || row.status === 'SUSPENDED' ? 'app' : 'application';
}

async function applyState(
  account: { name: string; phone: string | null },
  mode: 'new' | 'reapply',
): Promise<PartnerState> {
  const phone = phoneOf(account.phone);
  return {
    screen: 'apply',
    mode,
    name: account.name,
    firstName: account.name.split(/\s+/)[0] ?? account.name,
    phone: phone && { e164: phone.e164, display: phone.display, country: phone.country },
    termsVersion: (await runAsSystem('partner terms', findPartnerTermsVersion)) ?? 1,
  };
}

async function kitchenOf(
  store: Awaited<ReturnType<typeof getStoreStatus>>,
  timeZone: string,
): Promise<PartnerKitchen> {
  const point = await runAsSystem('kitchen point', findKitchenPoint);
  return {
    isOpen: store.isOpen,
    offlineLine: kitchenOfflineLine(store),
    onlineLine: kitchenOnlineLine(store),
    point: { lat: point?.lat ?? DEMO_POINT.lat, lng: point?.lng ?? DEMO_POINT.lng },
    radiusKm: point?.deliveryRadiusKm ?? store.delivery.radiusKm,
    timeZone,
  };
}

// ------------------------------------------------------------------ applying (P5)

export type SubmitParsed = z.output<typeof submitApplicationInput>;
export type UpdateParsed = z.output<typeof updateApplicationInput>;

async function checkUploads(
  ctx: DbContext,
  actor: UserActor,
  wanted: { field: 'photoUploadId' | 'idDocumentUploadId'; id: string; purpose: string }[],
) {
  if (wanted.length === 0) return;
  const found = await findUploads(
    ctx,
    wanted.map((item) => item.id),
  );
  for (const item of wanted) {
    const upload = found.find((row) => row.id === item.id);
    if (
      !upload ||
      upload.ownerId !== actor.userId ||
      upload.purpose !== item.purpose ||
      upload.status !== 'READY'
    ) {
      throw new AppError('UPLOAD_NOT_READY', PARTNER_FIELD_ERRORS.uploadUnavailable, 422, {
        fieldErrors: { [item.field]: [PARTNER_FIELD_ERRORS.uploadUnavailable] },
        details: { field: item.field },
      });
    }
  }
}

function checkExpiry(
  input: { idExpiresOn: string; idDocumentType: 'DRIVER_LICENSE' | 'STATE_ID' | 'PASSPORT' },
  today: string,
) {
  if (expiryVerdict(input.idExpiresOn, today).kind === 'expired') {
    const message = idExpiredError(input.idDocumentType);
    throw invalidInput(message, { idExpiresOn: [message] });
  }
}

function submitResult(row: OwnPartnerRow, replayed: boolean): SubmitResult {
  return {
    partnerId: row.id,
    version: row.version,
    submittedAt: (row.submittedAt ?? row.createdAt).toISOString(),
    replayed,
  };
}

const replayOf = (row: OwnPartnerRow | null, now: Date) =>
  row?.status === 'APPLIED' &&
  row.submittedAt !== null &&
  now.getTime() - row.submittedAt.getTime() < REPLAY_MS &&
  row.editedAt === null;

/**
 * P5.4: the gates, a replay inside 60 s, Turnstile, an existing application or a rejection
 * before its date, the uploads, the expiry and the Terms version, then one transaction.
 */
export async function submitApplication(
  actor: UserActor,
  parsed: SubmitParsed,
  request: { ip: string },
  now = new Date(),
): Promise<SubmitResult> {
  applicantGuard(actor);
  if (actor.isDemo) {
    throw new AppError(
      'DEMO_READ_ONLY',
      "The demo account can't apply. Sign in as the demo partner to see the partner app.",
      403,
    );
  }

  const { account, row } = await runAs(actor, async (ctx) => ({
    account: await findAccount(ctx, actor.userId),
    row: await findPartnerByUser(ctx, actor.userId),
  }));
  if (!account) throw notFound('That account');
  if (!account.emailVerified) {
    throw refuse('EMAIL_NOT_CONFIRMED', 'Confirm your email first.', 403, {
      email: maskedEmail(account.email),
    });
  }
  if (row && replayOf(row, now)) return submitResult(row, true);

  const captcha = await checkTurnstile(parsed.turnstileToken, {
    ip: request.ip,
    action: 'partner-apply',
  });
  if (captcha !== 'passed') throw turnstileError(captcha);

  const { today } = await storeFacts(now);
  if (row) {
    if (row.status !== 'REJECTED') {
      throw refuse('APPLICATION_EXISTS', 'You already have an application.', 409, {
        status: row.status,
      });
    }
    const reapplyFrom = row.reapplyAfter ? isoDateOf(row.reapplyAfter) : today;
    if (!mayReapply(reapplyFrom, today)) {
      throw refuse('REAPPLY_LATER', `You can apply again from ${reapplyFrom}.`, 409, {
        reapplyFrom,
      });
    }
  }
  checkExpiry(parsed, today);
  const terms = (await runAsSystem('partner terms', findPartnerTermsVersion)) ?? 1;
  if (parsed.termsVersion !== terms) {
    const message = 'The Partner Terms changed. Read them again and agree to continue.';
    throw invalidInput(message, { agreeTerms: [message] });
  }

  let outcome: { partnerId: string; eventId: string; version: number };
  try {
    outcome = await runAs(actor, async (ctx) => {
      await checkUploads(ctx, actor, [
        { field: 'photoUploadId', id: parsed.photoUploadId, purpose: 'PARTNER_PHOTO' },
        { field: 'idDocumentUploadId', id: parsed.idDocumentUploadId, purpose: 'PARTNER_DOCUMENT' },
      ]);
      const existing = await lockPartnerOfUser(ctx, actor.userId);
      const current = existing ? await findPartnerByUser(ctx, actor.userId) : null;
      if (current && current.status !== 'REJECTED') {
        throw refuse('APPLICATION_EXISTS', 'You already have an application.', 409, {
          status: current.status,
        });
      }
      const partnerId = current?.id ?? uuidv7();
      const write = {
        vehicleType: parsed.vehicleType,
        vehiclePlate: parsed.plate,
        licenseNumberEnc: encryptField(parsed.idNumber, numberContext(partnerId)),
        idNumberHash: idNumberHash(parsed.idNumber),
        idNumberLast4: idLast4(parsed.idNumber),
        idDocumentType: parsed.idDocumentType,
        idDocumentExpiresOn: dateOf(parsed.idExpiresOn),
        photoUploadId: parsed.photoUploadId,
        idDocumentUploadId: parsed.idDocumentUploadId,
        submittedAt: now,
        partnerTermsVersion: terms,
        partnerTermsAcceptedAt: now,
        adultConfirmedAt: now,
      };
      const version = current ? current.version + 1 : 1;
      if (current) await reapply(ctx, partnerId, { ...write, version });
      else await insertApplication(ctx, { ...write, id: partnerId, userId: actor.userId });
      if (parsed.phone && parsed.phone !== account.phone) {
        await setAccountPhone(ctx, actor.userId, parsed.phone);
      }
      const eventId = uuidv7();
      await insertHistory(ctx, {
        id: eventId,
        partnerId,
        type: 'applied',
        actor: { kind: 'applicant', id: actor.userId },
        at: now,
        versionAfter: version,
      });
      await audit(ctx, {
        action: 'partner.applied',
        targetType: 'partner',
        targetId: partnerId,
        data: {
          vehicle: parsed.vehicleType,
          documentType: parsed.idDocumentType,
          last4: idLast4(parsed.idNumber),
          reapply: Boolean(current),
        },
      });
      return { partnerId, eventId, version };
    });
  } catch (error) {
    // Two presses at once: the second insert meets the first's row.
    const again = await runAs(actor, (ctx) => findPartnerByUser(ctx, actor.userId));
    if (again && replayOf(again, new Date()) && !(error instanceof AppError))
      return submitResult(again, true);
    throw error;
  }

  await runPartnerEffects([
    { kind: 'notify', userId: actor.userId, notice: PARTNER_NOTICES.received },
    { kind: 'email', partnerId: outcome.partnerId, eventId: outcome.eventId, email: 'received' },
  ]);
  return {
    partnerId: outcome.partnerId,
    version: outcome.version,
    submittedAt: now.toISOString(),
    replayed: false,
  };
}

function factsOf(row: OwnPartnerRow, phone: string | null): ApplicationFacts {
  return {
    photoUploadId: row.photoUploadId,
    phone,
    vehicleType: row.vehicleType,
    plate: row.vehiclePlate,
    idDocumentType: row.idDocumentType ?? 'DRIVER_LICENSE',
    idNumberHash: row.idNumberHash,
    idExpiresOn: row.idDocumentExpiresOn ? isoDateOf(row.idDocumentExpiresOn) : '',
    idDocumentUploadId: row.idDocumentUploadId,
  };
}

/** P6.3, P6.5: keeps the queue place; replaced files are deleted after commit. */
export async function updateApplication(
  actor: UserActor,
  parsed: UpdateParsed,
  now = new Date(),
): Promise<UpdateResult> {
  applicantGuard(actor);
  const { today } = await storeFacts(now);
  checkExpiry(parsed, today);

  const outcome = await runAs(actor, async (ctx) => {
    const id = await lockPartnerOfUser(ctx, actor.userId);
    const row = id ? await findPartnerByUser(ctx, actor.userId) : null;
    if (!row) throw applicationNotFound();
    if (row.status !== 'APPLIED') throw decided(row.status);
    // The save carries the version the form was opened at (P6.3). A send-back that landed in
    // between is a decision the applicant has to read, so it is never marked fixed unseen.
    if (row.version !== parsed.expectedVersion) {
      if (isWaitingForApplicant(row)) throw decided(row.status);
      throw changedElsewhere(row.status, row.version);
    }
    const account = await findAccount(ctx, actor.userId);
    await checkUploads(
      ctx,
      actor,
      [
        {
          field: 'photoUploadId' as const,
          id: parsed.photoUploadId,
          purpose: 'PARTNER_PHOTO',
          old: row.photoUploadId,
        },
        {
          field: 'idDocumentUploadId' as const,
          id: parsed.idDocumentUploadId,
          purpose: 'PARTNER_DOCUMENT',
          old: row.idDocumentUploadId,
        },
      ].filter((item) => item.id !== item.old),
    );
    const number = parsed.idNumber
      ? {
          licenseNumberEnc: encryptField(parsed.idNumber, numberContext(row.id)),
          idNumberHash: idNumberHash(parsed.idNumber),
          idNumberLast4: idLast4(parsed.idNumber),
        }
      : null;
    const before = factsOf(row, account?.phone ?? null);
    const after: ApplicationFacts = {
      photoUploadId: parsed.photoUploadId,
      phone: parsed.phone,
      vehicleType: parsed.vehicleType,
      plate: parsed.plate,
      idDocumentType: parsed.idDocumentType,
      idNumberHash: number?.idNumberHash ?? row.idNumberHash,
      idExpiresOn: parsed.idExpiresOn,
      idDocumentUploadId: parsed.idDocumentUploadId,
    };
    const parts = changedParts(before, after);
    const waiting = isWaitingForApplicant(row);
    if (parts.length === 0 && !waiting) {
      return {
        version: row.version,
        updatedAt: (row.editedAt ?? now).toISOString(),
        fixed: false,
        replaced: [],
      };
    }
    const version = row.version + 1;
    await editApplication(ctx, row.id, {
      vehicleType: parsed.vehicleType,
      vehiclePlate: parsed.plate,
      idDocumentType: parsed.idDocumentType,
      idDocumentExpiresOn: dateOf(parsed.idExpiresOn),
      photoUploadId: parsed.photoUploadId,
      idDocumentUploadId: parsed.idDocumentUploadId,
      number,
      editedAt: now,
      fixedAt: waiting ? now : null,
      version,
    });
    if (parts.includes('phone') && parsed.phone)
      await setAccountPhone(ctx, actor.userId, parsed.phone);
    await insertHistory(ctx, {
      id: uuidv7(),
      partnerId: row.id,
      type: waiting ? 'fixed' : 'updated',
      actor: { kind: 'applicant', id: actor.userId },
      at: now,
      changedParts: parts,
      versionAfter: version,
    });
    const replaced = [
      row.photoUploadId !== parsed.photoUploadId ? row.photoUploadId : null,
      row.idDocumentUploadId !== parsed.idDocumentUploadId ? row.idDocumentUploadId : null,
    ].filter((value): value is string => value !== null);
    return { version, updatedAt: now.toISOString(), fixed: waiting, replaced };
  });

  if (outcome.replaced.length > 0)
    await runPartnerEffects([{ kind: 'deleteFiles', uploadIds: outcome.replaced }]);
  return { version: outcome.version, updatedAt: outcome.updatedAt, fixed: outcome.fixed };
}

/** P6.4: deletes the row, both images and the number; audit `partner.withdrawn`. */
export async function withdrawApplication(actor: UserActor): Promise<{ withdrawn: true }> {
  applicantGuard(actor);
  const files = await runAs(actor, async (ctx) => {
    const id = await lockPartnerOfUser(ctx, actor.userId);
    const row = id ? await findPartnerByUser(ctx, actor.userId) : null;
    if (!row) throw applicationNotFound();
    if (row.status !== 'APPLIED') throw decided(row.status);
    await deleteApplication(ctx, row.id);
    await audit(ctx, {
      action: 'partner.withdrawn',
      targetType: 'partner',
      targetId: row.id,
      data: { how: 'withdrawn' },
    });
    return [row.photoUploadId, row.idDocumentUploadId].filter(
      (value): value is string => value !== null,
    );
  });
  await runPartnerEffects([{ kind: 'deleteFiles', uploadIds: files }]);
  return { withdrawn: true };
}

/** P7.2: "Go to the app" sets `welcomed_at`. */
export async function markWelcomed(
  actor: UserActor,
  now = new Date(),
): Promise<{ welcomedAt: string }> {
  if (!can(actor.role, { partner: ['deliver'] })) throw notApproved();
  return runAs(actor, async (ctx) => {
    const row = await findPartnerByUser(ctx, actor.userId);
    if (!row || row.status !== 'APPROVED') throw notApproved();
    if (row.welcomedAt) return { welcomedAt: row.welcomedAt.toISOString() };
    await writeWelcomed(ctx, row.id, now);
    return { welcomedAt: now.toISOString() };
  });
}

// ------------------------------------------------------------------ availability (P9 to P12)

async function partnerForAvailability(actor: UserActor): Promise<OnlineRow> {
  if (isStaff(actor.role)) throw notACustomer();
  const row = await runAs(actor, (ctx) => findOnlineState(ctx, actor.userId));
  if (!row) throw notApproved();
  if (row.status === 'SUSPENDED') throw suspendedError(row.suspendedAt);
  if (row.status !== 'APPROVED' || !can(actor.role, { partner: ['deliver'] })) throw notApproved();
  return row;
}

const toAccepted = (point: StoredPoint): AcceptedPoint => ({
  lat: point.lat,
  lng: point.lng,
  accuracy: point.accuracy,
  recordedAt: point.recordedAt,
});

/** `PUT /api/v1/partner/availability` (P9.9, P9.11, P9.12, P12.1). */
export async function setAvailability(
  actor: UserActor,
  sessionId: string | null,
  input: unknown,
  now = new Date(),
): Promise<AvailabilityResult> {
  const body = availabilityInput.parse(input);
  const row = await partnerForAvailability(actor);
  const changeId = uuidv7();

  if (!body.online) {
    // P30.4, U15: going offline while holding an order needs "Give back and go offline"; the
    // page-close request never sends it, so a reload never gives an order away (P29.5).
    const held = row.isDemo ? null : await activeDeliveryOf(row.id);
    if (held) {
      if (!body.giveBack || held.status === 'PICKED_UP') {
        throw refuse(
          'PARTNER_BUSY',
          held.status === 'PICKED_UP'
            ? `You're delivering order ${held.orderNumber}. Finish it before going offline.`
            : `You're on order ${held.orderNumber}. Give it back or finish it before going offline.`,
          409,
          { orderNumber: held.orderNumber },
        );
      }
      await giveBackCurrent(actor, row.id);
    }
    await takePartnerOffline(row.id, row.isDemo ? 'demo-other-visitor' : 'self', { now, changeId });
    return {
      availability: {
        online: false,
        onlineSince: null,
        lastPointAt: null,
        freshness: 'offline',
        onThisDevice: false,
      },
      changeId,
      at: now.toISOString(),
    };
  }

  if (row.isDemo) {
    if (body.point) {
      throw refuse(
        'DEMO_SIMULATED_LOCATION',
        'The demo partner uses a pretend location, never a real one.',
        403,
      );
    }
    const since = row.isOnline && row.onlineSince ? row.onlineSince : now;
    if (!row.isOnline) {
      await runAsSystem('demo partner online', (ctx) =>
        goOnline(ctx, row.id, { sessionId: null, since, point: DEMO_POINT, seenAt: now }),
      );
    }
    const stored: StoredPoint = {
      ...DEMO_POINT,
      accuracy: 10,
      heading: null,
      speed: null,
      recordedAt: now.toISOString(),
      acceptedAt: now.toISOString(),
      writtenAt: now.toISOString(),
    };
    await writePoint(row.id, stored);
    if (!row.isOnline) {
      await runPartnerEffects([
        {
          kind: 'availability',
          partnerId: row.id,
          online: true,
          reason: 'demo-other-visitor',
          changeId,
          at: now,
        },
        { kind: 'online', partnerId: row.id, at: now },
      ]);
    }
    return {
      availability: availabilityOf(
        { isOnline: true, onlineSince: since, onlineSessionId: null },
        stored,
        sessionId,
        true,
        now,
      ),
      changeId,
      at: now.toISOString(),
    };
  }

  if (!body.point) {
    const message = 'Share your location to go online.';
    throw invalidInput(message, { point: [message] });
  }
  const point: LocationPoint = body.point;
  const refusal = pointRefusal(point, now);
  if (refusal) throw refuse(refusal, POINT_MESSAGES[refusal], 422);

  const sameDevice = row.isOnline && row.onlineSessionId === sessionId;
  const takeover = row.isOnline && !sameDevice;
  const since = row.isOnline && row.onlineSince ? row.onlineSince : now;
  await runAs(actor, async (ctx) => {
    if (takeover && sessionId) await takeOverSession(ctx, row.id, sessionId);
    if (!row.isOnline) await goOnline(ctx, row.id, { sessionId, since, point, seenAt: now });
  });
  const stored: StoredPoint = {
    lat: point.lat,
    lng: point.lng,
    accuracy: point.accuracy,
    heading: point.heading,
    speed: point.speed,
    recordedAt: new Date(point.recordedAt).toISOString(),
    acceptedAt: now.toISOString(),
    writtenAt: now.toISOString(),
  };
  await writePoint(row.id, stored);
  if (!sameDevice) {
    await runPartnerEffects([
      {
        kind: 'availability',
        partnerId: row.id,
        online: true,
        reason: takeover ? 'other-device' : 'self',
        changeId,
        at: now,
      },
      ...(row.isOnline ? [] : [{ kind: 'online' as const, partnerId: row.id, at: now }]),
    ]);
  }
  return {
    availability: availabilityOf(
      { isOnline: true, onlineSince: since, onlineSessionId: sessionId },
      stored,
      sessionId,
      false,
      now,
    ),
    changeId,
    at: now.toISOString(),
  };
}

/** `POST /api/v1/partner/locations` (P10.2, P11.2, P16). */
export async function recordLocations(
  actor: UserActor,
  sessionId: string | null,
  input: unknown,
  now = new Date(),
): Promise<LocationsResult> {
  const { points } = locationsInput.parse(input);
  const row = await partnerForAvailability(actor);
  if (row.isDemo) {
    throw refuse(
      'DEMO_SIMULATED_LOCATION',
      'The demo partner uses a pretend location, never a real one.',
      403,
    );
  }
  if (!row.isOnline) {
    throw refuse('NOT_ONLINE', "You're offline.", 403, {
      reason: row.offlineReason,
      at: row.offlineAt?.toISOString() ?? null,
    });
  }
  if (!sessionId || row.onlineSessionId !== sessionId) {
    throw refuse(
      'OTHER_DEVICE',
      'You went online on another device, so sharing stopped here.',
      403,
      {
        since: row.onlineSince?.toISOString() ?? null,
      },
    );
  }

  const stored = await readPoint(row.id);
  const verdict = judgeBatch(points, stored ? toAccepted(stored) : null, now);
  const accepted = verdict.results
    .filter((result) => result.result === 'accepted')
    .map((result) => points[result.index])
    .filter((point): point is LocationPoint => point !== undefined)
    .toSorted((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt));
  const newest = accepted.at(-1);
  let lastPointAt = stored?.acceptedAt ?? null;
  if (newest) {
    const write = lastLocationWriteDue(stored?.writtenAt ?? null, now);
    const clocks = pointClocks(stored, newest, now);
    await writePoint(row.id, {
      lat: newest.lat,
      lng: newest.lng,
      accuracy: newest.accuracy,
      heading: newest.heading,
      speed: newest.speed,
      recordedAt: new Date(newest.recordedAt).toISOString(),
      ...clocks,
      writtenAt: write ? now.toISOString() : (stored?.writtenAt ?? null),
    });
    if (write) await runAs(actor, (ctx) => writeLastLocation(ctx, row.id, newest, now));
    lastPointAt = clocks.acceptedAt;
    // F8 L1.2: history, the stages, the customer's and the map's positions, re-plans.
    try {
      await pointAccepted({
        partnerId: row.id,
        isDemo: row.isDemo,
        point: { lat: newest.lat, lng: newest.lng, heading: newest.heading, speed: newest.speed },
        acceptedAt: now,
      });
    } catch (error) {
      logger.error({ err: error, partnerId: row.id }, 'tracking follow-up failed');
    }
  }
  if (verdict.jumps > 0) {
    const total = await countJumps(row.id, verdict.jumps);
    logger.warn({ partnerId: row.id, jumps: verdict.jumps }, 'implausible location refused');
    if (total >= 10 && total - verdict.jumps < 10) {
      logger.error(
        { partnerId: row.id, alert: 'partner-spoofing' },
        'ten refused location jumps within an hour',
      );
    }
  }
  return { results: verdict.results, lastPointAt, serverTime: now.toISOString() };
}

/**
 * B11: the one way a partner goes offline (self, the cron, another device, a sign-out). Clears
 * the online columns and `last_location`, deletes the Redis point, then publishes
 * `partner.availability-changed` and sends `partner.went-offline`. Idempotent. Suspension writes
 * the same columns in its own transaction and runs the same effects.
 */
export async function takePartnerOffline(
  partnerId: string,
  reason: OfflineReason,
  options: { now?: Date; changeId?: string } = {},
): Promise<{ changed: boolean; at: string }> {
  const now = options.now ?? new Date();
  // W7.1: an open offer goes first, so the run asks the next partner at once.
  await partnerLeaving(partnerId, 'offline');
  const changed = await runAsSystem('partner offline', (ctx) =>
    goOffline(ctx, partnerId, reason, now),
  );
  await runPartnerEffects([
    { kind: 'deletePoint', partnerId },
    ...(changed
      ? [
          {
            kind: 'availability' as const,
            partnerId,
            online: false,
            reason,
            changeId: options.changeId ?? uuidv7(),
            at: now,
          },
          { kind: 'offline' as const, partnerId, reason, at: now },
        ]
      : []),
  ]);
  return { changed, at: now.toISOString() };
}

/** Signing out of the session that shares the location takes the partner offline (B9). */
export async function partnerSignedOut(userId: string, sessionId: string) {
  const row = await runAsSystem('partner sign-out', (ctx) => findOnlineState(ctx, userId));
  if (row?.isOnline && row.onlineSessionId === sessionId) {
    await takePartnerOffline(row.id, 'signed-out');
  }
}

/** B8: the every-minute job. Returns how many partners it took offline, by reason. */
export async function sweepIdlePartners(
  now = new Date(),
): Promise<{ noLocation: number; kitchenClosed: number }> {
  const online = await runAsSystem('partner sweep', listOnlinePartners);
  if (online.length === 0) return { noLocation: 0, kitchenClosed: 0 };
  const points = await readPoints(online.map((partner) => partner.id));
  const { store, hours, timeZone } = await storeFacts(now);
  const closed = store.isOpen ? null : lastClosing(hours, timeZone, now);
  const closedAt = closed?.at ?? null;

  const sweepOne = async (partner: (typeof online)[number]) => {
    // W7.3: a partner holding an order is never taken offline automatically; the staff line
    // turns amber after 10 minutes without a point instead.
    if (partner.holdsOrder) return null;
    let lastPointAt = points.get(partner.id)?.acceptedAt ?? null;
    if (partner.isDemo) {
      // The demo partner's pretend point never goes stale (B12).
      lastPointAt = now.toISOString();
      await writePoint(partner.id, {
        ...DEMO_POINT,
        accuracy: 10,
        heading: null,
        speed: null,
        recordedAt: lastPointAt,
        acceptedAt: lastPointAt,
        writtenAt: lastPointAt,
      });
    }
    const reason = autoOfflineReason(
      { onlineSince: partner.onlineSince.toISOString(), lastPointAt },
      { isOpen: store.isOpen, lastClosedAt: closedAt },
      now,
    );
    if (!reason) return null;
    const { changed } = await takePartnerOffline(partner.id, reason, { now });
    if (!changed) return null;
    const time = clockAt(reason === 'kitchen-closed' && closedAt ? closedAt : now, timeZone);
    await runPartnerEffects([
      {
        kind: 'notify',
        userId: partner.userId,
        notice: offlineNoticeText(reason, time, store.opensAt),
      },
    ]);
    return reason;
  };

  const reasons = await Promise.all(online.map(sweepOne));
  return {
    noLocation: reasons.filter((reason) => reason === 'no-location').length,
    kitchenClosed: reasons.filter((reason) => reason === 'kitchen-closed').length,
  };
}

/** P25: the third missed offer in a row takes the partner offline, with a notice (no email). */
export async function takeOfflineForMissedOffers(partnerId: string, now = new Date()) {
  const { changed } = await takePartnerOffline(partnerId, 'missed-offers', { now });
  if (!changed) return { changed };
  const row = await runAsSystem('missed offers', (ctx) => findPartnerById(ctx, partnerId));
  const { timeZone } = await storeFacts(now);
  if (row) {
    await runPartnerEffects([
      {
        kind: 'notify',
        userId: row.userId,
        notice: offlineNoticeText('missed-offers', clockAt(now, timeZone)),
      },
    ]);
  }
  return { changed };
}

/** P7.8, P15.6: the daily job (rejected after the reapply date; unsent uploads after 24 h). */
export async function deleteExpiredPartnerFiles(
  now = new Date(),
): Promise<{ applications: number; uploads: number }> {
  const { today } = await storeFacts(now);
  const due = await runAsSystem('partner files', (ctx) =>
    listRejectedDueForDeletion(ctx, dateOf(today)),
  );
  await Promise.all(
    due.map(async (partner) => {
      await runAsSystem('partner files', async (ctx) => {
        await clearFiles(ctx, partner.id, now);
        await insertHistory(ctx, {
          id: uuidv7(),
          partnerId: partner.id,
          type: 'files-deleted',
          actor: { kind: 'system' },
          at: now,
          versionAfter: partner.version,
        });
      });
      await deleteUploads(
        [partner.photoUploadId, partner.idDocumentUploadId].filter(
          (value): value is string => value !== null,
        ),
      );
    }),
  );
  const orphans = await runAsSystem('partner files', (ctx) =>
    findUnattachedUploads(ctx, new Date(now.getTime() - DAY_MS)),
  );
  await deleteUploads(orphans.map((upload) => upload.id));
  return { applications: due.length, uploads: orphans.length };
}

// ------------------------------------------------------------------ account tie-ins (P15.5)

/** Deleting the account is refused while the partner is online ("Go offline first."). */
export async function assertPartnerErasable(actor: UserActor) {
  const row = await runAs(actor, (ctx) => findOnlineState(ctx, actor.userId));
  if (row?.isOnline) throw refuse('PARTNER_ONLINE', 'Go offline first.', 409);
  const held = row ? await activeDeliveryOf(row.id) : null;
  if (held) {
    throw refuse('PARTNER_BUSY', 'Finish or give back your order first.', 409, {
      orderNumber: held.orderNumber,
    });
  }
}

/** After an account deletion: the partner's files go (objects and rows). */
export async function removePartnerFiles(uploadIds: readonly string[]) {
  await runPartnerEffects([{ kind: 'deleteFiles', uploadIds: [...uploadIds] }]);
}

/** The partner section of "Download my data". Never the number or the images. */
export async function partnerExportFor(actor: UserActor): Promise<PartnerExport | null> {
  const row = await runAs(actor, (ctx) => findPartnerByUser(ctx, actor.userId));
  if (!row) return null;
  return {
    status: row.status,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    vehicle: VEHICLE_WORDS[row.vehicleType],
    plate: row.vehiclePlate,
    idDocument: row.idDocumentType ? DOCUMENT_WORDS[row.idDocumentType] : null,
    idNumberLast4: row.idNumberLast4,
    idExpiresOn: row.idDocumentExpiresOn ? isoDateOf(row.idDocumentExpiresOn) : null,
    partnerTermsVersion: row.partnerTermsVersion,
    partnerTermsAcceptedAt: row.partnerTermsAcceptedAt?.toISOString() ?? null,
    online: row.isOnline,
    note: 'To get copies of your ID details, contact us.',
  };
}

/**
 * One partner email (B17, design 11), sent by the `send-partner-email` job once per history
 * row. The reviewer's text comes from that row, never from the event.
 */
export async function deliverPartnerEmail(data: {
  partnerId: string;
  eventId: string;
  kind: PartnerEmailKind;
}): Promise<'sent' | 'skipped'> {
  const found = await runAsSystem('partner email', async (ctx) => {
    const partner = await findPartnerById(ctx, data.partnerId);
    const account = partner ? await findAccount(ctx, partner.userId) : null;
    const entry = await findHistoryEntry(ctx, data.eventId);
    return { partner, account, entry };
  });
  if (!found.account || !found.partner) return 'skipped';
  if (data.kind !== 'received' && (!found.entry || found.entry.partnerId !== data.partnerId)) {
    return 'skipped';
  }
  const content = partnerEmail(data.kind, {
    firstName: found.account.name.split(/\s+/)[0] ?? found.account.name,
    siteUrl: (process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/+$/, ''),
    applicantText: found.entry?.applicantText ?? null,
    reapplyFrom: found.partner.reapplyAfter ? isoDateOf(found.partner.reapplyAfter) : null,
  });
  await sendEmail({
    to: found.account.email,
    subject: content.subject,
    ...letterEmail(content),
  });
  return 'sent';
}
