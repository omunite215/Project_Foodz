import type { OrderStatus, PaymentStatus } from '@/server/db/enums';
import { CANCEL_CODES, type CancelCode, CUSTOMER_LINE_OF } from '@/server/modules/board/schema';
import {
  type ArrivalWindow,
  type CancellationNotice,
  type CustomerTimelineEntry,
  type CustomerTimelineKind,
  LATE_READY_MINUTES,
  type OrderProgress,
  type OrderStep,
  type OrderSummaryProgress,
  PLACED_SLOW_MINUTES,
  PLACED_VERY_SLOW_MINUTES,
  REFUND_SLOW_AFTER_MINUTES,
  STEP_KEYS,
  type StepKey,
} from './progress-schema';
import { cardLabel } from './text';

/*
 * The customer's live order (F5 B20), worked out from the stored order alone: the stepper, the
 * arrival window and its late lines, the cancellation card, the customer timeline and when the
 * answer next changes by itself. Pure, so the order page, its refresh, the orders list and the
 * notices word everything alike. Nothing here reads a staff name, role, note or reason code
 * into the result: a cancellation carries only the line the customer reads.
 */

const MINUTE_MS = 60_000;

export interface ProgressEvent {
  id: string;
  type: string;
  /** The status the event left; a move back names the step it reversed this way. */
  fromStatus: OrderStatus | null;
  data: unknown;
  createdAt: Date;
}

/** What the builder needs of an order: the stored snapshot, its lines and its timeline. */
export interface ProgressFacts {
  status: OrderStatus;
  version: number;
  paymentMethod: 'CASH' | 'CARD';
  paymentStatus: PaymentStatus;
  totalCents: number;
  refundedCents: number;
  tipCents: number;
  cardBrand: string | null;
  cardLast4: string | null;
  hasPaymentIntent: boolean;
  autoRefundReason: string | null;
  placedAt: Date | null;
  acceptedAt: Date | null;
  preparingAt: Date | null;
  readyAt: Date | null;
  pickedUpAt: Date | null;
  deliveredAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  cancelCode: string | null;
  cancelLineIds: string[];
  prepMinutes: number | null;
  arrivalFromMinutes: number | null;
  arrivalToMinutes: number | null;
  items: { id: string; title: string }[];
  /** Oldest first. */
  events: ProgressEvent[];
}

const IN_PROGRESS: ReadonlySet<OrderStatus> = new Set([
  'PENDING_PAYMENT',
  'PLACED',
  'ACCEPTED',
  'PREPARING',
  'READY',
  'PICKED_UP',
]);

