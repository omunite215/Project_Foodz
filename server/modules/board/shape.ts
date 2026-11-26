import { COURIER_MILESTONES, courierTimelineWords } from '@/server/modules/delivery/text';
import { displayPhone } from '@/lib/phone';
import { can as roleCan, type Role } from '@/server/auth/roles';
import type { OrderStatus } from '@/server/db/enums';
import { readyByOf, readyLateMinutes } from '@/server/modules/orders/progress';
import { REFUND_SLOW_AFTER_MINUTES } from '@/server/modules/orders/progress-schema';
import { brandLabel, cardLabel } from '@/server/modules/orders/text';
import {
  type BoardAbilities,
  type BoardCard,
  type BoardCardLine,
  type BoardGone,
  type BoardStaffRole,
  type BoardStatus,
  CANCEL_CODES,
  type CancelPreview,
  type ChangeHow,
  type DetailActions,
  FORWARD_MOVES,
  type ForwardMove,
  HANDOVER_REASONS,
  isBoardStatus,
  KITCHEN_BOARD_STATUSES,
  BOARD_STATUSES,
  MOVE_BACK_REASONS,
  type MoneyFlag,
  type OrderChangedDetails,
  type RefundState,
  REFUSE_REASONS,
  type StaffOrderDetail,
  type StaffTimelineEntry,
  type TimelineActor,
} from './schema';
import { NEXT_STEP, PREVIOUS_STEP, STAFF_CANCELLABLE, stepUpNeeded, undoUntil } from './state';

/*
 * What each role receives (F5 contract 3), built field by field from the rows the directory
 * views return. The kitchen's shapes never carry a phone, an address, instructions, an email, a
 * last name or an amount (U10, A13.1); the demo admin reads real customers masked, as the views
 * mask them. Pure, so the tests can check every shape without a database.
 */

const MINUTE_MS = 60_000;

/** The facts of one order, as the board repository reads them. */
export interface OrderFacts {
  id: string;
  number: string;
  status: OrderStatus;
  paymentMethod: 'CASH' | 'CARD';
  paymentStatus: 'UNPAID' | 'PAID' | 'PARTIALLY_REFUNDED' | 'REFUNDED';
  contactName: string;
  contactPhone: string;
  addressLabel: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  addressCity: string | null;
  addressText: string;
  courierInstructions: string | null;
  note: string | null;
  distanceKm: number;
  subtotalCents: number;
  discountCents: number;
  deliveryFeeCents: number;
  deliveryDiscountCents: number;
  taxCents: number;
  taxRateBps: number | null;
  tipCents: number;
  totalCents: number;
  refundedCents: number;
  promoCode: string | null;
  cardBrand: string | null;
  cardLast4: string | null;
  disputeStatus: 'NONE' | 'OPEN' | 'WON' | 'LOST';
  disputeOpenedAt: Date | null;
  disputeClosedAt: Date | null;
  arrivalFromMinutes: number | null;
  arrivalToMinutes: number | null;
  autoRefundReason: string | null;
  hasPaymentIntent: boolean;
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
  version: number;
  statusChangedVersion: number;
  createdAt: Date;
  updatedAt: Date;
  masked: boolean;
}

export interface LineFacts {
  id: string;
  dishId: string;
  title: string;
  unitPriceCents: number;
  quantity: number;
  flavors: string[];
  note: string | null;
}

export interface EventFacts {
  id: string;
  type: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus | null;
  actorId: string | null;
  data: unknown;
  createdAt: Date;
}

export interface Viewer {
  userId: string;
  role: Role;
  isDemo: boolean;
}

// ------------------------------------------------------------------ small readers

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {};

const text = (value: unknown) => (typeof value === 'string' ? value : null);
const count = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const iso = (value: Date | null) => value?.toISOString() ?? null;
const oneOf = <T extends string>(values: readonly T[], value: unknown): T | null =>
  values.find((option) => option === value) ?? null;
const minutesBetween = (from: Date | null, to: Date | null) =>
  from && to ? Math.max(0, Math.floor((to.getTime() - from.getTime()) / MINUTE_MS)) : null;

