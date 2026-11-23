import 'server-only';
import type { Actor } from '@/server/db/context';
import type { UserActor } from '@/server/auth/session';
import type {
  AvailabilityResult,
  LocationsResult,
  PartnerState,
  SubmitResult,
  UpdateResult,
} from './schema';
import type { OfflineReason } from './text';

/*
 * The partner's own side (F6). Signatures are the contract; bodies follow test first.
 *
 * Every function re-checks what the action wrapper checked (role, demo) and writes as the
 * caller through `runAs`, so row-level security and the `delivery_partners` guard trigger
 * apply as a second layer. Effects (notifications, emails, realtime, jobs) run after commit.
 */

const notImplemented = (name: string): never => {
  throw new Error(`${name} is not implemented yet`);
};

/** The server render of `/partner` and `GET /api/v1/partner/me`: one DTO per state (B3). */
export async function getMyPartnerState(_actor: Actor): Promise<PartnerState | null> {
  return notImplemented('getMyPartnerState');
}

/**
 * P5.4: staff (`NOT_A_CUSTOMER`), unconfirmed email (`EMAIL_NOT_CONFIRMED`), Turnstile, an
 * existing application (`APPLICATION_EXISTS`) or a rejection before its date (`REAPPLY_LATER`),
 * uploads (`UPLOAD_NOT_READY`), the expiry date (`fieldErrors.idExpiresOn`), then one
 * transaction: the row with a fresh id, the number encrypted to that id, the account phone,
 * the history row and `partner.applied`. A replay inside 60 s answers the same result.
 */
export async function submitApplication(
  _actor: UserActor,
  _input: unknown,
  _request: { ip: string },
): Promise<SubmitResult> {
  return notImplemented('submitApplication');
}

/** P6.3, P6.5: keeps the queue place; replaced files are deleted after commit. */
export async function updateApplication(_actor: UserActor, _input: unknown): Promise<UpdateResult> {
  return notImplemented('updateApplication');
}

/** P6.4: deletes the row, both images and the number; audit `partner.withdrawn`. */
export async function withdrawApplication(_actor: UserActor): Promise<{ withdrawn: true }> {
  return notImplemented('withdrawApplication');
}

/** P7.2: "Go to the app" sets `welcomed_at`. */
export async function markWelcomed(_actor: UserActor): Promise<{ welcomedAt: string }> {
  return notImplemented('markWelcomed');
}

/**
 * `PUT /api/v1/partner/availability` (P9.9, P9.11, P9.12, P12.1). `sessionId` is the caller's
 * session, which becomes `online_session_id` when going online.
 */
export async function setAvailability(
  _actor: UserActor,
  _sessionId: string,
  _input: unknown,
): Promise<AvailabilityResult> {
  return notImplemented('setAvailability');
}

/** `POST /api/v1/partner/locations` (P10.2, P11.2, P16). */
export async function recordLocations(
  _actor: UserActor,
  _sessionId: string,
  _input: unknown,
): Promise<LocationsResult> {
  return notImplemented('recordLocations');
}

/**
 * B11: the one way a partner goes offline (self, the cron, another device, a suspension, a
 * sign-out). Clears the online columns and `last_location`, deletes the Redis point, then
 * publishes `partner.availability-changed` and sends `partner.went-offline`. Idempotent.
 */
export async function takePartnerOffline(
  _partnerId: string,
  _reason: OfflineReason,
): Promise<{ changed: boolean; at: string }> {
  return notImplemented('takePartnerOffline');
}

/** B8: the every-minute job. Returns how many partners it took offline, by reason. */
export async function sweepIdlePartners(
  _now?: Date,
): Promise<{ noLocation: number; kitchenClosed: number }> {
  return notImplemented('sweepIdlePartners');
}

/** P7.8, P15.6: the daily job (rejected after the reapply date; unsent uploads after 24 h). */
export async function deleteExpiredPartnerFiles(
  _now?: Date,
): Promise<{ applications: number; uploads: number }> {
  return notImplemented('deleteExpiredPartnerFiles');
}
