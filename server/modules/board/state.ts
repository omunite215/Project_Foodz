import type { OrderStatus, PaymentStatus } from '@/server/db/enums';
import {
  type BoardAbilities,
  type BoardStaffRole,
  type BoardStatus,
  type ForwardMove,
  UNDO_GRACE_MS,
  UNDO_WINDOW_MS,
} from './schema';

/*
 * The order board's rules (story B1, A4 to A9, U2 to U6), as pure functions shared by the
 * service, the browser and the tests. The database repeats the role limits in a trigger on
 * orders (migration plan), so a bug here can't let a role do more than it may.
 */

/** One step forward at a time, never skipping (U16). */
export const NEXT_STEP: Partial<Record<OrderStatus, ForwardMove>> = {
  PLACED: 'ACCEPTED',
  ACCEPTED: 'PREPARING',
  PREPARING: 'READY',
};

/** Undo and Move back go one step back (A8.1, A8.3). */
export const PREVIOUS_STEP: Partial<Record<OrderStatus, OrderStatus>> = {
  ACCEPTED: 'PLACED',
  PREPARING: 'ACCEPTED',
  READY: 'PREPARING',
  PICKED_UP: 'READY',
};

/** Staff cancel from New to Ready (A7.1); never once it is out for delivery. */
export const STAFF_CANCELLABLE: readonly OrderStatus[] = [
  'PLACED',
  'ACCEPTED',
  'PREPARING',
  'READY',
];

/**
 * A5.2, A5.3: go ahead only when the status hasn't changed since the version the person saw.
 * Changes that leave the status alone (a refund made in Stripe, a dispute) don't count. A
 * version from the future (made up by the client) never matches.
 */
export function versionStillCurrent(
  order: { version: number; statusChangedVersion: number },
  expectedVersion: number,
): boolean {
  return expectedVersion <= order.version && order.statusChangedVersion <= expectedVersion;
}

/**
 * The status changes each role may make; `orders_guard_staff_write` enforces the same table in
 * the database. Undo uses the backward kitchen steps; Move back is ADMIN's by permission.
 */
const TRANSITIONS: Record<BoardStaffRole, readonly `${OrderStatus}>${OrderStatus}`[]> = {
  kitchen: [
    'PLACED>ACCEPTED',
    'ACCEPTED>PREPARING',
    'PREPARING>READY',
    'ACCEPTED>PLACED',
    'PREPARING>ACCEPTED',
    'READY>PREPARING',
    'PLACED>CANCELLED',
  ],
  support: ['PLACED>CANCELLED', 'ACCEPTED>CANCELLED', 'PREPARING>CANCELLED', 'READY>CANCELLED'],
  admin: [
    'PLACED>ACCEPTED',
    'ACCEPTED>PREPARING',
    'PREPARING>READY',
    'READY>PICKED_UP',
    'PICKED_UP>DELIVERED',
    'ACCEPTED>PLACED',
    'PREPARING>ACCEPTED',
    'READY>PREPARING',
    'PICKED_UP>READY',
    'PLACED>CANCELLED',
    'ACCEPTED>CANCELLED',
    'PREPARING>CANCELLED',
    'READY>CANCELLED',
  ],
};

export function staffTransitionAllowed(
  role: BoardStaffRole,
  from: OrderStatus,
  to: OrderStatus,
): boolean {
  return TRANSITIONS[role].includes(`${from}>${to}`);
}

/** How a cancellation by this role is recorded: the kitchen refuses, everyone else cancels. */
export const cancelReasonFor = (role: BoardStaffRole): 'kitchen-refused' | 'staff' =>
  role === 'kitchen' ? 'kitchen-refused' : 'staff';

export type CardMenuItem = 'details' | 'moveBack' | 'pickUp' | 'deliver' | 'refuse' | 'cancel';

export interface CardActions {
  /** The big button (A4.1, A9.1); null for SUPPORT and for KITCHEN on Ready cards. */
  primary: ForwardMove | 'pickUp' | 'deliver' | null;
  /** "More actions", in the design's order: details, then overrides, then destructive. */
  menu: CardMenuItem[];
  /** The demo admin: shown, disabled, "Read-only in the demo" (A14.3). */
  disabled: boolean;
}

/** The buttons a card shows for the caller (design 2.7). */
export function cardActions(can: BoardAbilities, status: BoardStatus): CardActions {
  const next = NEXT_STEP[status];
  let primary: CardActions['primary'] = null;
  if (next && can.move) primary = next;
  else if (status === 'READY' && can.handOver) primary = 'pickUp';
  else if (status === 'PICKED_UP' && can.handOver) primary = 'deliver';

  const menu: CardMenuItem[] = ['details'];
  if (can.moveBack && PREVIOUS_STEP[status]) menu.push('moveBack');
  if (can.handOver && status === 'READY') menu.push('pickUp');
  if (can.handOver && status === 'PICKED_UP') menu.push('deliver');
  if (can.refuse && status === 'PLACED') menu.push('refuse');
  if (can.cancel && STAFF_CANCELLABLE.includes(status)) menu.push('cancel');
  return { primary, menu, disabled: can.readOnly };
}

/**
 * A7.10, U4: a code is asked before a cancellation gives money back after the kitchen
 * accepted, when the last sign-in or code check is over 10 minutes old. New orders, cash,
 * unpaid and sample orders (no payment behind them) never ask.
 */
export function stepUpNeeded(
  order: {
    status: OrderStatus;
    paymentMethod: 'cash' | 'card';
    paymentStatus: PaymentStatus;
    hasPaymentIntent: boolean;
    refundableCents: number;
  },
  freshUntil: Date | null,
  now: Date,
): boolean {
  const afterAccept =
    order.status === 'ACCEPTED' || order.status === 'PREPARING' || order.status === 'READY';
  const paid = order.paymentStatus === 'PAID' || order.paymentStatus === 'PARTIALLY_REFUNDED';
  const refunds =
    order.paymentMethod === 'card' && paid && order.hasPaymentIntent && order.refundableCents > 0;
  if (!afterAccept || !refunds) return false;
  return freshUntil === null || freshUntil.getTime() <= now.getTime();
}

export type UndoVerdict = 'ok' | 'changed' | 'notYours' | 'expired';

/**
 * A8.1, A8.2: only your own last move, within the window (plus the grace for the round trip),
 * and only while nobody has changed the status since.
 */
export function undoVerdict(
  move: { actorId: string | null; at: Date; versionAfter: number },
  order: { statusChangedVersion: number },
  callerId: string,
  now: Date,
): UndoVerdict {
  if (order.statusChangedVersion !== move.versionAfter) return 'changed';
  if (move.actorId !== callerId) return 'notYours';
  if (now.getTime() - move.at.getTime() > UNDO_WINDOW_MS + UNDO_GRACE_MS) return 'expired';
  return 'ok';
}

/** When the card's Undo row disappears: the move's server time plus the window shown. */
export const undoUntil = (movedAt: Date) => new Date(movedAt.getTime() + UNDO_WINDOW_MS);