/** The kitchen sees no amounts and no contact details (U10). */
export const isKitchenView = (role: Role) => role === 'kitchen';

export const boardStatusesFor = (role: Role): readonly BoardStatus[] =>
  isKitchenView(role) ? KITCHEN_BOARD_STATUSES : BOARD_STATUSES;

export const isOnBoardFor = (role: Role, status: OrderStatus) =>
  isBoardStatus(status) && boardStatusesFor(role).includes(status);

/** What the caller's role may do on the board; the demo admin's are ADMIN's, read-only. */
export function abilitiesFor(viewer: Pick<Viewer, 'role' | 'isDemo'>): BoardAbilities {
  const { role } = viewer;
  const moves = roleCan(role, { order: ['update-status'] });
  return {
    move: moves,
    undo: moves,
    moveBack: roleCan(role, { order: ['move-back'] }),
    refuse: roleCan(role, { order: ['refuse'] }),
    cancel: roleCan(role, { order: ['cancel', 'read-any'] }),
    handOver: roleCan(role, { order: ['hand-over'] }),
    setAvailability: roleCan(role, { menu: ['update-availability'] }),
    readOnly: viewer.isDemo,
  };
}

export const firstNameOf = (name: string) => name.trim().split(/\s+/)[0] ?? '';

/** "Visa •••• 4242", or the brand alone when the digits are masked. */
export function cardLabelOf(order: Pick<OrderFacts, 'cardBrand' | 'cardLast4'>) {
  if (!order.cardBrand) return null;
  return order.cardLast4
    ? cardLabel(order.cardBrand, order.cardLast4)
    : brandLabel(order.cardBrand);
}

const paidStatus = (status: OrderFacts['paymentStatus']) =>
  status === 'PAID' || status === 'PARTIALLY_REFUNDED';

/** What a cancellation gives back now: a card refund, nothing, or a seeded sample's nothing. */
export function refundKindOf(order: OrderFacts): 'card' | 'none' | 'sample' {
  if (order.paymentMethod !== 'CARD' || !paidStatus(order.paymentStatus)) return 'none';
  if (!order.hasPaymentIntent) return 'sample';
  return order.totalCents - order.refundedCents > 0 ? 'card' : 'none';
}

export const refundableCents = (order: OrderFacts) =>
  Math.max(0, order.totalCents - order.refundedCents);

export function stepUpFacts(order: OrderFacts) {
  return {
    status: order.status,
    paymentMethod: order.paymentMethod === 'CARD' ? ('card' as const) : ('cash' as const),
    paymentStatus: order.paymentStatus,
    hasPaymentIntent: order.hasPaymentIntent,
    refundableCents: refundableCents(order),
  };
}

// ------------------------------------------------------------------ who did it

const STAFF_ROLES: readonly BoardStaffRole[] = ['kitchen', 'support', 'admin'];
const SYSTEM_SOURCES = new Set(['system', 'expiry-job', 'refund-job']);
const STRIPE_SOURCES = new Set(['stripe', 'check']);
const STRIPE_EVENTS = new Set(['refunded', 'dispute-opened', 'dispute-closed']);

/** The person or system behind an event, from its snapshot (`by`) or its source (`actor`). */
export function actorOf(event: Pick<EventFacts, 'type' | 'data'>): TimelineActor {
  const data = asRecord(event.data);
  const by = asRecord(data.by);
  const role = oneOf(STAFF_ROLES, by.role);
  if (role) return { kind: 'staff', name: text(by.name), role };
  const source = text(data.actor);
  if (source === 'customer') return { kind: 'customer' };
  if ((source && STRIPE_SOURCES.has(source)) || STRIPE_EVENTS.has(event.type)) {
    return { kind: 'stripe' };
  }
  if (source && SYSTEM_SOURCES.has(source)) return { kind: 'system' };
  return { kind: 'system' };
}

