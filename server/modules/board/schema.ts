import { z } from 'zod';
import type { Cuisine, DisputeStatus, OrderStatus, PaymentStatus } from '@/server/db/enums';
import { cleanNote } from '@/server/modules/cart/schema';
import type { StoreMoment } from '@/server/modules/menu/schema';
import type { CustomerCancelLine } from '@/server/modules/orders/progress-schema';
import { stepUpInput } from '@/server/modules/staff/schema';

/*
 * The staff order board (F5): moving orders through the kitchen, undo, moving back, refusing
 * and cancelling with a reason, the manual hand-over before couriers exist, the order detail,
 * finding an order by number, and marking a dish sold out. Inputs are strict; money is integer
 * cents and instants ISO 8601 in UTC. What each role receives is decided on the server: the
 * kitchen's shapes carry no contact details and no amounts (U10, A13.1).
 */

// ------------------------------------------------------------------ constants

/** A4.7, A8.1: "Moved just now · Undo" shows this long after the server confirms a move. */
export const UNDO_WINDOW_MS = 10_000;
/** The server still accepts an undo this much later, for the round trip. */
export const UNDO_GRACE_MS = 2_000;
export const STAFF_NOTE_MAX = 500;
export const BOARD_CARDS_MAX = 50;
/** A2.5 and U8. Constants until F18 makes them settings. */
export const LATENESS = {
  newAmberMinutes: 3,
  newRedMinutes: 5,
  dueSoonMinutes: 5,
  readyAmberMinutes: 10,
  readyRedMinutes: 15,
} as const;
/** A3.3, A3.6: the chime repeats while an order has waited this long in New; the banner after. */
export const CHIME_REPEAT_AFTER_MINUTES = 2;
export const WAITING_BANNER_MINUTES = 5;
/** A12.4, A12.6: a quiet refresh while live; polling when realtime can't start. */
export const BOARD_REFRESH_MS = 60_000;
export const BOARD_POLL_MS = 10_000;
/** A6.6, A7.11: per account and hour. The limit itself is the rate-limit policy. */
export const REFUSAL_ALERT_AT = 6;
export const STAFF_CANCEL_ALERT_AT = 11;

// ------------------------------------------------------------------ statuses and columns

export const BOARD_STATUSES = [
  'PLACED',
  'ACCEPTED',
  'PREPARING',
  'READY',
  'PICKED_UP',
] as const satisfies readonly OrderStatus[];
export type BoardStatus = (typeof BOARD_STATUSES)[number];

/** The kitchen's board has no "Out for delivery" column (A2.1). */
export const KITCHEN_BOARD_STATUSES = [
  'PLACED',
  'ACCEPTED',
  'PREPARING',
  'READY',
] as const satisfies readonly BoardStatus[];

/** The kitchen's one-tap steps (A4.1). */
export const FORWARD_MOVES = [
  'ACCEPTED',
  'PREPARING',
  'READY',
] as const satisfies readonly BoardStatus[];
export type ForwardMove = (typeof FORWARD_MOVES)[number];

export type BoardColumn = 'new' | 'accepted' | 'preparing' | 'ready' | 'outForDelivery';
export const COLUMN_OF: Record<BoardStatus, BoardColumn> = {
  PLACED: 'new',
  ACCEPTED: 'accepted',
  PREPARING: 'preparing',
  READY: 'ready',
  PICKED_UP: 'outForDelivery',
};

export const isBoardStatus = (status: OrderStatus): status is BoardStatus =>
  (BOARD_STATUSES as readonly OrderStatus[]).includes(status);

// ------------------------------------------------------------------ reasons

/** Why staff cancelled (A7.2). Kept on the order as `cancel_code`; never sent to the customer. */
export const CANCEL_CODES = [
  'customer-asked',
  'dish-unavailable',
  'too-busy',
  'closing',
  'cant-deliver',
  'fraud',
  'other',
] as const;
export type CancelCode = (typeof CANCEL_CODES)[number];

