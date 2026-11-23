import 'server-only';
import type { UserActor } from '@/server/auth/session';
import type {
  DecisionResult,
  DocumentLink,
  ImageState,
  PartnerBadge,
  PartnerListResult,
  PartnerReview,
  PartnerVersion,
} from './review-schema';

/*
 * Staff review (F6 A18 to A33). Signatures are the contract; bodies follow test first.
 *
 * Reads go through `partner_directory` and `partner_event_directory`, which mask real people
 * for the demo admin (B27). Every decision: lock the row → not found / gone → replay (same
 * decision by the caller within 60 s) → version (`APPLICATION_CHANGED`) → state and role
 * (`INVALID_STATE`, `ALREADY_SENT_BACK`, `DEMO_PARTNER`, `ACCOUNT_BANNED`, `FILES_DELETED`) →
 * decision rules (`ID_EXPIRED`, `IMAGE_NOT_READY`, `FLAGS_NOT_CHECKED`) → step-up → write the
 * row, the history row and the audit entry in one transaction as the caller. A refusal
 * changes nothing and writes nothing. Effects run after commit.
 */

const notImplemented = (name: string): never => {
  throw new Error(`${name} is not implemented yet`);
};

/** `/admin/partners` and its refetches (A19). */
export async function listPartnerApplications(
  _actor: UserActor,
  _input: unknown,
): Promise<PartnerListResult> {
  return notImplemented('listPartnerApplications');
}

/** A18.1: the sidebar badge. */
export async function countToReview(_actor: UserActor): Promise<PartnerBadge> {
  return notImplemented('countToReview');
}

/** `/admin/partners/<id>` (A20): null for an unknown, non-UUID or withdrawn id (404 page). */
export async function getPartnerReview(
  _actor: UserActor,
  _partnerId: string,
): Promise<PartnerReview | null> {
  return notImplemented('getPartnerReview');
}

/** A26.5: the dialog's opening check; also the suspend dialog's online line. */
export async function getPartnerVersion(
  _actor: UserActor,
  _input: unknown,
): Promise<PartnerVersion> {
  return notImplemented('getPartnerVersion');
}

/**
 * A21.4: a fresh 5-minute link. ID images write `partner.document-viewed`. The demo admin gets
 * links to sample and demo accounts only; anything else answers `NOT_FOUND` (A29.4).
 */
export async function getDocumentLink(
  _actor: UserActor,
  _input: unknown,
): Promise<DocumentLink | ImageState> {
  return notImplemented('getDocumentLink');
}

export async function approvePartner(_actor: UserActor, _input: unknown): Promise<DecisionResult> {
  return notImplemented('approvePartner');
}

export async function sendBackPartner(_actor: UserActor, _input: unknown): Promise<DecisionResult> {
  return notImplemented('sendBackPartner');
}

export async function rejectPartner(_actor: UserActor, _input: unknown): Promise<DecisionResult> {
  return notImplemented('rejectPartner');
}

export async function suspendPartner(_actor: UserActor, _input: unknown): Promise<DecisionResult> {
  return notImplemented('suspendPartner');
}

export async function reinstatePartner(
  _actor: UserActor,
  _input: unknown,
): Promise<DecisionResult> {
  return notImplemented('reinstatePartner');
}

export async function reopenPartner(_actor: UserActor, _input: unknown): Promise<DecisionResult> {
  return notImplemented('reopenPartner');
}
