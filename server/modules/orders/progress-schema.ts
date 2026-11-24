import { z } from 'zod';

/*
 * The customer's live order (F5): the stepper, the arrival window and its late notices, what
 * the customer is told when an order is cancelled, and "Order again". One server function
 * builds this from the stored order for the order page, its realtime refresh, the orders list
 * and the notification texts, so their words always match (story B20). It joins F4's
 * `OrderView` as `progress`.
 *
 * Nothing here names a member of staff, their role, a staff note or the reason staff picked:
 * a cancellation carries only the line the customer reads (S5.6, S6.8).
 */

/** Customer notices for Accepted and Ready wait out the board's undo window and its grace. */
export const STEP_NOTICE_DELAY_MS = 12_000;
/** S2.2, S2.3: food ready this many minutes after its ready-by moves the window; "running behind". */
export const LATE_READY_MINUTES = 5;
/** S2.5: the Placed line changes after 5 minutes, then again after 15. */
export const PLACED_SLOW_MINUTES = 5;
export const PLACED_VERY_SLOW_MINUTES = 15;
/** S5.10, A7.6: a refund Foodz started and Stripe hasn't confirmed after this long is "slow". */
export const REFUND_SLOW_AFTER_MINUTES = 15;

// ------------------------------------------------------------------ the stepper (S1)

export const STEP_KEYS = [
  'placed',
  'accepted',
  'preparing',
  'ready',
  'pickedUp',
  'delivered',
] as const;
export type StepKey = (typeof STEP_KEYS)[number];

export interface OrderStep {
  key: StepKey;
  state: 'done' | 'current' | 'upcoming';
  /** The server's time for the step; null for steps not reached (and for undone ones). */
  at: string | null;
  /** U23: the courier step reads "Collected" because the customer picked the order up. */
  collected: boolean;
}

// ------------------------------------------------------------------ arrival (S2)

/**
 * The window line under the stepper (design 6.5). `from`/`to` are instants. The window never
 * moves earlier in F5; it moves later only when the food is ready 5 or more minutes after its
 * ready-by. Null once delivered (see `deliveredAt`), and for cancelled, unpaid and failed
 * orders or older orders that have no window.
 */
export interface ArrivalWindow {
  /**
   * `promised`: as at checkout (S2.1). `moved`: ready late, moved by `lateMinutes` (S2.2).
   * `pastDue`: the end of the window, moved or not, has passed: "Due by {to}" (S2.4).
   */
  kind: 'promised' | 'moved' | 'pastDue';
  from: string;
  to: string;
  /** How far the window moved; null when it didn't. */
  lateMinutes: number | null;
  /** S2.3: accepted or cooking and the ready-by passed 5 or more minutes ago (`promised` only). */
  behind: boolean;
}

/** S2.5: how long a Placed order has waited for the kitchen, in the design's words. */
export type PlacedWaiting = 'none' | '5' | '15';

// ------------------------------------------------------------------ cancellations (S5)

/**
 * The line the customer reads for a cancellation by the store (A7.8, S5.5). These are the
 * customer's own words, keyed by what she reads; the reason staff picked never leaves the
 * staff side ("couldNotAccept" is what a suspected prank reads).
 */
export const CUSTOMER_CANCEL_LINES = [
  'ranOut',
  'tooBusy',
  'closedEarly',
  'atYourRequest',
  'cantDeliver',
  'couldNotAccept',
  'other',
] as const;
export type CustomerCancelLine = (typeof CUSTOMER_CANCEL_LINES)[number];

/** The cancellation card (design 6.8). */
export interface CancellationNotice {
  /** `you`: her own cancellation (F4 S12.5). `store`: a refusal or a staff cancellation. */
  by: 'you' | 'store';
  /**
   * `sorry`: "Sorry, we had to cancel order 1046." `plain`: "Order 1050 is cancelled." (her
   * request). Null for her own cancellation, which keeps F4's page.
   */
  opener: 'sorry' | 'plain' | null;
  /** Null for her own cancellation. */
  reasonLine: CustomerCancelLine | null;
  /** For `ranOut`: the dishes the kitchen ticked, as titled on the order ("Pad Thai"). */
  dishes: string[];
  /**
   * `refunding`: "We're refunding $53.97 to Visa •••• 4242(, tip included)." `refunded`: F4's
   * confirmed line. `nothing`: "Nothing was charged." `sample`: a seeded order with no payment.
   */
  moneyLine: 'refunding' | 'refunded' | 'nothing' | 'sample';
  amountCents: number | null;
  cardLabel: string | null;
  refundedAt: string | null;
  tipIncluded: boolean;
  /** "Your code LASTONE is free to use again." */
  codeReleased: string | null;
  /** S5.10: still refunding after 15 minutes: "This is taking longer than usual." */
  refundSlow: boolean;
  at: string;
}