/** "Can't make it" offers the kitchen's reasons only (A6.2). */
export const REFUSE_REASONS = [
  'dish-unavailable',
  'too-busy',
  'closing',
  'other',
] as const satisfies readonly CancelCode[];
export type RefuseReason = (typeof REFUSE_REASONS)[number];

export const STAFF_CANCEL_REASONS = CANCEL_CODES;
export type StaffCancelReason = CancelCode;

/** The customer reads only this line for each reason (A7.8, S5.5). */
export const CUSTOMER_LINE_OF: Record<CancelCode, CustomerCancelLine> = {
  'customer-asked': 'atYourRequest',
  'dish-unavailable': 'ranOut',
  'too-busy': 'tooBusy',
  closing: 'closedEarly',
  'cant-deliver': 'cantDeliver',
  fraud: 'couldNotAccept',
  other: 'other',
};

export const MOVE_BACK_REASONS = [
  'marked-ready-by-mistake',
  'wrong-ticket',
  'not-picked-up',
  'other',
] as const;
export type MoveBackReason = (typeof MOVE_BACK_REASONS)[number];

export const HANDOVER_REASONS = [
  'own-driver',
  'customer-collected',
  'courier-app-down',
  'other',
] as const;
export type HandoverReason = (typeof HANDOVER_REASONS)[number];

// ------------------------------------------------------------------ field errors (A6.3)

export const BOARD_FIELD_ERRORS = {
  reason: 'Choose a reason.',
  dishes: "Check the dishes you can't make.",
  refusalNote: 'Tell us what happened, so support can answer the customer.',
  otherNote: 'Add a note about what happened.',
  noteLength: 'Keep the note under 500 characters.',
  orderNumber: 'Enter an order number, like 1042.',
  /** Mark delivered on a cash order without the tick (A9.2, design 3.6). */
  cashCollected: 'Check this box once you have the cash.',
  /** "Not picked up after all" moves an order back from Out for delivery only. */
  notPickedUp: 'Use this reason only for an order that is out for delivery.',
} as const;

// ------------------------------------------------------------------ inputs

const orderId = z.uuid();
/** The order's `version` as the person saw it (A5.2). */
const expectedVersion = z.int().min(0).max(2_147_483_647);

/**
 * "A note for staff" (A6.2): control characters become a space and invisible format
 * characters are removed, as for the kitchen note. Blank is no note.
 */
export const staffNoteSchema = z
  .string()
  .max(STAFF_NOTE_MAX * 4, BOARD_FIELD_ERRORS.noteLength)
  .transform((value) => cleanNote(value) ?? '')
  .pipe(z.string().max(STAFF_NOTE_MAX, BOARD_FIELD_ERRORS.noteLength))
  .transform((value) => value || undefined);

/** Order lines (`order_items.id`) the kitchen ticked for "A dish is unavailable". */
const lineIds = z
  .array(z.uuid())
  .max(25)
  .default([])
  .transform((ids) => [...new Set(ids)]);

const reasonEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z.enum(values, { error: BOARD_FIELD_ERRORS.reason });

/** Accept, Start cooking, Mark ready (A4). `to` is the step the button showed. */
export const moveOrderInput = z
  .object({ orderId, to: z.enum(FORWARD_MOVES), expectedVersion })
  .strict();
export type MoveOrderInput = z.input<typeof moveOrderInput>;

/** Undo your own move within the window (A8.1). `eventId` comes from the move's result. */
export const undoMoveInput = z.object({ orderId, eventId: z.uuid() }).strict();
export type UndoMoveInput = z.input<typeof undoMoveInput>;

/** ADMIN: one step back, with a reason (A8.3). */
export const moveBackInput = z
  .object({
    orderId,
    expectedVersion,
    reason: reasonEnum(MOVE_BACK_REASONS),
    note: staffNoteSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.reason === 'other' && !value.note) {
      ctx.addIssue({ code: 'custom', path: ['note'], message: BOARD_FIELD_ERRORS.otherNote });
    }
  });
export type MoveBackInput = z.input<typeof moveBackInput>;