/** How the last status change came about, for the conflict sentences (design 2.8). */
export function lastChangeOf(events: readonly EventFacts[]): OrderChangedDetails['lastChange'] {
  const last = events.findLast((event) => event.toStatus !== null);
  if (!last) return null;
  const data = asRecord(last.data);
  let how: ChangeHow = 'other';
  if (FORWARD_EVENT[last.type] || last.type === 'picked-up' || last.type === 'delivered') {
    how = 'moved';
  } else if (last.type === 'moved-back') how = 'moved-back';
  else if (last.type === 'undone') how = 'undone';
  else if (last.type === 'refused') how = 'refused';
  else if (last.type === 'cancelled') {
    how = data.actor === 'customer' ? 'cancelled-by-customer' : 'cancelled-by-staff';
  }
  return { how, by: actorOf(last), at: last.createdAt.toISOString() };
}

/** The event type each forward move writes. */
export const MOVE_EVENT: Record<ForwardMove, 'accepted' | 'preparing' | 'ready'> = {
  ACCEPTED: 'accepted',
  PREPARING: 'preparing',
  READY: 'ready',
};

/** The forward move each move event records. */
export const FORWARD_EVENT: Partial<Record<string, ForwardMove>> = {
  accepted: 'ACCEPTED',
  preparing: 'PREPARING',
  ready: 'READY',
};

/**
 * The caller's own last move while it can still be undone (A4.7): a forward move by them that
 * is still the order's last status change, within the window shown.
 */
export function undoOf(
  order: Pick<OrderFacts, 'statusChangedVersion'>,
  events: readonly EventFacts[],
  callerId: string,
  now: Date,
): BoardCard['undo'] {
  const move = events.findLast(
    (event) => FORWARD_EVENT[event.type] !== undefined && event.actorId === callerId,
  );
  if (!move) return null;
  const type = FORWARD_EVENT[move.type];
  const versionAfter = count(asRecord(move.data).versionAfter);
  const until = undoUntil(move.createdAt);
  if (!type || versionAfter !== order.statusChangedVersion) return null;
  if (until.getTime() <= now.getTime()) return null;
  return { eventId: move.id, type, until: until.toISOString() };
}

// ------------------------------------------------------------------ cards (A2.3)

function linesOf(lines: readonly LineFacts[], soldOut: ReadonlySet<string>): BoardCardLine[] {
  return lines.map((line) => ({
    id: line.id,
    dishId: line.dishId,
    title: line.title,
    quantity: line.quantity,
    flavors: line.flavors,
    note: line.note,
    soldOut: soldOut.has(line.dishId),
  }));
}

function moneyFlagsOf(order: OrderFacts, paidLate: boolean): MoneyFlag[] {
  const flags: MoneyFlag[] = [];
  if (order.paymentStatus === 'REFUNDED') flags.push('refunded');
  if (order.paymentStatus === 'PARTIALLY_REFUNDED') flags.push('partlyRefunded');
  if (order.disputeStatus === 'OPEN' || order.disputeStatus === 'LOST') flags.push('disputed');
  if (paidLate) flags.push('paidLate');
  return flags;
}

export function toCard(
  viewer: Viewer,
  order: OrderFacts,
  lines: readonly LineFacts[],
  events: readonly EventFacts[],
  soldOut: ReadonlySet<string>,
  now: Date,
): BoardCard {
  const { status } = order;
  if (!isBoardStatus(status)) throw new Error('Only orders on the board have a card.');
  const readyBy = readyByOf(order);
  const paidLate = events.some((event) => event.type === 'revived');
  const base = {
    id: order.id,
    number: order.number,
    status,
    version: order.version,
    placedAt: (order.placedAt ?? order.createdAt).toISOString(),
    acceptedAt: iso(order.acceptedAt),
    preparingAt: iso(order.preparingAt),
    readyAt: iso(order.readyAt),
    pickedUpAt: iso(order.pickedUpAt),
    readyBy: iso(readyBy),
    firstName: firstNameOf(order.contactName),
    lines: linesOf(lines, soldOut),
    itemCount: lines.reduce((sum, line) => sum + line.quantity, 0),
    kitchenNote: order.note,
    undo: undoOf(order, events, viewer.userId, now),
    masked: { firstName: order.masked, kitchenNote: order.masked && order.note !== null },
  };
  const method = order.paymentMethod === 'CARD' ? ('card' as const) : ('cash' as const);
  if (isKitchenView(viewer.role)) {
    return {
      ...base,
      view: 'kitchen',
      payment: { method, paid: order.paymentStatus !== 'UNPAID' },
    };
  }
  return {
    ...base,
    view: 'full',
    payment: {
      method,
      status: order.paymentStatus,
      totalCents: order.totalCents,
      refundedCents: order.refundedCents,
      dispute: order.disputeStatus,
      paidLate,
      flags: moneyFlagsOf(order, paidLate),
    },
  };
}