// ------------------------------------------------------------------ the timeline (S6.7)

/**
 * F4's kinds plus the kitchen steps and the hand-over (the same set as `TimelineKind` in
 * schema.ts, which `OrderView.timeline` uses). Undone steps are left out.
 */
export type CustomerTimelineKind =
  | 'placed'
  | 'revived'
  | 'cancelled'
  | 'expired'
  | 'refunded'
  | 'disputeOpened'
  | 'disputeClosed'
  | 'accepted'
  | 'preparing'
  | 'ready'
  | 'pickedUp'
  | 'delivered';

export interface CustomerTimelineEntry {
  kind: CustomerTimelineKind;
  at: string;
  /** refunded: the amount; delivered (cash collected): the cash paid; otherwise null. */
  amountCents: number | null;
  /** pickedUp: "Collected" (U23). */
  collected?: true;
  /** cancelled: who, and the line to read. Never a staff name, role or note. */
  cancellation?: {
    by: 'you' | 'store' | 'system';
    reasonLine: CustomerCancelLine | null;
    dishes: string[];
  };
}

// ------------------------------------------------------------------ the whole thing

export interface OrderProgress {
  /** The server's clock when this was built; the page words every time from it. */
  asOf: string;
  /** The order's version: compare with `order.status-changed` events (S3.7). */
  version: number;
  /** Null when there is no stepper (S1.2): unpaid, failed, expired or cancelled. */
  steps: OrderStep[] | null;
  arrival: ArrivalWindow | null;
  /** Only while Placed; null otherwise. */
  placedWaiting: PlacedWaiting | null;
  /** "Delivered at 8:14 pm" (S2.6). */
  deliveredAt: string | null;
  /** S1.6: a cash order marked delivered with the cash collected: "Paid in cash · $53.97". */
  cashCollected: boolean;
  cancellation: CancellationNotice | null;
  /**
   * S3.9: hold a live connection. True while the order is in progress, and for a cancelled
   * card order until its refund is confirmed.
   */
  live: boolean;
  /**
   * The next instant this answer changes on its own (a wait line, "running behind", the window
   * passing). The page refetches then, besides its 60-second refresh. Null when nothing is due.
   */
  refreshAt: string | null;
}

/** What `OrderSummary` gains on the orders list (S7.1, design 7.2). */
export interface OrderSummaryProgress {
  /** Orders in progress only; the same window as the order page. */
  arrival: ArrivalWindow | null;
  /** Delivered or cancelled: "Order again" (S7.5). */
  reorderable: boolean;
  /** U23: the chip reads "Collected" instead of "On its way". */
  collected: boolean;
}

/** The status key of an order notice (S6.1), on `notification.created`. */
export type OrderNoticeStatus = 'accepted' | 'ready' | 'pickedUp' | 'delivered' | 'cancelled';

// ------------------------------------------------------------------ order again (S7.5, B23)

export const reorderInput = z.object({ orderId: z.uuid() }).strict();
export type ReorderInput = z.input<typeof reorderInput>;

/** A line for the cart, at today's menu (the cart prices it; no price is carried). */
export interface ReorderLine {
  menuItemId: string;
  title: string;
  quantity: number;
  /** Only the extras the dish still offers. */
  flavors: string[];
  note?: string;
}

/**
 * What was left out (design 8). One entry per dish, except `extraDropped`, one per extra (the
 * line itself is kept). For a dish the kitchen ticked in a refusal the same store day,
 * `kitchenRanOut` wins over `soldOut`.
 */
export interface ReorderLeftOut {
  kind: 'soldOut' | 'extraDropped' | 'offMenu' | 'kitchenRanOut';
  dish: string;
  extra?: string;
}

export interface ReorderResult {
  orderId: string;
  number: string;
  /** Empty when nothing can be ordered: "None of these dishes can be ordered right now." */
  lines: ReorderLine[];
  /**
   * The quantity in `lines`, before the cart's own limits (F3: 20 a line, 50 items), which the
   * cart applies with its own messages when it adds them.
   */
  addedQuantity: number;
  leftOut: ReorderLeftOut[];
}