const cancellationFields = {
  orderId,
  expectedVersion,
  lineIds,
  /**
   * Design 3.2 step 3: "Also mark Pad Thai sold out on the menu" (ticked by default for
   * KITCHEN and ADMIN). Needs `menu: update-availability`; SUPPORT sending it is refused.
   */
  markSoldOut: z.boolean().default(false),
  note: staffNoteSchema.optional(),
};

function checkCancellation(
  value: { reason: string; lineIds: string[]; note?: string | undefined },
  ctx: z.RefinementCtx,
) {
  if (value.reason === 'dish-unavailable' && value.lineIds.length === 0) {
    ctx.addIssue({ code: 'custom', path: ['lineIds'], message: BOARD_FIELD_ERRORS.dishes });
  }
  if (value.reason === 'other' && !value.note) {
    ctx.addIssue({ code: 'custom', path: ['note'], message: BOARD_FIELD_ERRORS.refusalNote });
  }
}

// Ticked dishes, and marking them sold out, only mean something for "A dish is unavailable".
function tidyCancellation<V extends { reason: string; lineIds: string[]; markSoldOut: boolean }>(
  value: V,
): V {
  const unavailable = value.reason === 'dish-unavailable';
  return {
    ...value,
    lineIds: unavailable ? value.lineIds : [],
    markSoldOut: unavailable && value.markSoldOut,
  };
}

/**
 * "Can't make it" on a New order (A6): KITCHEN only. SUPPORT and ADMIN cancel New orders with
 * `staffCancelInput`, whose reasons include the kitchen's, recorded as `staff` (design D14).
 */
export const refuseOrderInput = z
  .object({ ...cancellationFields, reason: reasonEnum(REFUSE_REASONS) })
  .strict()
  .superRefine(checkCancellation)
  .transform(tidyCancellation);
export type RefuseOrderInput = z.input<typeof refuseOrderInput>;

/**
 * SUPPORT and ADMIN: cancel from New to Ready with a reason (A7). `stepUp` carries the
 * authenticator or backup code when the cancellation refunds a card after Accept and the last
 * code check is over 10 minutes old (A7.10): nothing is cancelled until it passes.
 */
export const staffCancelInput = z
  .object({
    ...cancellationFields,
    reason: reasonEnum(STAFF_CANCEL_REASONS),
    stepUp: stepUpInput.optional(),
  })
  .strict()
  .superRefine(checkCancellation)
  .transform(tidyCancellation);
export type StaffCancelInput = z.input<typeof staffCancelInput>;

const handOverFields = {
  orderId,
  expectedVersion,
  reason: reasonEnum(HANDOVER_REASONS),
  note: staffNoteSchema.optional(),
};

const requireNoteForOther = (
  value: { reason: string; note?: string | undefined },
  ctx: z.RefinementCtx,
) => {
  if (value.reason === 'other' && !value.note) {
    ctx.addIssue({ code: 'custom', path: ['note'], message: BOARD_FIELD_ERRORS.otherNote });
  }
};

/** ADMIN: Ready → Out for delivery by hand (A9.1). */
export const markPickedUpInput = z.object(handOverFields).strict().superRefine(requireNoteForOther);
export type MarkPickedUpInput = z.input<typeof markPickedUpInput>;

/**
 * ADMIN: Out for delivery → Delivered by hand (A9.1, A9.2). A cash order needs
 * `cashCollected: true` ("Collected $53.97 in cash"); the server checks it against the order.
 */
export const markDeliveredInput = z
  .object({ ...handOverFields, cashCollected: z.boolean().default(false) })
  .strict()
  .superRefine(requireNoteForOther);
export type MarkDeliveredInput = z.input<typeof markDeliveredInput>;

export const boardInput = z.object({}).strict();
export const staffOrderInput = z.object({ orderId }).strict();
export type StaffOrderInput = z.input<typeof staffOrderInput>;

/** Cards to refetch after realtime events (new orders, orders that left, money flags). */
export const boardCardsInput = z
  .object({
    orderIds: z
      .array(orderId)
      .min(1)
      .max(BOARD_CARDS_MAX)
      .transform((ids) => [...new Set(ids)]),
  })
  .strict();