/** Oldest first within each column (A2.2). */
export function sortCards<
  T extends Pick<BoardCard, 'status' | 'placedAt' | 'readyAt' | 'pickedUpAt' | 'id'>,
>(cards: T[]): T[] {
  const key = (card: T) =>
    card.status === 'READY'
      ? (card.readyAt ?? card.placedAt)
      : card.status === 'PICKED_UP'
        ? (card.pickedUpAt ?? card.placedAt)
        : card.placedAt;
  return cards.toSorted((a, b) => key(a).localeCompare(key(b)) || a.id.localeCompare(b.id));
}

/** An order that left the caller's board, with who made it leave (A3.7). */
export function goneOf(
  viewer: Viewer,
  order: OrderFacts,
  events: readonly EventFacts[],
): BoardGone | null {
  let left: BoardGone['left'];
  let type: string[];
  if (order.status === 'CANCELLED') {
    left = 'cancelled';
    type = ['cancelled', 'refused', 'expired'];
  } else if (order.status === 'DELIVERED') {
    left = 'delivered';
    type = ['delivered'];
  } else if (order.status === 'PICKED_UP' && isKitchenView(viewer.role)) {
    left = 'pickedUp';
    type = ['picked-up'];
  } else {
    return null;
  }
  const event = events.findLast((entry) => type.includes(entry.type));
  return {
    id: order.id,
    number: order.number,
    status: order.status,
    version: order.version,
    left,
    by: event ? actorOf(event) : null,
    at: (
      event?.createdAt ??
      order.cancelledAt ??
      order.deliveredAt ??
      order.updatedAt
    ).toISOString(),
  };
}

// ------------------------------------------------------------------ the timeline (A10.3, B17)

const dishTitles = (lines: readonly LineFacts[], lineIds: readonly string[]) => {
  const ticked = new Set(lineIds);
  return [...new Set(lines.filter((line) => ticked.has(line.id)).map((line) => line.title))];
};

const stringList = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

