import 'server-only';
import type { UserActor } from '@/server/auth/session';
import type {
  BoardCardsResult,
  CancelPreview,
  BoardDish,
  BoardSnapshot,
  FindOrderResult,
  MoveResult,
  SetDishAvailabilityResult,
  StaffCancelResult,
  StaffOrderDetail,
  StatusChangeResult,
} from './schema';

/*
 * The staff order board (F5). Contract stage: the signatures below are what the actions and
 * pages call; the bodies arrive with the implementation (docs: features/F5/contract.md).
 *
 * Every function re-checks the caller (role, two-factor, demo) even though the action wrapper
 * did, decides the role's shape on the server, and writes as the caller so row-level security
 * and the orders guard trigger apply. Publishing, notifications, emails and refunds run after
 * the commit.
 */

function notImplemented(name: string): never {
  throw new Error(`${name} is not implemented yet.`);
}

// ------------------------------------------------------------------ reads

/** The board as the caller's role sees it, for the server render and every refresh (A2). */
export async function getBoard(_actor: UserActor, _now = new Date()): Promise<BoardSnapshot> {
  return notImplemented('getBoard');
}

/** Cards for orders named by realtime events; orders that left come back in `gone`. */
export async function getBoardCards(
  _actor: UserActor,
  _input: unknown,
  _now = new Date(),
): Promise<BoardCardsResult> {
  return notImplemented('getBoardCards');
}

/** The detail (A10); null for an unknown id, which the page answers with 404. */
export async function getStaffOrderDetail(
  _actor: UserActor,
  _orderId: string,
  _now = new Date(),
): Promise<StaffOrderDetail | null> {
  return notImplemented('getStaffOrderDetail');
}

/** The refuse and cancel dialogs' opening data, shaped by role (design 3.2, 3.3). */
export async function getCancelPreview(
  _actor: UserActor,
  _orderId: string,
  _now = new Date(),
): Promise<CancelPreview> {
  return notImplemented('getCancelPreview');
}

/** Exact order number, any date (A11.1). */
export async function findOrder(_actor: UserActor, _input: unknown): Promise<FindOrderResult> {
  return notImplemented('findOrder');
}

/** Every dish with its availability, for the "Dish availability" sheet (design 4.2). */
export async function listBoardDishes(_actor: UserActor): Promise<{ dishes: BoardDish[] }> {
  return notImplemented('listBoardDishes');
}

// ------------------------------------------------------------------ changes

/** Accept, Start cooking, Mark ready (A4, A5). */
export async function moveOrder(
  _actor: UserActor,
  _input: unknown,
  _now = new Date(),
): Promise<MoveResult> {
  return notImplemented('moveOrder');
}

/** Undo your own move within the window (A8.1, A8.2). */
export async function undoMove(
  _actor: UserActor,
  _input: unknown,
  _now = new Date(),
): Promise<StatusChangeResult> {
  return notImplemented('undoMove');
}

/** ADMIN: one step back with a reason (A8.3). */
export async function moveBack(
  _actor: UserActor,
  _input: unknown,
  _now = new Date(),
): Promise<StatusChangeResult> {
  return notImplemented('moveBack');
}

/** "Can't make it" on a New order (A6). */
export async function refuseOrder(
  _actor: UserActor,
  _input: unknown,
  _now = new Date(),
): Promise<StaffCancelResult> {
  return notImplemented('refuseOrder');
}

/** SUPPORT, ADMIN: cancel from New to Ready; step-up for a card refund after Accept (A7). */
export async function staffCancelOrder(
  _actor: UserActor,
  _input: unknown,
  _now = new Date(),
): Promise<StaffCancelResult> {
  return notImplemented('staffCancelOrder');
}

/** ADMIN: Ready → Out for delivery by hand (A9). */
export async function markPickedUp(
  _actor: UserActor,
  _input: unknown,
  _now = new Date(),
): Promise<StatusChangeResult> {
  return notImplemented('markPickedUp');
}

/** ADMIN: Out for delivery → Delivered by hand; cash is confirmed and marked paid (A9.2). */
export async function markDelivered(
  _actor: UserActor,
  _input: unknown,
  _now = new Date(),
): Promise<StatusChangeResult> {
  return notImplemented('markDelivered');
}

/** "86 it": sold out or back on the menu (lead decision, design 4). */
export async function setDishAvailability(
  _actor: UserActor,
  _input: unknown,
  _now = new Date(),
): Promise<SetDishAvailabilityResult> {
  return notImplemented('setDishAvailability');
}