export type BoardCardsInput = z.input<typeof boardCardsInput>;

/**
 * "1042", "#1042", " s1101 " → "1042", "S1101" (A11.1). Null when it can't be an order number.
 * Only exact numbers match; leading zeros are ignored.
 */
export function normalizeOrderNumber(raw: string): string | null {
  const match = /^#?\s*(s?)(\d{1,9})$/i.exec(raw.trim());
  if (!match) return null;
  const digits = (match[2] ?? '').replace(/^0+(?=\d)/, '');
  return `${match[1] ? 'S' : ''}${digits}`;
}

export const findOrderInput = z
  .object({ query: z.string().max(40, BOARD_FIELD_ERRORS.orderNumber) })
  .strict()
  .superRefine((value, ctx) => {
    if (!normalizeOrderNumber(value.query)) {
      ctx.addIssue({ code: 'custom', path: ['query'], message: BOARD_FIELD_ERRORS.orderNumber });
    }
  })
  .transform((value) => ({ number: normalizeOrderNumber(value.query) ?? '' }));
export type FindOrderInput = z.input<typeof findOrderInput>;

/** "86 it" (lead decision): KITCHEN and ADMIN mark a dish sold out, or back on. */
export const setDishAvailabilityInput = z
  .object({ dishId: z.uuid(), available: z.boolean() })
  .strict();
export type SetDishAvailabilityInput = z.input<typeof setDishAvailabilityInput>;

// ------------------------------------------------------------------ who did it

export type BoardStaffRole = 'kitchen' | 'support' | 'admin';

/**
 * Who made a change, for the timeline and the conflict messages. A staff name is null for the
 * demo admin when the person isn't a demo or sample account.
 */
export type TimelineActor =
  | { kind: 'staff'; name: string | null; role: BoardStaffRole }
  | { kind: 'customer' }
  | { kind: 'stripe' }
  | { kind: 'system' };

// ------------------------------------------------------------------ the board

export interface BoardCardLine {
  /** `order_items.id`: what "A dish is unavailable" ticks. */
  id: string;
  /** The dish (`menu_items.id`), as in `BoardSnapshot.soldOut` and the realtime event. */
  dishId: string;
  title: string;
  quantity: number;
  flavors: string[];
  note: string | null;
  /** Sold out right now: the chip on New cards and in "Which dishes?" (design 3.2, 4.4). */
  soldOut: boolean;
}

interface BoardCardBase {
  id: string;
  number: string;
  status: BoardStatus;
  /** Compare with realtime events (a lower version is old) and send back as `expectedVersion`. */
  version: number;
  placedAt: string;
  acceptedAt: string | null;
  preparingAt: string | null;
  readyAt: string | null;
  pickedUpAt: string | null;
  /** Placed plus the longest prep of its dishes as ordered (A2.5); null for older orders. */
  readyBy: string | null;
  /** First name only (A2.3); masked for the demo admin on a real customer's order. */
  firstName: string;
  lines: BoardCardLine[];
  /** Sum of quantities: "New order 1043, 3 items". */
  itemCount: number;
  kitchenNote: string | null;
  /** The caller's own last move while it can still be undone (A4.7); survives a reload. */
  undo: { eventId: string; type: ForwardMove; until: string } | null;
  /** A real customer's order seen by the demo admin: "Hidden for demo staff" (design 2.14). */
  masked: { firstName: boolean; kitchenNote: boolean };
}

export type MoneyFlag = 'refunded' | 'partlyRefunded' | 'disputed' | 'paidLate';

/** KITCHEN: "Cash" or "Card · paid", nothing more (U10). */
export interface KitchenBoardCard extends BoardCardBase {
  view: 'kitchen';
  payment: { method: 'cash' | 'card'; paid: boolean };
}

/** SUPPORT, ADMIN and the demo admin: amounts and money flags (A2.3). */
export interface FullBoardCard extends BoardCardBase {
  view: 'full';
  payment: {
    method: 'cash' | 'card';
    status: PaymentStatus;
    totalCents: number;
    refundedCents: number;
    dispute: DisputeStatus;
    /** Revived after a late payment (F4 U10): "Paid late". */
    paidLate: boolean;
    /** The chips, in this order: "Refunded", "Partly refunded", "Disputed", "Paid late". */
    flags: MoneyFlag[];
  };
}

