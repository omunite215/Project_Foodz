import 'server-only';
import type { UserActor } from '@/server/auth/session';
import type {
  AcceptResult,
  AssignableCouriers,
  CurrentOffer,
  CustomerDispatchView,
  OfferDetail,
  PartnerDelivery,
  StaffDispatchResult,
} from './schema';

/*
 * Dispatch and delivery offers (F7). Signatures are the contract; bodies follow test first.
 *
 * Partners answer through definer functions (`app_accept_offer`, `app_decline_offer`,
 * `app_offer_seen`, `app_give_back`) that lock the delivery row and check ownership with
 * `app_partner_id()`, so even a service bug can't accept someone else's offer. Staff write as
 * themselves under row-level security and the deliveries guard trigger; the dispatch run writes
 * as the platform. Effects (realtime, notices, events) run after commit.
 */

const notImplemented = (name: string): never => {
  throw new Error(`${name} is not implemented yet`);
};

// ------------------------------------------------------------------ partner routes

/** `GET /api/v1/partner/offers/current` (P28.6): the open offer, or the practice one. */
export async function getCurrentOffer(
  _actor: UserActor,
  _sessionId: string | null,
): Promise<CurrentOffer> {
  return notImplemented('getCurrentOffer');
}

/** `GET /api/v1/partner/offers/{id}`: own open offer only, else 404 (P33.1). */
export async function getOffer(_actor: UserActor, _offerId: string): Promise<OfferDetail> {
  return notImplemented('getOffer');
}

/** `POST …/seen` (W7.4): records the first time the card showed; idempotent. */
export async function markOfferSeen(
  _actor: UserActor,
  _offerId: string,
): Promise<{ seenAt: string }> {
  return notImplemented('markOfferSeen');
}

/** `POST …/accept` (W6): atomic, idempotent; `OFFER_GONE { why }` otherwise. */
export async function acceptOffer(_actor: UserActor, _offerId: string): Promise<AcceptResult> {
  return notImplemented('acceptOffer');
}

/** `POST …/decline` (P23): one tap, no reason; idempotent. */
export async function declineOffer(
  _actor: UserActor,
  _offerId: string,
  _input: unknown,
): Promise<{ declined: true }> {
  return notImplemented('declineOffer');
}

/** `POST …/late-accept` (P28.2): records a press before the end; never assigns. */
export async function recordLateAccept(
  _actor: UserActor,
  _offerId: string,
  _input: unknown,
): Promise<{ recorded: boolean }> {
  return notImplemented('recordLateAccept');
}

/** `GET /api/v1/partner/deliveries/current` (P29): only while he holds the order. */
export async function getCurrentDelivery(_actor: UserActor): Promise<PartnerDelivery | null> {
  return notImplemented('getCurrentDelivery');
}

/** `POST /api/v1/partner/deliveries/{id}/give-back` (P30). */
export async function giveBack(
  _actor: UserActor,
  _deliveryId: string,
  _input: unknown,
): Promise<{ gaveBack: true }> {
  return notImplemented('giveBack');
}

/** `POST /api/v1/partner/practice-offers` (P34): demo partner, this session only. */
export async function sendPracticeOffer(
  _actor: UserActor,
  _sessionId: string,
): Promise<CurrentOffer> {
  return notImplemented('sendPracticeOffer');
}

// ------------------------------------------------------------------ staff

export async function listAssignableCouriers(
  _actor: UserActor,
  _input: unknown,
): Promise<AssignableCouriers> {
  return notImplemented('listAssignableCouriers');
}

export async function sendStaffOffer(
  _actor: UserActor,
  _input: unknown,
): Promise<StaffDispatchResult> {
  return notImplemented('sendStaffOffer');
}

export async function takeOffCourier(
  _actor: UserActor,
  _input: unknown,
): Promise<StaffDispatchResult> {
  return notImplemented('takeOffCourier');
}

export async function restartSearch(
  _actor: UserActor,
  _input: unknown,
): Promise<StaffDispatchResult> {
  return notImplemented('restartSearch');
}

// ------------------------------------------------------------------ customer

/** The order page's courier view (F7 S1 to S4); the customer's own order only. */
export async function getCustomerDispatch(
  _actor: UserActor,
  _orderId: string,
): Promise<CustomerDispatchView | null> {
  return notImplemented('getCustomerDispatch');
}

/** B11: a fresh 5-minute link to the assigned courier's photo, for that order's customer. */
export async function courierPhotoLink(
  _actor: UserActor,
  _input: unknown,
): Promise<{ url: string; expiresAt: string } | null> {
  return notImplemented('courierPhotoLink');
}

// ------------------------------------------------------------------ the dispatch run's steps

/** Opens (or reopens) the search for a READY order; null when the order isn't READY. */
export async function openSearch(_input: {
  orderId: string;
  readyEventId: string;
  restart: boolean;
}): Promise<{ deliveryId: string; readyAt: string; searchStartedAt: string } | null> {
  return notImplemented('openSearch');
}

/**
 * One turn of the search, under the dispatch advisory lock: stop, escalate, wait for a staff
 * offer, offer the next partner (oldest ready order first), or find nobody.
 */
export async function searchTurn(
  _deliveryId: string,
): Promise<
  | { kind: 'offered'; offerId: string; expiresAt: string }
  | { kind: 'staffOfferOpen'; offerId: string; expiresAt: string }
  | { kind: 'nobody'; escalated: boolean }
  | { kind: 'stopped' }
  | { kind: 'done' }
> {
  return notImplemented('searchTurn');
}

/** `expire-offer`: ends an unanswered offer after its end plus the grace; counts a miss. */
export async function expireOffer(_offerId: string): Promise<'expired' | 'already-ended'> {
  return notImplemented('expireOffer');
}

/** F6's offline step calls this first (B10): withdraw an open offer, release an assignment. */
export async function partnerLeaving(
  _partnerId: string,
  _how: 'offline' | 'suspended',
): Promise<{ withdrawnOfferId: string | null; releasedDeliveryId: string | null }> {
  return notImplemented('partnerLeaving');
}

/** F5's board hooks (A41): move back, cancel, hand-over, delivered. */
export async function orderChanged(
  _orderId: string,
  _change:
    | 'moved-back'
    | 'cancelled'
    | 'handed-over'
    | 'picked-up-by-courier'
    | 'delivered'
    | 'moved-back-from-out',
): Promise<void> {
  return notImplemented('orderChanged');
}