const STEP_OF_STATUS: Partial<Record<OrderStatus, number>> = {
  PLACED: 0,
  ACCEPTED: 1,
  PREPARING: 2,
  READY: 3,
  PICKED_UP: 4,
  DELIVERED: 5,
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {};

const numberOr = (value: unknown, fallback: number | null) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const plusMinutes = (at: Date, minutes: number) => new Date(at.getTime() + minutes * MINUTE_MS);
const wholeMinutes = (ms: number) => Math.floor(ms / MINUTE_MS);

export const cancelCodeOf = (value: string | null): CancelCode | null =>
  CANCEL_CODES.find((code) => code === value) ?? null;

const isStaffCancel = (reason: string | null) => reason === 'staff' || reason === 'kitchen-refused';

/** Placed plus the longest prep of its dishes as ordered (A2.5); null for older orders. */
export function readyByOf(facts: Pick<ProgressFacts, 'placedAt' | 'prepMinutes'>): Date | null {
  return facts.placedAt && facts.prepMinutes
    ? plusMinutes(facts.placedAt, facts.prepMinutes)
    : null;
}

/** Minutes the food was ready after its ready-by (negative is early); null when unknown. */
export function readyLateMinutes(
  facts: Pick<ProgressFacts, 'placedAt' | 'prepMinutes' | 'readyAt'>,
): number | null {
  const readyBy = readyByOf(facts);
  if (!readyBy || !facts.readyAt) return null;
  const ms = facts.readyAt.getTime() - readyBy.getTime();
  return ms >= 0 ? wholeMinutes(ms) : -wholeMinutes(-ms);
}

// ------------------------------------------------------------------ the timeline (S6.7)

interface StepEntry {
  eventId: string;
  step: 'accepted' | 'preparing' | 'ready' | 'pickedUp' | 'delivered';
}

const STEP_EVENTS: Record<string, StepEntry['step']> = {
  accepted: 'accepted',
  preparing: 'preparing',
  ready: 'ready',
  'picked-up': 'pickedUp',
  delivered: 'delivered',
};

const STEP_FOR_STATUS: Partial<Record<OrderStatus, StepEntry['step']>> = {
  ACCEPTED: 'accepted',
  PREPARING: 'preparing',
  READY: 'ready',
  PICKED_UP: 'pickedUp',
  DELIVERED: 'delivered',
};

/**
 * The kitchen's steps still standing: an undone step (by the event it undid) and a step moved
 * back (the latest one for the status left) drop out, so the customer never sees them.
 */
function standingSteps(events: readonly ProgressEvent[]): Set<string> {
  const standing: StepEntry[] = [];
  for (const event of events) {
    const step = STEP_EVENTS[event.type];
    if (step) {
      standing.push({ eventId: event.id, step });
      continue;
    }
    if (event.type === 'undone') {
      const undid = asRecord(event.data).eventId;
      const index = standing.findIndex((entry) => entry.eventId === undid);
      if (index >= 0) standing.splice(index, 1);
    } else if (event.type === 'moved-back' && event.fromStatus) {
      const left = STEP_FOR_STATUS[event.fromStatus];
      const index = standing.findLastIndex((entry) => entry.step === left);
      if (index >= 0) standing.splice(index, 1);
    }
  }
  return new Set(standing.map((entry) => entry.eventId));
}

/** "Customer collected it" on the standing hand-over (U23). */
export function collectedOf(events: readonly ProgressEvent[]): boolean {
  const standing = standingSteps(events);
  const pickedUp = events.findLast((event) => event.type === 'picked-up' && standing.has(event.id));
  return asRecord(pickedUp?.data).reason === 'customer-collected';
}

function dishesOf(
  facts: Pick<ProgressFacts, 'items' | 'cancelLineIds'>,
  lineIds: readonly string[],
) {
  const ticked = new Set(lineIds);
  const titles = facts.items.filter((item) => ticked.has(item.id)).map((item) => item.title);
  return [...new Set(titles)];
}

const CANCEL_EVENT_TYPES = new Set(['cancelled', 'refused']);

export function customerTimeline(facts: ProgressFacts): CustomerTimelineEntry[] {
  const standing = standingSteps(facts.events);
  const entries: CustomerTimelineEntry[] = [];
  for (const event of facts.events) {
    const at = event.createdAt.toISOString();
    const data = asRecord(event.data);
    const step = STEP_EVENTS[event.type];
    if (step) {
      if (!standing.has(event.id)) continue;
      if (step === 'pickedUp') {
        entries.push({
          kind: 'pickedUp',
          at,
          amountCents: null,
          ...(data.reason === 'customer-collected' && { collected: true as const }),
        });
      } else if (step === 'delivered') {
        entries.push({
          kind: 'delivered',
          at,
          amountCents: numberOr(data.cashCollectedCents, null),
        });
      } else {
        entries.push({ kind: step, at, amountCents: null });
      }
      continue;
    }
    if (CANCEL_EVENT_TYPES.has(event.type)) {
      const staff = event.type === 'refused' || data.actor === 'staff';
      const code = staff
        ? cancelCodeOf(typeof data.reason === 'string' ? data.reason : null)
        : null;
      const lineIds = Array.isArray(data.lineIds)
        ? data.lineIds.filter((id): id is string => typeof id === 'string')
        : [];
      entries.push({
        kind: 'cancelled',
        at,
        amountCents: null,
        cancellation: {
          by: staff ? 'store' : data.actor === 'customer' ? 'you' : 'system',
          reasonLine: code ? CUSTOMER_LINE_OF[code] : null,
          dishes: code === 'dish-unavailable' ? dishesOf(facts, lineIds) : [],
        },
      });
      continue;
    }
    const kind = F4_KINDS[event.type];
    if (!kind) continue;
    entries.push({
      kind,
      at,
      amountCents: kind === 'refunded' ? numberOr(data.amountCents, null) : null,
    });
  }
  return entries;
}

const F4_KINDS: Record<string, CustomerTimelineKind> = {
  placed: 'placed',
  revived: 'revived',
  expired: 'expired',
  refunded: 'refunded',
  'dispute-opened': 'disputeOpened',
  'dispute-closed': 'disputeClosed',
};

// ------------------------------------------------------------------ the stepper (S1)

const STEP_TIMES: Record<StepKey, keyof ProgressFacts> = {
  placed: 'placedAt',
  accepted: 'acceptedAt',
  preparing: 'preparingAt',
  ready: 'readyAt',
  pickedUp: 'pickedUpAt',
  delivered: 'deliveredAt',
};

export function stepsOf(facts: ProgressFacts): OrderStep[] | null {
  const reached = STEP_OF_STATUS[facts.status];
  if (reached === undefined) return null;
  const collected = collectedOf(facts.events);
  return STEP_KEYS.map((key, index) => {
    const state: OrderStep['state'] =
      index < reached || facts.status === 'DELIVERED'
        ? 'done'
        : index === reached
          ? 'current'
          : 'upcoming';
    const time = facts[STEP_TIMES[key]];
    return {
      key,
      state,
      at: state !== 'upcoming' && time instanceof Date ? time.toISOString() : null,
      collected: key === 'pickedUp' && index <= reached && collected,
    };
  });
}

// ------------------------------------------------------------------ arrival (S2)

export function arrivalOf(facts: ProgressFacts, now: Date): ArrivalWindow | null {
  if (!['PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'PICKED_UP'].includes(facts.status))
    return null;
  if (!facts.placedAt || facts.arrivalFromMinutes === null || facts.arrivalToMinutes === null) {
    return null;
  }
  let from = plusMinutes(facts.placedAt, facts.arrivalFromMinutes);
  let to = plusMinutes(facts.placedAt, facts.arrivalToMinutes);
  let lateMinutes: number | null = null;
  const late = readyLateMinutes(facts);
  // S2.2: ready 5 or more minutes after its ready-by moves the window later, never earlier.
  if ((facts.status === 'READY' || facts.status === 'PICKED_UP') && late !== null) {
    if (late >= LATE_READY_MINUTES) {
      lateMinutes = late;
      from = plusMinutes(from, late);
      to = plusMinutes(to, late);
    }
  }
  const readyBy = readyByOf(facts);
  const behind =
    (facts.status === 'ACCEPTED' || facts.status === 'PREPARING') &&
    readyBy !== null &&
    now.getTime() - readyBy.getTime() >= LATE_READY_MINUTES * MINUTE_MS;
  if (now.getTime() >= to.getTime()) {
    return {
      kind: 'pastDue',
      from: from.toISOString(),
      to: to.toISOString(),
      lateMinutes,
      behind: false,
    };
  }
  return {
    kind: lateMinutes === null ? 'promised' : 'moved',
    from: from.toISOString(),
    to: to.toISOString(),
    lateMinutes,
    behind: lateMinutes === null && behind,
  };
}

// ------------------------------------------------------------------ cancellations (S5)

function cancelEventOf(facts: ProgressFacts) {
  return facts.events.findLast((event) => CANCEL_EVENT_TYPES.has(event.type));
}

/** Where the money stands for a cancelled order. */
function moneyLineOf(facts: ProgressFacts): CancellationNotice['moneyLine'] {
  const card = facts.paymentMethod === 'CARD';
  if (card && facts.paymentStatus === 'REFUNDED') return 'refunded';
  const paid = facts.paymentStatus === 'PAID' || facts.paymentStatus === 'PARTIALLY_REFUNDED';
  if (card && paid && !facts.hasPaymentIntent) return 'sample';
  if (card && paid && facts.autoRefundReason) return 'refunding';
  return 'nothing';
}

export function cancellationOf(facts: ProgressFacts, now: Date): CancellationNotice | null {
  if (facts.status !== 'CANCELLED' || !facts.cancelledAt) return null;
  const store = isStaffCancel(facts.cancelReason);
  if (!store && facts.cancelReason !== 'customer') return null;
  const event = cancelEventOf(facts);
  const data = asRecord(event?.data);
  const code = store ? cancelCodeOf(facts.cancelCode) : null;
  const moneyLine = moneyLineOf(facts);
  const announced = numberOr(data.refundCents, null);
  const refundedEvent = facts.events.findLast((entry) => entry.type === 'refunded');
  const amountCents =
    moneyLine === 'refunding'
      ? announced && announced > 0
        ? announced
        : facts.totalCents - facts.refundedCents
      : moneyLine === 'refunded'
        ? announced && announced > 0
          ? announced
          : facts.refundedCents
        : null;
  const codeReleased = store && typeof data.codeReleased === 'string' ? data.codeReleased : null;
  return {
    by: store ? 'store' : 'you',
    opener: store ? (code === 'customer-asked' ? 'plain' : 'sorry') : null,
    reasonLine: code ? CUSTOMER_LINE_OF[code] : null,
    dishes: code === 'dish-unavailable' ? dishesOf(facts, facts.cancelLineIds) : [],
    moneyLine,
    amountCents,
    cardLabel:
      facts.paymentMethod === 'CARD' && facts.cardBrand && facts.cardLast4
        ? cardLabel(facts.cardBrand, facts.cardLast4)
        : null,
    refundedAt: moneyLine === 'refunded' ? (refundedEvent?.createdAt.toISOString() ?? null) : null,
    tipIncluded: facts.tipCents > 0 && (moneyLine === 'refunding' || moneyLine === 'refunded'),
    codeReleased,
    refundSlow:
      moneyLine === 'refunding' &&
      now.getTime() - facts.cancelledAt.getTime() > REFUND_SLOW_AFTER_MINUTES * MINUTE_MS,
    at: facts.cancelledAt.toISOString(),
  };
}

// ------------------------------------------------------------------ the whole thing

function placedWaitingOf(facts: ProgressFacts, now: Date): OrderProgress['placedWaiting'] {
  if (facts.status !== 'PLACED') return null;
  if (!facts.placedAt) return 'none';
  const minutes = wholeMinutes(now.getTime() - facts.placedAt.getTime());
  if (minutes >= PLACED_VERY_SLOW_MINUTES) return '15';
  if (minutes >= PLACED_SLOW_MINUTES) return '5';
  return 'none';
}

/** The next instant the answer changes by itself: a wait line, "behind", the window passing. */
function refreshAtOf(facts: ProgressFacts, now: Date, arrival: ArrivalWindow | null) {
  const candidates: Date[] = [];
  if (facts.status === 'PLACED' && facts.placedAt) {
    candidates.push(plusMinutes(facts.placedAt, PLACED_SLOW_MINUTES));
    candidates.push(plusMinutes(facts.placedAt, PLACED_VERY_SLOW_MINUTES));
  }
  const readyBy = readyByOf(facts);
  if ((facts.status === 'ACCEPTED' || facts.status === 'PREPARING') && readyBy) {
    candidates.push(plusMinutes(readyBy, LATE_READY_MINUTES));
  }
  if (arrival && arrival.kind !== 'pastDue') candidates.push(new Date(arrival.to));
  if (facts.status === 'CANCELLED' && facts.cancelledAt && moneyLineOf(facts) === 'refunding') {
    candidates.push(plusMinutes(facts.cancelledAt, REFUND_SLOW_AFTER_MINUTES));
  }
  const next = candidates
    .filter((at) => at.getTime() > now.getTime())
    .toSorted((a, b) => a.getTime() - b.getTime())[0];
  return next ? next.toISOString() : null;
}

export function buildProgress(facts: ProgressFacts, now: Date): OrderProgress {
  const arrival = arrivalOf(facts, now);
  const cancellation = cancellationOf(facts, now);
  return {
    asOf: now.toISOString(),
    version: facts.version,
    steps: stepsOf(facts),
    arrival,
    placedWaiting: placedWaitingOf(facts, now),
    deliveredAt:
      facts.status === 'DELIVERED' && facts.deliveredAt ? facts.deliveredAt.toISOString() : null,
    cashCollected:
      facts.status === 'DELIVERED' &&
      facts.paymentMethod === 'CASH' &&
      facts.paymentStatus === 'PAID',
    cancellation,
    live:
      IN_PROGRESS.has(facts.status) ||
      (facts.status === 'CANCELLED' && cancellation?.moneyLine === 'refunding'),
    refreshAt: refreshAtOf(facts, now, arrival),
  };
}

/** What a row of the orders list adds (S7.1, S7.5, U23). */
export function summaryProgress(
  facts: Pick<
    ProgressFacts,
    | 'status'
    | 'placedAt'
    | 'readyAt'
    | 'prepMinutes'
    | 'arrivalFromMinutes'
    | 'arrivalToMinutes'
    | 'events'
  >,
  now: Date,
): OrderSummaryProgress {
  const full = {
    version: 0,
    paymentMethod: 'CASH',
    paymentStatus: 'UNPAID',
    totalCents: 0,
    refundedCents: 0,
    tipCents: 0,
    cardBrand: null,
    cardLast4: null,
    hasPaymentIntent: false,
    autoRefundReason: null,
    acceptedAt: null,
    preparingAt: null,
    pickedUpAt: null,
    deliveredAt: null,
    cancelledAt: null,
    cancelReason: null,
    cancelCode: null,
    cancelLineIds: [],
    items: [],
    ...facts,
  } satisfies ProgressFacts;
  return {
    arrival: arrivalOf(full, now),
    reorderable: facts.status === 'DELIVERED' || facts.status === 'CANCELLED',
    collected:
      (facts.status === 'PICKED_UP' || facts.status === 'DELIVERED') && collectedOf(facts.events),
  };
}