export type BoardCard = KitchenBoardCard | FullBoardCard;

/** What the caller's role may do on the board; buttons follow it (A1, A14.3). */
export interface BoardAbilities {
  move: boolean;
  undo: boolean;
  moveBack: boolean;
  /** "Can't make it" on New orders: KITCHEN only (design D14); SUPPORT and ADMIN cancel. */
  refuse: boolean;
  cancel: boolean;
  handOver: boolean;
  setAvailability: boolean;
  /** The demo admin: every button the role has is shown disabled, "Read-only in the demo". */
  readOnly: boolean;
}

export interface BoardSnapshot {
  /** The server's clock; timers count from it, never from the device's (B14). */
  asOf: string;
  view: 'kitchen' | 'full';
  columns: BoardColumn[];
  /**
   * Every order in those columns. Oldest first within a column: by placedAt for New, Accepted
   * and Preparing, by readyAt for Ready, by pickedUpAt for Out for delivery (A2.2).
   */
  cards: BoardCard[];
  store: {
    isOpen: boolean;
    /** "Open · closes 11 pm", "Closed · opens 11 am tomorrow" (A2.7). */
    label: string;
    closesAt: StoreMoment | null;
    opensAt: StoreMoment | null;
    timeZone: string;
  };
  /** Amber and red thresholds (U8): sent, so the browser never hard-codes them. */
  thresholds: typeof LATENESS;
  /** Dishes sold out right now, for the strip, the count and the New-card chips (design 4.4). */
  soldOut: SoldOutDish[];
  can: BoardAbilities;
  /** False when realtime isn't set up on this machine: poll every 10 s and say so (A12.6). */
  realtime: { configured: boolean };
}

/** An order that left the board, with why, for "Order 1043 was cancelled by …" (A3.7). */
export interface BoardGone {
  id: string;
  number: string;
  status: OrderStatus;
  version: number;
  left: 'cancelled' | 'pickedUp' | 'delivered';
  by: TimelineActor | null;
  at: string;
}

export interface BoardCardsResult {
  asOf: string;
  /** Orders still on the caller's board. */
  cards: BoardCard[];
  /** Orders asked for that are no longer on it. Unknown ids are left out of both. */
  gone: BoardGone[];
}

/**
 * "Sold out since 7:42 pm · Alex Kim" (design 4.2). `since` and `byName` are null for dishes
 * sold out before F5 (the seed); `byName` also for a real staff member seen by the demo admin.
 * A dish stays sold out until someone turns it back on (lead decision).
 */
export interface SoldOutDish {
  dishId: string;
  title: string;
  since: string | null;
  byName: string | null;
}

/** The "Dish availability" sheet: every dish; the browser groups by cuisine. */
export interface BoardDish {
  dishId: string;
  title: string;
  cuisine: Cuisine;
  available: boolean;
  soldOutSince: string | null;
  soldOutByName: string | null;
}

export type FindOrderResult =
  /** On the caller's board: scroll to the card and highlight it. */
  | { kind: 'onBoard'; orderId: string; number: string; status: BoardStatus }
  /** Finished, cancelled, failed, waiting for payment (or out for delivery, for the kitchen). */
  | { kind: 'offBoard'; orderId: string; number: string; status: OrderStatus }
  /** "No order 9999." */
  | { kind: 'none'; number: string };

// ------------------------------------------------------------------ the detail (A10)

export type StaffTimelineType =
  | 'created'
  | 'placed'
  | 'paid'
  | 'payment-failed'
  | 'accepted'
  | 'preparing'
  | 'ready'
  | 'undone'
  | 'moved-back'
  | 'refused'
  | 'cancelled'
  | 'expired'
  | 'refunded'
  | 'picked-up'
  | 'delivered'
  | 'revived'
  | 'late-payment'
  | 'mismatch'
  | 'dispute-opened'
  | 'dispute-closed'
  | 'sold-out';

