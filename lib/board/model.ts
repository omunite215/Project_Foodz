import type { OrderStatus } from '@/server/db/enums';
import {
  type BoardCard,
  type BoardColumn,
  type BoardStatus,
  COLUMN_OF,
  isBoardStatus,
  KITCHEN_BOARD_STATUSES,
  LATENESS,
} from '@/server/modules/board/schema';
import { cardTiming, isLate } from '@/server/modules/board/timing';
import type { OrderChangedEvent } from '@/lib/realtime/events';
import type { OrderChangedDetails } from '@/server/modules/board/schema';

/*
 * The order board's rules in the browser (F5 design 2): columns and their order, filters, how
 * a realtime event changes a card, how a fresh copy is merged, and who has waited too long.
 * Pure, so they are unit-tested and shared by the data layer and the components.
 */

export const COLUMN_ORDER: readonly BoardColumn[] = [
  'new',
  'accepted',
  'preparing',
  'ready',
  'outForDelivery',
];

export const STATUS_OF: Record<BoardColumn, BoardStatus> = {
  new: 'PLACED',
  accepted: 'ACCEPTED',
  preparing: 'PREPARING',
  ready: 'READY',
  outForDelivery: 'PICKED_UP',
};

/** Statuses a view shows: the kitchen has no "Out for delivery" (A2.1). */
export function statusesOf(view: 'kitchen' | 'full'): readonly BoardStatus[] {
  return view === 'kitchen'
    ? KITCHEN_BOARD_STATUSES
    : COLUMN_ORDER.map((column) => STATUS_OF[column]);
}

export const onBoardFor = (view: 'kitchen' | 'full', status: OrderStatus) =>
  isBoardStatus(status) && statusesOf(view).includes(status);

/**
 * When a card's place in its column was set (A2.2): placed for New, Accepted and Preparing;
 * ready for Ready; picked up for Out for delivery. Oldest first.
 */
export function placeTime(card: BoardCard): number {
  if (card.status === 'READY') return Date.parse(card.readyAt ?? card.placedAt);
  if (card.status === 'PICKED_UP') return Date.parse(card.pickedUpAt ?? card.placedAt);
  return Date.parse(card.placedAt);
}

export const byPlace = (a: BoardCard, b: BoardCard) =>
  placeTime(a) - placeTime(b) || a.number.localeCompare(b.number, 'en', { numeric: true });

/** Cards per column, each column oldest first. */
export function groupByColumn(
  cards: readonly BoardCard[],
  columns: readonly BoardColumn[],
): Record<BoardColumn, BoardCard[]> {
  const grouped: Record<BoardColumn, BoardCard[]> = {
    new: [],
    accepted: [],
    preparing: [],
    ready: [],
    outForDelivery: [],
  };
  for (const card of cards) {
    const column = COLUMN_OF[card.status];
    if (columns.includes(column)) grouped[column].push(card);
  }
  for (const column of COLUMN_ORDER) grouped[column].sort(byPlace);
  return grouped;
}

// ------------------------------------------------------------------ filters (A11.2)

export interface BoardFilters {
  late: boolean;
  pay: 'cash' | 'card' | null;
}

export const NO_FILTERS: BoardFilters = { late: false, pay: null };

export function parseFilters(params: { get(name: string): string | null }): BoardFilters {
  const pay = params.get('pay');
  return {
    late: params.get('late') === '1',
    pay: pay === 'cash' || pay === 'card' ? pay : null,
  };
}

/** "late=1&pay=cash"; empty without filters. */
export function filtersQuery(filters: BoardFilters): string {
  const params = new URLSearchParams();
  if (filters.late) params.set('late', '1');
  if (filters.pay) params.set('pay', filters.pay);
  return params.toString();
}

export const hasFilters = (filters: BoardFilters) => filters.late || filters.pay !== null;

export function lateNow(card: BoardCard, now: Date, thresholds: typeof LATENESS): boolean {
  return isLate(cardTiming(card, now, thresholds));
}

export function matchesFilters(card: BoardCard, filters: BoardFilters, late: boolean): boolean {
  if (filters.late && !late) return false;
  if (filters.pay && card.payment.method !== filters.pay) return false;
  return true;
}

// ------------------------------------------------------------------ realtime (A12.5)

/**
 * What a `private-ops` event means for the card the board holds:
 * - `ignore`: older than the card, a repeat, or about an order this board never shows;
 * - `apply`: a new status on the board, taken from the event itself;
 * - `fetch`: a new order, an order that left (the fetch says who cancelled it), or a change
 *   that left the status alone (money flags) for a view that shows money.
 */
export type EventVerdict = 'ignore' | 'apply' | 'fetch';

export function eventVerdict(
  card: BoardCard | undefined,
  event: OrderChangedEvent,
  view: 'kitchen' | 'full',
): EventVerdict {
  const onBoard = onBoardFor(view, event.status);
  if (!card) return onBoard ? 'fetch' : 'ignore';
  if (event.version <= card.version) return 'ignore';
  if (!onBoard) return 'fetch';
  if (event.status === card.status) return view === 'full' ? 'fetch' : 'apply';
  return 'apply';
}

const STEP_FIELD: Partial<Record<OrderStatus, keyof BoardCard>> = {
  ACCEPTED: 'acceptedAt',
  PREPARING: 'preparingAt',
  READY: 'readyAt',
  PICKED_UP: 'pickedUpAt',
};

