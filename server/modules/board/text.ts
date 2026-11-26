import { formatClock } from '@/lib/format';
import type { OrderStatus } from '@/server/db/enums';
import type { StoreMoment } from '@/server/modules/menu/schema';
import { clockAt, openingPhrase } from '@/server/modules/orders/text';
import type {
  BoardStaffRole,
  CancelCode,
  ChangeHow,
  ForwardMove,
  HandoverReason,
  MoveBackReason,
  OrderChangedDetails,
  TimelineActor,
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
  'assigned-courier': 'Picked up by the assigned courier',
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

// ------------------------------------------------------------------ server sentences

/** "Open · closes 11 pm", "Closed · opens 11 am tomorrow" (A2.7). */
export function storeLabel(store: {
  isOpen: boolean;
  closesAt: StoreMoment | null;
  opensAt: StoreMoment | null;
}): string {
  if (store.isOpen) {
    return store.closesAt ? `Open · closes ${formatClock(store.closesAt.time)}` : 'Open';
  }
  return store.opensAt ? `Closed · opens ${openingPhrase(store.opensAt)}` : 'Closed';
}

/** "Alex Kim", "Morgan Diaz (Support)", "the customer". */
export function actorWords(by: TimelineActor | null, withRole = false): string {
  switch (by?.kind) {
    case 'staff': {
      const name = by.name ?? 'a staff member';
      return withRole ? `${name} (${ROLE_LABELS[by.role]})` : name;
    }
    case 'customer':
      return 'the customer';
    case 'stripe':
      return 'Stripe';
    default:
      return 'Foodz';
  }
}

/** Words for a status after "Already …" (A5.1). */
const ALREADY: Partial<Record<OrderStatus, string>> = {
  ACCEPTED: 'accepted',
  PREPARING: 'cooking',
  READY: 'ready',
  PICKED_UP: 'out for delivery',
  DELIVERED: 'delivered',
};

const HOW_WORDS: Record<ChangeHow, string> = {
  moved: 'moved by',
  'moved-back': 'moved back by',
  undone: 'undone by',
  'cancelled-by-customer': 'cancelled by',
  'cancelled-by-staff': 'cancelled by',
  refused: 'cancelled by',
  other: 'changed by',
};

/**
 * ORDER_CHANGED (A5.1, A5.2, A5.4): "Already cooking · moved by Alex Kim at 7:41 pm",
 * "Order 1044 was cancelled by the customer at 7:31 pm.", "Order 1042 changed a moment ago.
 * It's now Accepted (moved back by Foodz Admin). Check it and try again."
 */
export function orderChangedMessage(
  details: OrderChangedDetails,
  timeZone: string,
  wanted?: OrderStatus,
): string {
  const { number, current, lastChange } = details;
  const when = lastChange ? ` at ${clockAt(lastChange.at, timeZone)}` : '';
  if (current.status === 'CANCELLED') {
    const by = lastChange ? ` by ${actorWords(lastChange.by, lastChange.by.kind === 'staff')}` : '';
    return `Order ${number} was cancelled${by}${when}.`;
  }
  const already = ALREADY[current.status];
  if (wanted && wanted === current.status && already && lastChange?.how === 'moved') {
    return `Already ${already} · moved by ${actorWords(lastChange.by)}${when}`;
  }
  const status = STAFF_STATUS_WORDS[current.status];
  const how = lastChange ? ` (${HOW_WORDS[lastChange.how]} ${actorWords(lastChange.by)})` : '';
  return `Order ${number} changed a moment ago. It's now ${status}${how}. Check it and try again.`;
}

/** INVALID_STATE: the action doesn't fit the order's status for this role (A6.5, A7.1, A9). */
export function invalidStateMessage(
  action: 'move' | 'refuse' | 'cancel' | 'moveBack' | 'pickUp' | 'deliver',
  number: string,
  status: OrderStatus,
): string {
  if (status === 'PENDING_PAYMENT') {
    return `Order ${number} is waiting for payment. It expires by itself if it isn't paid.`;
  }
  if (status === 'CANCELLED' || status === 'DELIVERED' || status === 'FAILED') {
    return `Order ${number} is ${STAFF_STATUS_WORDS[status].toLowerCase()}, so it can't be changed.`;
  }
  switch (action) {
    case 'refuse':
      return alreadyAcceptedMessage(number);
    case 'cancel':
      return `Order ${number} is out for delivery, so it can't be cancelled here.`;
    case 'pickUp':
      return `Order ${number} isn't ready yet, so it can't be marked picked up.`;
    case 'deliver':
      return `Order ${number} isn't out for delivery, so it can't be marked delivered.`;
    case 'moveBack':
      return `Order ${number} can't be moved back from ${STAFF_STATUS_WORDS[status]}.`;
    case 'move':
    default:
      return `Order ${number} is ${STAFF_STATUS_WORDS[status]}, so it can't move that way.`;
  }
}