interface TimelineBase {
  id: string;
  at: string;
  by: TimelineActor;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus | null;
}

/** One entry per order event, oldest first; wording per type is B17 (board/text.ts). */
export type StaffTimelineEntry = TimelineBase &
  (
    | { type: 'created' | 'paid' | 'expired' | 'revived' | 'late-payment' | 'mismatch' }
    | { type: 'accepted' | 'preparing' | 'dispute-opened' }
    | { type: 'placed'; method: 'cash' | 'card'; cardLabel: string | null }
    | { type: 'payment-failed'; decline: { code: string | null; declineCode: string | null } }
    /** Minutes against ready-by: negative is early, null without a ready-by. */
    | { type: 'ready'; lateMinutes: number | null }
    | { type: 'undone'; undid: ForwardMove }
    | { type: 'moved-back'; reason: MoveBackReason; note: string | null }
    | { type: 'refused'; reason: RefuseReason; dishes: string[]; note: string | null }
    | {
        type: 'cancelled';
        reason: 'customer' | 'payment-expired' | 'account-deleted' | 'staff';
        code: CancelCode | null;
        dishes: string[];
        note: string | null;
      }
    /** The kitchen gets refunds without amounts: "Refunded to the customer" (A10.3). */
    | { type: 'refunded'; amountCents: number | null; cardLabel: string | null }
    | { type: 'picked-up'; reason: HandoverReason | null; note: string | null }
    | {
        type: 'delivered';
        reason: HandoverReason | null;
        note: string | null;
        /** Cash taken at a manual delivery; null for card orders and for the kitchen. */
        cashCollectedCents: number | null;
      }
    | { type: 'dispute-closed'; outcome: string | null }
    /** "Pad Thai marked sold out by Alex Kim (Kitchen)": only when a refusal ticked it. */
    | { type: 'sold-out'; dishes: string[] }
  );

/** A7.6: where a refund Foodz started stands. */
export type RefundState = 'none' | 'pending' | 'slow' | 'done' | 'sample';

/** What the caller may do with this order now; the detail's buttons follow it. */
export interface DetailActions {
  next: ForwardMove | null;
  undo: { eventId: string; type: ForwardMove; until: string } | null;
  moveBack: { to: OrderStatus } | null;
  refuse: boolean;
  /** `stepUp`: confirming will ask for an authenticator code first (A7.10). */
  cancel: { stepUp: boolean } | null;
  pickUp: boolean;
  /** `cashToCollectCents` for "Collected $53.97 in cash"; null for card orders. */
  deliver: { cashToCollectCents: number | null } | null;
  readOnly: boolean;
}

interface DetailBase {
  asOf: string;
  id: string;
  number: string;
  status: OrderStatus;
  version: number;
  onBoard: boolean;
  createdAt: string;
  placedAt: string | null;
  acceptedAt: string | null;
  preparingAt: string | null;
  readyAt: string | null;
  pickedUpAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  readyBy: string | null;
  /** The window promised at checkout: "Promised for 8:09–8:19 pm". */
  promised: { from: string; to: string } | null;
  /** "Accepted after 1 min · cooked in 19 min · ready 3 min late". */
  howItWent: {
    acceptedAfterMinutes: number | null;
    cookedInMinutes: number | null;
    readyLateMinutes: number | null;
  };
  kitchenNote: string | null;
  cancellation: {
    reason: 'customer' | 'payment-expired' | 'account-deleted' | 'staff' | 'kitchen-refused';
    code: CancelCode | null;
    dishes: string[];
    by: TimelineActor;
    at: string;
  } | null;
  timeline: StaffTimelineEntry[];
  actions: DetailActions;
  /** "Hidden for demo staff" once per masked block (design 2.14). */
  masked: { customer: boolean; kitchenNote: boolean };
}

export interface KitchenOrderDetail extends DetailBase {
  view: 'kitchen';
  lines: BoardCardLine[];
  customer: { firstName: string };
  payment: { method: 'cash' | 'card'; paid: boolean; refund: RefundState };
}

