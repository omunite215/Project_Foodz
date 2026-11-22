import type { OrderStatus } from '@/server/db/enums';
import type {
  BoardStaffRole,
  CancelCode,
  ForwardMove,
  HandoverReason,
  MoveBackReason,
} from './schema';

/*
 * Staff wording for the board (story draft copy, design 0 and 3). Pure and client-safe: the
 * dialogs, the timeline and the server's refusal messages use the same words.
 */

export const STAFF_STATUS_WORDS: Record<OrderStatus, string> = {
  PENDING_PAYMENT: 'Waiting for payment',
  PLACED: 'New',
  ACCEPTED: 'Accepted',
  PREPARING: 'Preparing',
  READY: 'Ready',
  PICKED_UP: 'Out for delivery',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  FAILED: 'Payment failed',
};

export const ROLE_LABELS: Record<BoardStaffRole, string> = {
  kitchen: 'Kitchen',
  support: 'Support',
  admin: 'Admin',
};

export const MOVE_BUTTONS: Record<ForwardMove, string> = {
  ACCEPTED: 'Accept',
  PREPARING: 'Start cooking',
  READY: 'Mark ready',
};

export const CANCEL_REASON_LABELS: Record<CancelCode, string> = {
  'customer-asked': 'Customer asked to cancel',
  'dish-unavailable': 'A dish is unavailable',
  'too-busy': 'Kitchen is too busy',
  closing: 'Closing early or an emergency',
  'cant-deliver': "We can't deliver to this address",
  fraud: 'Suspected prank or fraud',
  other: 'Other',
};

export const MOVE_BACK_REASON_LABELS: Record<MoveBackReason, string> = {
  'marked-ready-by-mistake': 'Marked ready by mistake',
  'wrong-ticket': 'Moved the wrong ticket',
  'not-picked-up': 'Not picked up after all',
  other: 'Other',
};

export const HANDOVER_REASON_LABELS: Record<HandoverReason, string> = {
  'own-driver': 'Picked up by our own driver',
  'customer-collected': 'Customer collected it',
  'courier-app-down': 'Courier app not available',
  other: 'Other',
};

export const READ_ONLY_IN_DEMO = 'Read-only in the demo';
export const DEMO_CANNOT_CHANGE = 'The demo admin can look but not change anything.';

/** A6.5: KITCHEN refusing an order that has been accepted. */
export const alreadyAcceptedMessage = (number: string) =>
  `Order ${number} has already been accepted. Ask support or the shift lead to cancel it.`;

/** A8.2 */
export const undoRefusedMessage = (name: string | null) =>
  `Only ${name ?? 'the person who moved it'} can undo this, within 10 seconds. Ask an admin to move it back.`;
