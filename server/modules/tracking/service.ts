import 'server-only';
import type { UserActor } from '@/server/auth/session';
import type { StaffDispatchResult } from '@/server/modules/delivery/schema';
import type {
  CustomerTracking,
  HandOverResult,
  OpsMapSnapshot,
  PartnerDeliveryF8,
  PickedUpResult,
  TrackingRoute,
} from './schema';

/*
 * F8's services (contract §2 to §9). These are the signatures the routes, actions, jobs and the
 * frontend build against; the bodies follow, test first. Partner steps go through definer
 * functions as the partner; staff act as themselves with an audit row in the same transaction;
 * the location pipeline, the estimate loop and the demo run act as the platform.
 */

const notImplemented = (name: string): never => {
  throw new Error(`${name} is not implemented yet`);
};

// ------------------------------------------------------------------ the partner's steps (P37 to P46)

/** `GET /api/v1/partner/deliveries/current` in F8: F7's DTO plus the stage, route and steps. */
export async function getCurrentDeliveryF8(_actor: UserActor): Promise<PartnerDeliveryF8 | null> {
  return notImplemented('getCurrentDeliveryF8');
}

/** P38: "Picked up". Moves the delivery and the order together and makes the code. */
export async function pickUp(
  _actor: UserActor,
  _deliveryId: string,
  _input: unknown,
): Promise<PickedUpResult> {
  return notImplemented('pickUp');
}

/** P41, P42: the code check, atomic with the try count in the database. */
export async function handOver(
  _actor: UserActor,
  _deliveryId: string,
  _input: unknown,
): Promise<HandOverResult> {
  return notImplemented('handOver');
}

/** P43.1: a problem at the door; "isn't answering" starts the 5-minute clock. */
export async function reportProblem(
  _actor: UserActor,
  _deliveryId: string,
  _input: unknown,
): Promise<{ since: string }> {
  return notImplemented('reportProblem');
}

/** P43.3: "Tell Foodz nobody answered", once the clock has run out. */
export async function reportNoAnswer(
  _actor: UserActor,
  _deliveryId: string,
): Promise<{ toldAt: string }> {
  return notImplemented('reportNoAnswer');
}

// ------------------------------------------------------------------ the location pipeline (L1 to L3)

/**
 * Called by F6's `recordLocations` (and by the demo run for the bot courier) with each accepted
 * point of a partner who holds an order: history every 15 s, "at the kitchen" and "almost there"
 * transitions, the customer's and the map's publishing under their throttles, and a re-plan
 * request when he strays 150 m from the route.
 */
export async function pointAccepted(_input: {
  partnerId: string;
  point: { lat: number; lng: number; heading: number | null; accuracy: number };
  acceptedAt: Date;
}): Promise<void> {
  return notImplemented('pointAccepted');
}

/** Published for every online courier at most every 10 s (and on a state change). */
export async function publishMapPosition(_partnerId: string): Promise<void> {
  return notImplemented('publishMapPosition');
}

// ------------------------------------------------------------------ the estimate (L4)

/** One estimate step of the `delivery-eta` loop: routes from the latest point to the next stop. */
export async function refreshEstimate(
  _deliveryId: string,
): Promise<{ active: boolean; route: TrackingRoute | null }> {
  return notImplemented('refreshEstimate');
}

/** The 5-minute mark of a no-answer wait: nudges the board and the phone (job step). */
export async function noAnswerDue(
  _deliveryId: string,
  _since: string,
): Promise<'due' | 'moved-on'> {
  return notImplemented('noAnswerDue');
}

// ------------------------------------------------------------------ the customer (S1 to S7)

/** B7: `OrderProgress.tracking`, for the order's own customer, pickup to delivery; else null. */
export async function getCustomerTracking(
  _actor: UserActor,
  _orderId: string,
): Promise<CustomerTracking | null> {
  return notImplemented('getCustomerTracking');
}

// ------------------------------------------------------------------ staff (A46 to A54)

/** L3.3: the live map snapshot for the viewer's pool (demo admin: demo only). */
export async function getOpsMap(_actor: UserActor): Promise<OpsMapSnapshot> {
  return notImplemented('getOpsMap');
}

/** A50.1: SUPPORT and ADMIN, after a lock or 5 minutes of "isn't answering". */
export async function confirmHandover(
  _actor: UserActor,
  _input: unknown,
): Promise<StaffDispatchResult> {
  return notImplemented('confirmHandover');
}

/** A50.1: "Ask Luis to wait 5 more minutes". */
export async function askToWait(_actor: UserActor, _input: unknown): Promise<StaffDispatchResult> {
  return notImplemented('askToWait');
}

/** A50.1, U6: F5's staff cancellation with "Customer couldn't be reached". */
export async function cancelUnreachable(
  _actor: UserActor,
  _input: unknown,
): Promise<StaffDispatchResult> {
  return notImplemented('cancelUnreachable');
}

/** A54.1: the demo admin starts the pretend delivery (one at a time, six an hour). */
export async function startDemoDelivery(
  _actor: UserActor,
): Promise<{ runId: string; endsAt: string }> {
  return notImplemented('startDemoDelivery');
}

// ------------------------------------------------------------------ jobs

/** L8.2: deletes location rows and stored routes 30 days after a delivery ended. */
export async function purgeOldLocations(_now?: Date): Promise<{ rows: number; routes: number }> {
  return notImplemented('purgeOldLocations');
}