export interface FullOrderDetail extends DetailBase {
  view: 'full';
  lines: (BoardCardLine & { unitPriceCents: number; lineTotalCents: number })[];
  customer: {
    name: string;
    firstName: string;
    /** E.164 for the tap-to-call link; null when masked. */
    phone: string | null;
    /** "(617) 555-0123", or the masked form. */
    phoneDisplay: string;
    address: { label: string | null; line1: string; line2: string | null; city: string | null };
    instructions: string | null;
    distanceKm: number;
  };
  money: {
    subtotalCents: number;
    /** `code` is null when it is a real customer's own code seen by the demo admin (F4 S9). */
    promo: { code: string | null; foodDiscountCents: number; freeDelivery: boolean } | null;
    deliveryFeeCents: number;
    deliveryDiscountCents: number;
    taxCents: number;
    taxRateBps: number | null;
    tipCents: number;
    totalCents: number;
    method: 'cash' | 'card';
    /** "Visa •••• 4242"; brand only ("Visa") when masked; null for cash. */
    cardLabel: string | null;
    paymentStatus: PaymentStatus;
    refundedCents: number;
    refund: { state: RefundState; amountCents: number | null; since: string | null };
    dispute: { status: DisputeStatus; openedAt: string | null; closedAt: string | null };
    decline: { code: string | null; declineCode: string | null } | null;
    paidLate: boolean;
  };
}

export type StaffOrderDetail = KitchenOrderDetail | FullOrderDetail;

// ------------------------------------------------------------------ results

export interface MoveResult {
  orderId: string;
  number: string;
  status: ForwardMove;
  version: number;
  at: string;
  /** Pass to `undoMoveAction` until `undoUntil`. */
  eventId: string;
  undoUntil: string;
  /** A double tap: this is the move already made, nothing new happened (A4.6). */
  replayed: boolean;
}

export interface StatusChangeResult {
  orderId: string;
  number: string;
  status: OrderStatus;
  version: number;
  at: string;
  eventId: string;
  replayed: boolean;
}

export interface StaffCancelResult {
  orderId: string;
  number: string;
  status: 'CANCELLED';
  version: number;
  at: string;
  eventId: string;
  /** `amountCents` is null for the kitchen. `sample`: a seeded order with no payment (B13). */
  refund: { kind: 'card'; amountCents: number | null } | { kind: 'none' } | { kind: 'sample' };
  /** The code given back; null without one, and always for the kitchen. */
  codeReleased: string | null;
  /** Dishes marked sold out with it (`markSoldOut`); empty otherwise. */
  soldOut: { dishId: string; title: string }[];
  replayed: boolean;
}

export interface SetDishAvailabilityResult {
  dishId: string;
  title: string;
  available: boolean;
  /** False when it already was so. */
  changed: boolean;
}

/**
 * What the "Can't make it" and "Cancel order" dialogs show when they open (design 3.2, 3.3):
 * the "what will happen" box, the dish ticks and whether the code field shows from the start.
 * The kitchen's shape has no amounts, card label or code (A13.1).
 */
interface CancelPreviewBase {
  orderId: string;
  number: string;
  status: OrderStatus;
  /** Send as `expectedVersion`. */
  version: number;
  /** False once the caller can no longer refuse or cancel it (the dialog shows why). */
  possible: boolean;
  /** "The kitchen has already started on this order." */
  kitchenStarted: boolean;
  lines: BoardCardLine[];
}

export interface KitchenCancelPreview extends CancelPreviewBase {
  view: 'kitchen';
  refund: 'card' | 'none';
}

export interface FullCancelPreview extends CancelPreviewBase {
  view: 'full';
  refund:
    | { kind: 'card'; amountCents: number; cardLabel: string | null; tipIncluded: boolean }
    | { kind: 'none' }
    | { kind: 'sample' };
  /** "LASTONE will be released so it can be used again."; null for a masked customer's own code. */
  codeToRelease: string | null;
  /** Show the code field from the start (design D31). */
  stepUpRequired: boolean;
}

export type CancelPreview = KitchenCancelPreview | FullCancelPreview;