export function timelineOf(
  viewer: Viewer,
  order: OrderFacts,
  lines: readonly LineFacts[],
  events: readonly EventFacts[],
  courierNames: ReadonlyMap<string, string> = new Map(),
): StaffTimelineEntry[] {
  const kitchen = isKitchenView(viewer.role);
  const label = cardLabelOf(order);
  return events.flatMap((event): StaffTimelineEntry[] => {
    const data = asRecord(event.data);
    const base = {
      id: event.id,
      at: event.createdAt.toISOString(),
      by: actorOf(event),
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
    };
    const note = text(data.note);
    switch (event.type) {
      case 'created':
      case 'paid':
      case 'expired':
      case 'revived':
      case 'late-payment':
      case 'mismatch':
      case 'accepted':
      case 'preparing':
      case 'dispute-opened':
        return [{ ...base, type: event.type }];
      case 'placed':
        return [
          {
            ...base,
            type: 'placed',
            method: data.method === 'card' || order.paymentMethod === 'CARD' ? 'card' : 'cash',
            cardLabel: order.paymentMethod === 'CARD' ? label : null,
          },
        ];
      case 'payment-failed':
        return [
          {
            ...base,
            type: 'payment-failed',
            decline: { code: text(data.code), declineCode: text(data.declineCode) },
          },
        ];
      case 'ready':
        return [{ ...base, type: 'ready', lateMinutes: count(data.lateMinutes) }];
      case 'undone': {
        const undid = oneOf(FORWARD_MOVES, data.undid);
        return undid ? [{ ...base, type: 'undone', undid }] : [];
      }
      case 'moved-back': {
        const reason = oneOf(MOVE_BACK_REASONS, data.reason);
        return reason ? [{ ...base, type: 'moved-back', reason, note }] : [];
      }
      case 'refused': {
        const reason = oneOf(REFUSE_REASONS, data.reason);
        return reason
          ? [
              {
                ...base,
                type: 'refused',
                reason,
                dishes: dishTitles(lines, stringList(data.lineIds)),
                note,
              },
            ]
          : [];
      }
      case 'cancelled': {
        const staff = data.actor === 'staff';
        return [
          {
            ...base,
            type: 'cancelled',
            reason: staff ? 'staff' : data.actor === 'customer' ? 'customer' : 'payment-expired',
            code: staff ? oneOf(CANCEL_CODES, data.reason) : null,
            dishes: staff ? dishTitles(lines, stringList(data.lineIds)) : [],
            note: staff ? note : null,
          },
        ];
      }
      case 'refunded':
        return [
          {
            ...base,
            type: 'refunded',
            amountCents: kitchen ? null : count(data.amountCents),
            cardLabel: kitchen ? null : label,
          },
        ];
      case 'picked-up':
        return [{ ...base, type: 'picked-up', reason: oneOf(HANDOVER_REASONS, data.reason), note }];
      case 'delivered':
        return [
          {
            ...base,
            type: 'delivered',
            reason: oneOf(HANDOVER_REASONS, data.reason),
            note,
            cashCollectedCents: kitchen ? null : count(data.cashCollectedCents),
          },
        ];
      case 'dispute-closed':
        return [{ ...base, type: 'dispute-closed', outcome: text(data.status) }];
      case 'sold-out':
        return [{ ...base, type: 'sold-out', dishes: stringList(data.dishes) }];
      default: {
        // F7 (design 2.5): courier milestones, named from the caller's (masked) name map.
        const milestone = COURIER_MILESTONES.find((name) => `courier-${name}` === event.type);
        if (!milestone) return [];
        const partnerId = text(data.partnerId);
        const courierName = partnerId ? (courierNames.get(partnerId) ?? null) : null;
        const reason = text(data.reason);
        const staff = base.by.kind === 'staff' ? { name: base.by.name, role: base.by.role } : null;
        const pickupM = typeof data.pickupM === 'number' ? data.pickupM : null;
        return [
          {
            ...base,
            type: 'courier',
            event: milestone,
            courierName,
            reason,
            note: kitchen ? null : note,
            words: courierTimelineWords({ event: milestone, courierName, staff, reason, pickupM }),
          },
        ];
      }
    }
  });
}

// ------------------------------------------------------------------ the detail (A10)

/** Where a refund Foodz started stands (A7.6). */
export function refundStateOf(
  order: OrderFacts,
  events: readonly EventFacts[],
  now: Date,
): { state: RefundState; amountCents: number | null; since: string | null } {
  const lastRefund = events.findLast((event) => event.type === 'refunded');
  if (order.status === 'CANCELLED' && refundKindOf(order) === 'sample') {
    return { state: 'sample', amountCents: null, since: null };
  }
  const pending =
    order.autoRefundReason !== null &&
    order.paymentMethod === 'CARD' &&
    order.hasPaymentIntent &&
    paidStatus(order.paymentStatus) &&
    refundableCents(order) > 0;
  if (pending) {
    const since = order.cancelledAt ?? order.updatedAt;
    const slow = now.getTime() - since.getTime() > REFUND_SLOW_AFTER_MINUTES * MINUTE_MS;
    return {
      state: slow ? 'slow' : 'pending',
      amountCents: refundableCents(order),
      since: since.toISOString(),
    };
  }
  if (order.refundedCents > 0) {
    return {
      state: 'done',
      amountCents: order.refundedCents,
      since: lastRefund?.createdAt.toISOString() ?? null,
    };
  }
  return { state: 'none', amountCents: null, since: null };
}