const STEP_ORDER: readonly OrderStatus[] = [
  'PLACED',
  'ACCEPTED',
  'PREPARING',
  'READY',
  'PICKED_UP',
];

/**
 * A card after a status change: the step time comes from the change's server time, and a step
 * taken back clears the times after it (undo and move back, contract §4). Someone else's change
 * ends this person's Undo.
 */
export function withStatus(
  card: BoardCard,
  status: BoardStatus,
  version: number,
  at: string,
): BoardCard {
  const next: BoardCard = { ...card, status, version, undo: null };
  const to = STEP_ORDER.indexOf(status);
  const from = STEP_ORDER.indexOf(card.status);
  if (to > from) {
    const field = STEP_FIELD[status];
    if (field) Object.assign(next, { [field]: at });
  } else {
    for (const later of STEP_ORDER.slice(to + 1)) {
      const field = STEP_FIELD[later];
      if (field) Object.assign(next, { [field]: null });
    }
  }
  return next;
}

/** A step taken back (undo, move back), for "Order 1042 moved back to Accepted". */
export const isStepBack = (from: OrderStatus, to: OrderStatus) =>
  STEP_ORDER.indexOf(to) < STEP_ORDER.indexOf(from);

export function applyEvent(card: BoardCard, event: OrderChangedEvent): BoardCard {
  if (!isBoardStatus(event.status)) return card;
  if (event.status === card.status) return { ...card, version: event.version };
  return withStatus(card, event.status, event.version, event.at);
}

/**
 * A fresh copy of the board merged with what the screen holds (A12.4, A12.5): the server's
 * list wins for which cards exist, but a card the screen already holds at a newer version (an
 * event that arrived while the copy was on its way) is kept.
 */
export function mergeCards(
  current: readonly BoardCard[],
  incoming: readonly BoardCard[],
): BoardCard[] {
  const held = new Map(current.map((card) => [card.id, card]));
  return incoming.map((card) => {
    const mine = held.get(card.id);
    return mine && mine.version > card.version ? mine : card;
  });
}

export interface BoardDiff {
  added: string[];
  changed: string[];
  removed: string[];
}

/** What a fresh copy changed: "Back online. 2 orders changed while you were away." (A12.3). */
export function diffCards(before: readonly BoardCard[], after: readonly BoardCard[]): BoardDiff {
  const old = new Map(before.map((card) => [card.id, card]));
  const fresh = new Set(after.map((card) => card.id));
  const added: string[] = [];
  const changed: string[] = [];
  for (const card of after) {
    const previous = old.get(card.id);
    if (!previous) added.push(card.id);
    else if (previous.version !== card.version) changed.push(card.id);
  }
  const removed = before.filter((card) => !fresh.has(card.id)).map((card) => card.id);
  return { added, changed, removed };
}

export const diffCount = (diff: BoardDiff) =>
  diff.added.length + diff.changed.length + diff.removed.length;

// ------------------------------------------------------------------ waiting (A3.3, A3.6)

const MINUTE_MS = 60_000;
export const waitedMinutes = (card: BoardCard, now: Date) =>
  Math.max(0, Math.floor((now.getTime() - Date.parse(card.placedAt)) / MINUTE_MS));

/** New orders over `minutes` in New, oldest first: the orders-waiting banner. */
export function waitingOver(cards: readonly BoardCard[], now: Date, minutes: number): BoardCard[] {
  return cards
    .filter((card) => card.status === 'PLACED' && waitedMinutes(card, now) >= minutes)
    .toSorted(byPlace);
}

// ------------------------------------------------------------------ focus (A16.4, design 2.11)

/**
 * Where focus goes when a card leaves its column: the next card, or the one before it when it
 * was the last; null means the column heading (the column is empty now).
 */
export function neighbourAfterLeaving(ids: readonly string[], leaving: string): string | null {
  const index = ids.indexOf(leaving);
  if (index < 0) return null;
  return ids[index + 1] ?? ids[index - 1] ?? null;
}

// ------------------------------------------------------------------ phone tabs (design 2.3)

export function columnFromHash(
  hash: string,
  columns: readonly BoardColumn[],
  hashes: Record<BoardColumn, string>,
): BoardColumn | null {
  const wanted = hash.replace(/^#/, '');
  return columns.find((column) => hashes[column] === wanted) ?? null;
}

/** "Out for delivery" starts collapsed when five 232 px columns don't fit (design 2.1, D8). */
export const FIVE_COLUMNS_REM = 76.5;

/** `serverError.details` of an ORDER_CHANGED refusal (contract §2.1). */
export function isOrderChangedDetails(value: unknown): value is OrderChangedDetails {
  if (typeof value !== 'object' || value === null) return false;
  const current: unknown = Reflect.get(value, 'current');
  return (
    typeof Reflect.get(value, 'number') === 'string' &&
    typeof current === 'object' &&
    current !== null &&
    typeof Reflect.get(current, 'status') === 'string' &&
    typeof Reflect.get(current, 'version') === 'number'
  );
}

/** The staff name in an UNDO_NOT_ALLOWED refusal, for "Only Alex Kim can undo this…". */
export function undoMovedByName(details: unknown): string | null {
  if (typeof details !== 'object' || details === null) return null;
  const movedBy: unknown = Reflect.get(details, 'movedBy');
  if (typeof movedBy !== 'object' || movedBy === null) return null;
  if (Reflect.get(movedBy, 'kind') !== 'staff') return null;
  const name: unknown = Reflect.get(movedBy, 'name');
  return typeof name === 'string' ? name : null;
}