// ------------------------------------------------------------------ refusals

/** `serverError.details` for the board's refusal codes. */
/** How the last status change came about, for the conflict sentences (design 2.8, 3.4). */
export type ChangeHow =
  | 'moved'
  | 'moved-back'
  | 'undone'
  | 'cancelled-by-customer'
  | 'cancelled-by-staff'
  | 'refused'
  | 'other';

export interface OrderChangedDetails {
  orderId: string;
  number: string;
  /** Send `current.version` again to go ahead anyway ("Cancel it anyway?", A5.5). */
  current: { status: OrderStatus; version: number };
  /**
   * The last status change: "Already cooking · moved by Alex Kim at 7:41 pm", "(moved back by
   * Foodz Admin)", "cancelled by the customer at 7:31 pm". `by` carries the role.
   */
  lastChange: { how: ChangeHow; by: TimelineActor; at: string } | null;
}

export interface BoardRefusalDetails {
  ORDER_CHANGED: OrderChangedDetails;
  INVALID_STATE: { orderId: string; number: string; status: OrderStatus };
  UNDO_NOT_ALLOWED: {
    orderId: string;
    number: string;
    why: 'expired' | 'notYours' | 'changed';
    movedBy: TimelineActor | null;
  };
  /** Ask for the code (A7.10). A wrong code answers STEP_UP_INVALID with `fieldErrors.stepUp`. */
  STEP_UP_REQUIRED: { action: 'refund'; windowMinutes: number };
  /** Five wrong codes in a row: "Too many wrong codes. Try again at 7:58 pm." (F2 lockout). */
  STEP_UP_LOCKED: { retryAt: string };
}

// ------------------------------------------------------------------ stored event data

/*
 * `order_events.data` for the events F5 writes. `by` is a snapshot of the person at the time,
 * so the timeline still reads "Alex Kim (Kitchen)" after a rename or a role change. Staff notes
 * live only here, never on the order row, and are never read for the customer.
 */

const eventActor = z
  .object({ name: z.string().max(120), role: z.enum(['kitchen', 'support', 'admin']) })
  .strict();
const storedNote = z.string().max(STAFF_NOTE_MAX).optional();

export const moveEventData = z
  .object({
    by: eventActor,
    /** The order's version after this move: undo needs the status unchanged since. */
    versionAfter: z.int().min(1),
    /** Ready only: minutes against ready-by (negative is early). */
    lateMinutes: z.int().nullable().optional(),
  })
  .strict();

export const undoneEventData = z
  .object({ by: eventActor, eventId: z.uuid(), undid: z.enum(FORWARD_MOVES) })
  .strict();

export const movedBackEventData = z
  .object({ by: eventActor, reason: z.enum(MOVE_BACK_REASONS), note: storedNote })
  .strict();

/** `refused` (KITCHEN) and `cancelled` with `actor: 'staff'` (SUPPORT, ADMIN). */
export const staffCancelEventData = z
  .object({
    actor: z.literal('staff'),
    by: eventActor,
    reason: z.enum(CANCEL_CODES),
    lineIds: z.array(z.uuid()).max(25),
    dishes: z.array(z.string().max(200)).max(25),
    note: storedNote,
    refundCents: z.int().min(0),
    /** The cancellation email already says the money is coming back: no refund email (F4 D45). */
    refundAnnounced: z.boolean(),
    sample: z.boolean(),
    codeReleased: z.string().max(40).nullable(),
  })
  .strict();

/** `sold-out`: dishes a refusal or cancellation marked sold out (design 3.2, 5.3). */
export const soldOutEventData = z
  .object({
    by: eventActor,
    dishIds: z.array(z.uuid()).min(1).max(25),
    dishes: z.array(z.string().max(200)).min(1).max(25),
  })
  .strict();

/** `picked-up` and `delivered` marked by hand (A9). */
export const handOverEventData = z
  .object({
    by: eventActor,
    reason: z.enum(HANDOVER_REASONS),
    note: storedNote,
    cashCollectedCents: z.int().min(0).nullable(),
  })
  .strict();