export function detailActionsOf(
  viewer: Viewer,
  order: OrderFacts,
  events: readonly EventFacts[],
  stepUpFreshUntil: Date | null,
  now: Date,
): DetailActions {
  const can = abilitiesFor(viewer);
  const status = order.status;
  const next = NEXT_STEP[status];
  const previous = PREVIOUS_STEP[status];
  return {
    next: can.move && next ? next : null,
    undo: can.undo ? undoOf(order, events, viewer.userId, now) : null,
    moveBack: can.moveBack && previous ? { to: previous } : null,
    refuse: can.refuse && status === 'PLACED',
    cancel:
      can.cancel && STAFF_CANCELLABLE.includes(status)
        ? { stepUp: !viewer.isDemo && stepUpNeeded(stepUpFacts(order), stepUpFreshUntil, now) }
        : null,
    pickUp: can.handOver && status === 'READY',
    deliver:
      can.handOver && status === 'PICKED_UP'
        ? {
            cashToCollectCents:
              order.paymentMethod === 'CASH' && order.paymentStatus === 'UNPAID'
                ? order.totalCents
                : null,
          }
        : null,
    readOnly: viewer.isDemo,
  };
}

function cancellationOf(
  order: OrderFacts,
  lines: readonly LineFacts[],
  events: readonly EventFacts[],
) {
  if (order.status !== 'CANCELLED' || !order.cancelledAt) return null;
  const reason = oneOf(
    ['customer', 'payment-expired', 'account-deleted', 'staff', 'kitchen-refused'] as const,
    order.cancelReason,
  );
  if (!reason) return null;
  const event = events.findLast((entry) =>
    ['cancelled', 'refused', 'expired'].includes(entry.type),
  );
  return {
    reason,
    code: oneOf(CANCEL_CODES, order.cancelCode),
    dishes: dishTitles(lines, order.cancelLineIds),
    by: event ? actorOf(event) : ({ kind: 'system' } as const),
    at: order.cancelledAt.toISOString(),
  };
}

export function toDetail(
  viewer: Viewer,
  order: OrderFacts,
  lines: readonly LineFacts[],
  events: readonly EventFacts[],
  soldOut: ReadonlySet<string>,
  stepUpFreshUntil: Date | null,
  now: Date,
  courierNames: ReadonlyMap<string, string> = new Map(),
): StaffOrderDetail {
  const readyBy = readyByOf(order);
  const promised =
    order.placedAt && order.arrivalFromMinutes !== null && order.arrivalToMinutes !== null
      ? {
          from: new Date(
            order.placedAt.getTime() + order.arrivalFromMinutes * MINUTE_MS,
          ).toISOString(),
          to: new Date(order.placedAt.getTime() + order.arrivalToMinutes * MINUTE_MS).toISOString(),
        }
      : null;
  const base = {
    asOf: now.toISOString(),
    id: order.id,
    number: order.number,
    status: order.status,
    version: order.version,
    onBoard: isOnBoardFor(viewer.role, order.status),
    createdAt: order.createdAt.toISOString(),
    placedAt: iso(order.placedAt),
    acceptedAt: iso(order.acceptedAt),
    preparingAt: iso(order.preparingAt),
    readyAt: iso(order.readyAt),
    pickedUpAt: iso(order.pickedUpAt),
    deliveredAt: iso(order.deliveredAt),
    cancelledAt: iso(order.cancelledAt),
    readyBy: iso(readyBy),
    promised,
    howItWent: {
      acceptedAfterMinutes: minutesBetween(order.placedAt, order.acceptedAt),
      cookedInMinutes: minutesBetween(order.preparingAt ?? order.acceptedAt, order.readyAt),
      readyLateMinutes: readyLateMinutes(order),
    },
    kitchenNote: order.note,
    cancellation: cancellationOf(order, lines, events),
    timeline: timelineOf(viewer, order, lines, events, courierNames),
    actions: detailActionsOf(viewer, order, events, stepUpFreshUntil, now),
    masked: { customer: order.masked, kitchenNote: order.masked && order.note !== null },
  };
  const boardLines = linesOf(lines, soldOut);
  const refund = refundStateOf(order, events, now);
  const method = order.paymentMethod === 'CARD' ? ('card' as const) : ('cash' as const);
  if (isKitchenView(viewer.role)) {
    return {
      ...base,
      view: 'kitchen',
      lines: boardLines,
      customer: { firstName: firstNameOf(order.contactName) },
      payment: { method, paid: order.paymentStatus !== 'UNPAID', refund: refund.state },
    };
  }
  const phone = order.masked ? null : order.contactPhone || null;
  const lastDecline = events.findLast((event) => event.type === 'payment-failed');
  return {
    ...base,
    view: 'full',
    lines: lines.map((line) => ({
      id: line.id,
      dishId: line.dishId,
      title: line.title,
      quantity: line.quantity,
      flavors: line.flavors,
      note: line.note,
      soldOut: soldOut.has(line.dishId),
      unitPriceCents: line.unitPriceCents,
      lineTotalCents: line.unitPriceCents * line.quantity,
    })),
    customer: {
      name: order.contactName,
      firstName: firstNameOf(order.contactName),
      phone,
      phoneDisplay: phone ? displayPhone(phone).display : order.contactPhone,
      address: {
        label: order.addressLabel,
        line1: order.addressLine1 ?? order.addressText,
        line2: order.addressLine2,
        city: order.addressCity,
      },
      instructions: order.courierInstructions,
      distanceKm: order.distanceKm,
    },
    money: {
      subtotalCents: order.subtotalCents,
      promo:
        order.discountCents > 0 || order.deliveryDiscountCents > 0 || order.promoCode
          ? {
              code: order.promoCode,
              foodDiscountCents: order.discountCents,
              freeDelivery: order.deliveryDiscountCents > 0,
            }
          : null,
      deliveryFeeCents: order.deliveryFeeCents,
      deliveryDiscountCents: order.deliveryDiscountCents,
      taxCents: order.taxCents,
      taxRateBps: order.taxRateBps,
      tipCents: order.tipCents,
      totalCents: order.totalCents,
      method,
      cardLabel: method === 'card' ? cardLabelOf(order) : null,
      paymentStatus: order.paymentStatus,
      refundedCents: order.refundedCents,
      refund,
      dispute: {
        status: order.disputeStatus,
        openedAt: iso(order.disputeOpenedAt),
        closedAt: iso(order.disputeClosedAt),
      },
      decline:
        order.status === 'FAILED' && lastDecline
          ? {
              code: text(asRecord(lastDecline.data).code),
              declineCode: text(asRecord(lastDecline.data).declineCode),
            }
          : null,
      paidLate: events.some((event) => event.type === 'revived'),
    },
  };
}

// ------------------------------------------------------------------ the dialogs (design 3.2, 3.3)

export function toCancelPreview(
  viewer: Viewer,
  order: OrderFacts,
  lines: readonly LineFacts[],
  soldOut: ReadonlySet<string>,
  stepUpFreshUntil: Date | null,
  now: Date,
): CancelPreview {
  const can = abilitiesFor(viewer);
  const possible =
    !viewer.isDemo &&
    ((can.refuse && order.status === 'PLACED') ||
      (can.cancel && STAFF_CANCELLABLE.includes(order.status)));
  const kind = refundKindOf(order);
  const base = {
    orderId: order.id,
    number: order.number,
    status: order.status,
    version: order.version,
    possible,
    kitchenStarted: ['ACCEPTED', 'PREPARING', 'READY'].includes(order.status),
    lines: linesOf(lines, soldOut),
  };
  if (isKitchenView(viewer.role)) {
    return { ...base, view: 'kitchen', refund: kind === 'none' ? 'none' : 'card' };
  }
  return {
    ...base,
    view: 'full',
    refund:
      kind === 'card'
        ? {
            kind: 'card',
            amountCents: refundableCents(order),
            cardLabel: cardLabelOf(order),
            tipIncluded: order.tipCents > 0,
          }
        : { kind },
    codeToRelease: order.status === 'CANCELLED' ? null : order.promoCode,
    stepUpRequired:
      possible && can.cancel && stepUpNeeded(stepUpFacts(order), stepUpFreshUntil, now),
  };
}
