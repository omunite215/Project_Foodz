import 'server-only';
import { z } from 'zod';
import { can, type Permission } from '@/server/auth/roles';
import { requirePermission, type UserActor } from '@/server/auth/session';
import { type DbContext, runAs } from '@/server/db/context';
import type { OrderStatus } from '@/server/db/enums';
import { AppError, forbidden, invalidInput, unauthenticated } from '@/server/errors';
import { logger } from '@/server/logger';
import { audit } from '@/server/modules/audit/service';
import {
  courierHolding,
  courierLines,
  courierSection,
  couriersCount,
} from '@/server/modules/delivery/service';
import { getStoreStatus } from '@/server/modules/menu/service';
import type { OrderEffect } from '@/server/modules/orders/effects';
import { readyLateMinutes } from '@/server/modules/orders/progress';
import { passStepUp, stepUpFreshUntilFor } from '@/server/modules/staff/service';
import { STEP_UP_WINDOW_MS } from '@/server/modules/staff/schema';
import { isRealtimeConfigured } from '@/server/realtime/config';
import { type BoardEffect, runBoardEffects } from './effects';
import {
  applyStatusChange,
  type BoardEventRow,
  type BoardLineRow,
  type BoardOrderRow,
  countRecentAudits,
  findDish,
  findOrder as findOrderRow,
  findOrderByNumber,
  findStaffName,
  insertEvent,
  listCardEvents,
  listDishes,
  listEvents,
  listLines,
  listOrdersByIds,
  listOrdersInStatuses,
  listSoldOutDishes,
  lockOrder,
  releaseOrderCode,
  setDishesAvailable,
  type StatusChange,
} from './repo';
import {
  BOARD_FIELD_ERRORS,
  type BoardCard,
  type BoardCardsResult,
  boardCardsInput,
  type BoardDish,
  type BoardRefusalDetails,
  type BoardSnapshot,
  type BoardStaffRole,
  type CancelPreview,
  COLUMN_OF,
  findOrderInput,
  type FindOrderResult,
  type ForwardMove,
  LATENESS,
  markDeliveredInput,
  markPickedUpInput,
  moveBackInput,
  moveEventData,
  movedBackEventData,
  moveOrderInput,
  type MoveResult,
  normalizeOrderNumber,
  REFUSAL_ALERT_AT,
  refuseOrderInput,
  setDishAvailabilityInput,
  type SetDishAvailabilityResult,
  STAFF_CANCEL_ALERT_AT,
  staffCancelEventData,
  staffCancelInput,
  type StaffCancelResult,
  type StaffOrderDetail,
  staffOrderInput,
  type StatusChangeResult,
  soldOutEventData,
  handOverEventData,
  isBoardStatus,
  UNDO_GRACE_MS,
  UNDO_WINDOW_MS,
  undoMoveInput,
  undoneEventData,
  type SoldOutDish,
} from './schema';
import {
  abilitiesFor,
  actorOf,
  boardStatusesFor,
  FORWARD_EVENT,
  goneOf,
  isKitchenView,
  isOnBoardFor,
  lastChangeOf,
  MOVE_EVENT,
  refundableCents,
  refundKindOf,
  sortCards,
  stepUpFacts,
  toCancelPreview,
  toCard,
  toDetail,
  type Viewer,
} from './shape';
import {
  cancelReasonFor,
  NEXT_STEP,
  PREVIOUS_STEP,
  STAFF_CANCELLABLE,
  staffTransitionAllowed,
  stepUpNeeded,
  undoUntil,
  undoVerdict,
  versionStillCurrent,
} from './state';
import {
  DEMO_CANNOT_CHANGE,
  invalidStateMessage,
  orderChangedMessage,
  storeLabel,
  undoRefusedMessage,
} from './text';

/*
 * The staff order board (F5). Every function re-checks the caller (role, two-factor, demo) even
 * though the action wrapper did (A1.10), decides the role's shape on the server, and writes as
 * the caller, so row-level security and the orders guard trigger apply as a second layer. A
 * change locks the order row and checks, in this order: not found, a replay of the caller's
 * own change, the status changed since the version the person saw (ORDER_CHANGED), the action
 * fits the status for this role (INVALID_STATE), the step-up code; then it writes. A refusal
 * changes nothing and writes no event. Realtime, notices, emails, refunds and jobs run after
 * the commit.
 */

const MINUTE_MS = 60_000;
/** A refusal or cancellation pressed again within this long answers the first one (A7.5). */
const CANCEL_REPLAY_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const READ = { order: ['read-any'] } as const satisfies Permission;

const orderNotFound = () => new AppError('NOT_FOUND', 'Order not found.', 404);

function refusal<K extends keyof BoardRefusalDetails>(
  code: K,
  message: string,
  status: number,
  details: BoardRefusalDetails[K],
): AppError {
  return new AppError(code, message, status, { details: { ...details } });
}

/** The wrapper's checks again, for the person the service acts for (A1.10). */
async function requireBoard(actor: UserActor, permission: Permission, write: boolean) {
  const checked = await requirePermission(permission, { write, demoMessage: DEMO_CANNOT_CHANGE });
  if (checked.userId !== actor.userId) throw unauthenticated();
  return { userId: checked.userId, role: checked.role, isDemo: checked.isDemo } satisfies Viewer;
}

const staffRole = (viewer: Viewer): BoardStaffRole => {
  if (viewer.role === 'kitchen' || viewer.role === 'support' || viewer.role === 'admin') {
    return viewer.role;
  }
  throw forbidden();
};

async function storeTimeZone(now: Date) {
  return (await getStoreStatus(now)).timeZone;
}

/** The person's name and role as the timeline keeps them (a snapshot, not a link). */
async function eventActor(ctx: DbContext, viewer: Viewer) {
  const name = (await findStaffName(ctx, viewer.userId)) ?? 'Staff member';
  return { name: name.slice(0, 120), role: staffRole(viewer) };
}

function orderChanged(
  order: BoardOrderRow,
  events: readonly BoardEventRow[],
  timeZone: string,
  wanted?: OrderStatus,
): AppError {
  const details: BoardRefusalDetails['ORDER_CHANGED'] = {
    orderId: order.id,
    number: order.number,
    current: { status: order.status, version: order.version },
    lastChange: lastChangeOf(events),
  };
  return refusal('ORDER_CHANGED', orderChangedMessage(details, timeZone, wanted), 409, details);
}

const invalidState = (
  action: Parameters<typeof invalidStateMessage>[0],
  order: BoardOrderRow,
): AppError =>
  refusal('INVALID_STATE', invalidStateMessage(action, order.number, order.status), 409, {
    orderId: order.id,
    number: order.number,
    status: order.status,
  });

async function loadLocked(ctx: DbContext, orderId: string) {
  if (!(await lockOrder(ctx, orderId))) throw orderNotFound();
  const order = await findOrderRow(ctx, orderId);
  if (!order) throw orderNotFound();
  return { order, events: await listEvents(ctx, orderId) };
}

const STEP_TIME: Partial<Record<OrderStatus, keyof StatusChange>> = {
  ACCEPTED: 'acceptedAt',
  PREPARING: 'preparingAt',
  READY: 'readyAt',
  PICKED_UP: 'pickedUpAt',
};

/** Sets the time of the step an order moves to. */
function stepTimeOf(to: ForwardMove, at: Date): Partial<StatusChange> {
  const field = STEP_TIME[to];
  return field ? { [field]: at } : {};
}

/** Clears the time of the step an order is leaving (Undo, Move back). */
function clearingStep(from: OrderStatus): Partial<StatusChange> {
  const field = STEP_TIME[from];
  return field ? { [field]: null } : {};
}

async function soldOutDishIds(ctx: DbContext) {
  return new Set((await listSoldOutDishes(ctx)).map((dish) => dish.id));
}

const linesFor = (lines: readonly BoardLineRow[], orderId: string) =>
  lines.filter((line) => line.orderId === orderId);

const eventsFor = (events: readonly BoardEventRow[], orderId: string) =>
  events.filter((event) => event.orderId === orderId);

/** A real (not demo or sample) staff member's name is never shown to the demo admin. */
function soldOutName(
  viewer: Viewer,
  by: { name: string; isDemo: boolean; isSample: boolean } | null,
) {
  if (!by) return null;
  return viewer.isDemo && !by.isDemo && !by.isSample ? null : by.name;
}

// ------------------------------------------------------------------ reads

async function readCards(
  ctx: DbContext,
  viewer: Viewer,
  orders: readonly BoardOrderRow[],
  now: Date,
) {
  const ids = orders.map((order) => order.id);
  const since = new Date(now.getTime() - UNDO_WINDOW_MS - UNDO_GRACE_MS);
  const lines = await listLines(ctx, ids);
  const events = await listCardEvents(ctx, ids, viewer.userId, since);
  const soldOut = await soldOutDishIds(ctx);
  return { lines, events, soldOut };
}

/** The board as the caller's role sees it, for the server render and every refresh (A2). */
export async function getBoard(actor: UserActor, now = new Date()): Promise<BoardSnapshot> {
  const viewer = await requireBoard(actor, READ, false);
  const store = await getStoreStatus(now);
  const statuses = boardStatusesFor(viewer.role);
  const snapshot = await runAs(actor, async (ctx): Promise<BoardSnapshot> => {
    const orders = await listOrdersInStatuses(ctx, statuses);
    const { lines, events, soldOut } = await readCards(ctx, viewer, orders, now);
    const cards = orders.map((order) =>
      toCard(viewer, order, linesFor(lines, order.id), eventsFor(events, order.id), soldOut, now),
    );
    const dishes = await listSoldOutDishes(ctx);
    return {
      asOf: now.toISOString(),
      view: isKitchenView(viewer.role) ? 'kitchen' : 'full',
      columns: statuses.map((status) => COLUMN_OF[status]),
      cards: sortCards(cards),
      store: {
        isOpen: store.isOpen,
        label: storeLabel(store),
        closesAt: store.closesAt,
        opensAt: store.opensAt,
        timeZone: store.timeZone,
      },
      thresholds: LATENESS,
      soldOut: dishes.map((dish): SoldOutDish => ({
        dishId: dish.id,
        title: dish.title,
        since: dish.soldOutAt?.toISOString() ?? null,
        byName: soldOutName(viewer, dish.soldOutBy),
      })),
      can: abilitiesFor(viewer),
      realtime: { configured: isRealtimeConfigured() },
    };
  });
  // F7: courier lines and the couriers count, read after the board's own transaction.
  const cards = await withCouriers(viewer, snapshot.cards, now);
  return { ...snapshot, cards, couriers: await couriersCount() };
}

/** A34.1: each Ready and Out-for-delivery card's courier line, in one read for the page. */
async function withCouriers(viewer: Viewer, cards: BoardCard[], now: Date): Promise<BoardCard[]> {
  const lines = await courierLines(
    viewer,
    cards.map((card) => ({
      id: card.id,
      status: card.status,
      readyAt: card.readyAt ? new Date(card.readyAt) : null,
    })),
    now,
  );
  return cards.map((card) => Object.assign(card, { courier: lines.get(card.id) ?? null }));
}

/** Cards for orders named by realtime events; orders that left come back in `gone`. */
export async function getBoardCards(
  actor: UserActor,
  input: unknown,
  now = new Date(),
): Promise<BoardCardsResult> {
  const { orderIds } = boardCardsInput.parse(input);
  const viewer = await requireBoard(actor, READ, false);
  return runAs(actor, async (ctx) => {
    const orders = await listOrdersByIds(ctx, orderIds);
    const { lines, events, soldOut } = await readCards(ctx, viewer, orders, now);
    const cards: BoardCard[] = [];
    const gone: BoardCardsResult['gone'] = [];
    for (const order of orders) {
      const own = eventsFor(events, order.id);
      if (isOnBoardFor(viewer.role, order.status)) {
        cards.push(toCard(viewer, order, linesFor(lines, order.id), own, soldOut, now));
      } else {
        const left = goneOf(viewer, order, own);
        if (left) gone.push(left);
      }
    }
    return { asOf: now.toISOString(), cards: sortCards(cards), gone };
  }).then(async (result) => ({ ...result, cards: await withCouriers(viewer, result.cards, now) }));
}

async function readOrder(actor: UserActor, orderId: string) {
  return runAs(actor, async (ctx) => {
    const order = await findOrderRow(ctx, orderId);
    if (!order) return null;
    return {
      order,
      lines: await listLines(ctx, [orderId]),
      events: await listEvents(ctx, orderId),
      soldOut: await soldOutDishIds(ctx),
    };
  });
}

/** The detail (A10); null for an unknown id, which the page answers with 404. */
export async function getStaffOrderDetail(
  actor: UserActor,
  orderId: string,
  now = new Date(),
): Promise<StaffOrderDetail | null> {
  const parsed = staffOrderInput.safeParse({ orderId });
  if (!parsed.success) return null;
  const viewer = await requireBoard(actor, READ, false);
  const found = await readOrder(actor, parsed.data.orderId);
  if (!found) return null;
  const fresh = viewer.isDemo ? null : await stepUpFreshUntilFor(actor, now);
  const detail = toDetail(
    viewer,
    found.order,
    found.lines,
    found.events,
    found.soldOut,
    fresh,
    now,
  );
  return { ...detail, courierSection: await courierSection(viewer, found.order, now) };
}

/** The refuse and cancel dialogs' opening data, shaped by role (design 3.2, 3.3). */
export async function getCancelPreview(
  actor: UserActor,
  orderId: string,
  now = new Date(),
): Promise<CancelPreview> {
  const parsed = staffOrderInput.safeParse({ orderId });
  if (!parsed.success) throw orderNotFound();
  const viewer = await requireBoard(actor, READ, false);
  const found = await readOrder(actor, parsed.data.orderId);
  if (!found) throw orderNotFound();
  const fresh = viewer.isDemo ? null : await stepUpFreshUntilFor(actor, now);
  return toCancelPreview(viewer, found.order, found.lines, found.soldOut, fresh, now);
}

/** Exact order number, any date (A11.1). */
/** The number to look for: the typed query, or a number the action already normalised. */
function orderNumberOf(input: unknown): string {
  const normalised = z
    .object({ number: z.string().max(12) })
    .strict()
    .safeParse(input);
  if (normalised.success) {
    const number = normalizeOrderNumber(normalised.data.number);
    if (number) return number;
  }
  return findOrderInput.parse(input).number;
}

export async function findOrder(actor: UserActor, input: unknown): Promise<FindOrderResult> {
  const number = orderNumberOf(input);
  const viewer = await requireBoard(actor, READ, false);
  const found = await runAs(actor, (ctx) => findOrderByNumber(ctx, number));
  if (!found) return { kind: 'none', number };
  if (isOnBoardFor(viewer.role, found.status) && isBoardStatus(found.status)) {
    return { kind: 'onBoard', orderId: found.id, number: found.number, status: found.status };
  }
  return { kind: 'offBoard', orderId: found.id, number: found.number, status: found.status };
}

/** Every dish with its availability, for the "Dish availability" sheet (design 4.2). */
export async function listBoardDishes(actor: UserActor): Promise<{ dishes: BoardDish[] }> {
  const viewer = await requireBoard(actor, READ, false);
  const dishes = await runAs(actor, listDishes);
  return {
    dishes: dishes.map((dish) => ({
      dishId: dish.id,
      title: dish.title,
      cuisine: dish.cuisine,
      available: dish.isAvailable,
      soldOutSince: dish.isAvailable ? null : (dish.soldOutAt?.toISOString() ?? null),
      soldOutByName: dish.isAvailable ? null : soldOutName(viewer, dish.soldOutBy),
    })),
  };
}

// ------------------------------------------------------------------ moving (A4, A5)

/** Accept, Start cooking, Mark ready (A4, A5). */
export async function moveOrder(
  actor: UserActor,
  input: unknown,
  now = new Date(),
): Promise<MoveResult> {
  const { orderId, to, expectedVersion } = moveOrderInput.parse(input);
  const viewer = await requireBoard(actor, { order: ['update-status'] }, true);
  const role = staffRole(viewer);
  const timeZone = await storeTimeZone(now);

  const outcome = await runAs(actor, async (ctx) => {
    const { order, events } = await loadLocked(ctx, orderId);

    // A double tap (A4.6): the caller's own move to the same step, still the last change.
    const own = events.findLast(
      (event) => event.type === MOVE_EVENT[to] && event.actorId === viewer.userId,
    );
    const ownVersion = moveEventData.safeParse(own?.data).data?.versionAfter;
    if (
      own &&
      order.status === to &&
      ownVersion === order.statusChangedVersion &&
      now.getTime() - own.createdAt.getTime() <= UNDO_WINDOW_MS + UNDO_GRACE_MS
    ) {
      return {
        result: {
          orderId,
          number: order.number,
          status: to,
          version: order.version,
          at: own.createdAt.toISOString(),
          eventId: own.id,
          undoUntil: undoUntil(own.createdAt).toISOString(),
          replayed: true,
        } satisfies MoveResult,
        effects: [] as BoardEffect[],
      };
    }

    if (!versionStillCurrent(order, expectedVersion)) {
      throw orderChanged(order, events, timeZone, to);
    }
    if (NEXT_STEP[order.status] !== to || !staffTransitionAllowed(role, order.status, to)) {
      throw invalidState('move', order);
    }

    const by = await eventActor(ctx, viewer);
    const version = await applyStatusChange(ctx, orderId, order.version, {
      status: to,
      ...stepTimeOf(to, now),
    });
    const lateMinutes = to === 'READY' ? readyLateMinutes({ ...order, readyAt: now }) : undefined;
    const event = await insertEvent(ctx, {
      orderId,
      type: MOVE_EVENT[to],
      fromStatus: order.status,
      toStatus: to,
      actorId: viewer.userId,
      data: moveEventData.parse({
        by,
        versionAfter: version,
        ...(to === 'READY' && { lateMinutes: lateMinutes ?? null }),
      }),
      at: now,
    });
    const effects: BoardEffect[] = [
      { kind: 'order', effect: published(orderId, now, order.status) },
    ];
    if (to === 'ACCEPTED' || to === 'READY') {
      const step = to === 'ACCEPTED' ? 'accepted' : 'ready';
      effects.push({ kind: step, orderId, eventId: event.id, at: now });
      effects.push({ kind: 'stepNotice', orderId, step, eventId: event.id, at: now });
    }
    return {
      result: {
        orderId,
        number: order.number,
        status: to,
        version,
        at: now.toISOString(),
        eventId: event.id,
        undoUntil: undoUntil(now).toISOString(),
        replayed: false,
      } satisfies MoveResult,
      effects,
    };
  });
  await runBoardEffects(outcome.effects);
  return outcome.result;
}

const published = (orderId: string, at: Date, fromStatus: OrderStatus): OrderEffect => ({
  kind: 'publish',
  orderId,
  at: at.toISOString(),
  fromStatus,
});

/** Undo your own move within the window (A8.1, A8.2). */
export async function undoMove(
  actor: UserActor,
  input: unknown,
  now = new Date(),
): Promise<StatusChangeResult> {
  const { orderId, eventId } = undoMoveInput.parse(input);
  const viewer = await requireBoard(actor, { order: ['update-status'] }, true);
  const role = staffRole(viewer);

  const outcome = await runAs(actor, async (ctx) => {
    const { order, events } = await loadLocked(ctx, orderId);

    const undone = events.find(
      (event) =>
        event.type === 'undone' &&
        event.actorId === viewer.userId &&
        undoneEventData.safeParse(event.data).data?.eventId === eventId,
    );
    if (undone) {
      return {
        result: {
          orderId,
          number: order.number,
          status: order.status,
          version: order.version,
          at: undone.createdAt.toISOString(),
          eventId: undone.id,
          replayed: true,
        } satisfies StatusChangeResult,
        effects: [] as BoardEffect[],
      };
    }

    const move = events.find((event) => event.id === eventId);
    const undid = move ? FORWARD_EVENT[move.type] : undefined;
    const moveData = moveEventData.safeParse(move?.data).data;
    const movedBy = move ? actorOf(move) : null;
    const refuse = (why: 'expired' | 'notYours' | 'changed') =>
      refusal(
        'UNDO_NOT_ALLOWED',
        undoRefusedMessage(movedBy?.kind === 'staff' ? movedBy.name : null),
        409,
        { orderId, number: order.number, why, movedBy },
      );
    if (!move || !undid || !moveData || !move.fromStatus) throw refuse('changed');
    const verdict = undoVerdict(
      { actorId: move.actorId, at: move.createdAt, versionAfter: moveData.versionAfter },
      order,
      viewer.userId,
      now,
    );
    if (verdict !== 'ok') throw refuse(verdict);
    const back = move.fromStatus;
    if (order.status !== undid || !staffTransitionAllowed(role, order.status, back)) {
      throw refuse('changed');
    }

    const by = await eventActor(ctx, viewer);
    const version = await applyStatusChange(ctx, orderId, order.version, {
      status: back,
      ...clearingStep(order.status),
    });
    const event = await insertEvent(ctx, {
      orderId,
      type: 'undone',
      fromStatus: order.status,
      toStatus: back,
      actorId: viewer.userId,
      data: undoneEventData.parse({ by, eventId, undid }),
      at: now,
    });
    return {
      result: {
        orderId,
        number: order.number,
        status: back,
        version,
        at: now.toISOString(),
        eventId: event.id,
        replayed: false,
      } satisfies StatusChangeResult,
      effects: [
        { kind: 'order', effect: published(orderId, now, order.status) },
        { kind: 'reverted', orderId, from: order.status, to: back, eventId: event.id, at: now },
      ] satisfies BoardEffect[],
    };
  });
  await runBoardEffects(outcome.effects);
  return outcome.result;
}

/** ADMIN: one step back with a reason (A8.3). */
export async function moveBack(
  actor: UserActor,
  input: unknown,
  now = new Date(),
): Promise<StatusChangeResult> {
  const { orderId, expectedVersion, reason, note } = moveBackInput.parse(input);
  const viewer = await requireBoard(actor, { order: ['move-back'] }, true);
  const role = staffRole(viewer);
  const timeZone = await storeTimeZone(now);

  const outcome = await runAs(actor, async (ctx) => {
    const { order, events } = await loadLocked(ctx, orderId);
    if (!versionStillCurrent(order, expectedVersion)) throw orderChanged(order, events, timeZone);
    const back = PREVIOUS_STEP[order.status];
    if (!back || !staffTransitionAllowed(role, order.status, back)) {
      throw invalidState('moveBack', order);
    }
    if (reason === 'not-picked-up' && order.status !== 'PICKED_UP') {
      throw invalidInput(BOARD_FIELD_ERRORS.notPickedUp, {
        reason: [BOARD_FIELD_ERRORS.notPickedUp],
      });
    }

    const by = await eventActor(ctx, viewer);
    const version = await applyStatusChange(ctx, orderId, order.version, {
      status: back,
      ...clearingStep(order.status),
    });
    const event = await insertEvent(ctx, {
      orderId,
      type: 'moved-back',
      fromStatus: order.status,
      toStatus: back,
      actorId: viewer.userId,
      data: movedBackEventData.parse({ by, reason, ...(note && { note }) }),
      at: now,
    });
    await audit(ctx, {
      action: 'order.moved-back',
      targetType: 'order',
      targetId: orderId,
      data: { number: order.number, from: order.status, to: back, reason, hasNote: Boolean(note) },
    });
    return {
      result: {
        orderId,
        number: order.number,
        status: back,
        version,
        at: now.toISOString(),
        eventId: event.id,
        replayed: false,
      } satisfies StatusChangeResult,
      effects: [
        { kind: 'order', effect: published(orderId, now, order.status) },
        { kind: 'reverted', orderId, from: order.status, to: back, eventId: event.id, at: now },
      ] satisfies BoardEffect[],
    };
  });
  await runBoardEffects(outcome.effects);
  return outcome.result;
}

// ------------------------------------------------------------------ refusing and cancelling (A6, A7)

type Cancellation =
  | ReturnType<typeof refuseOrderInput.parse>
  | ReturnType<typeof staffCancelInput.parse>;

/** The caller's own refusal or cancellation of this order a moment ago (A7.5), if any. */
function replayedCancel(
  order: BoardOrderRow,
  events: readonly BoardEventRow[],
  viewer: Viewer,
  now: Date,
) {
  if (order.status !== 'CANCELLED') return null;
  const event = events.findLast((entry) => entry.type === 'refused' || entry.type === 'cancelled');
  if (!event || event.actorId !== viewer.userId) return null;
  if (now.getTime() - event.createdAt.getTime() > CANCEL_REPLAY_MS) return null;
  const data = staffCancelEventData.safeParse(event.data).data;
  if (!data) return null;
  const soldOut = events.find(
    (entry) =>
      entry.type === 'sold-out' &&
      entry.actorId === viewer.userId &&
      entry.createdAt.getTime() === event.createdAt.getTime(),
  );
  const sold = soldOutEventData.safeParse(soldOut?.data).data;
  const kitchen = isKitchenView(viewer.role);
  return {
    orderId: order.id,
    number: order.number,
    status: 'CANCELLED',
    version: order.version,
    at: event.createdAt.toISOString(),
    eventId: event.id,
    refund: data.sample
      ? { kind: 'sample' }
      : data.refundCents > 0
        ? { kind: 'card', amountCents: kitchen ? null : data.refundCents }
        : { kind: 'none' },
    codeReleased: kitchen ? null : data.codeReleased,
    soldOut: sold
      ? sold.dishIds.map((dishId, index) => ({ dishId, title: sold.dishes[index] ?? '' }))
      : [],
    replayed: true,
  } satisfies StaffCancelResult;
}

/** The checks before a refusal or cancellation: version, status for the role, the ticked lines. */
function checkCancellable(
  mode: 'refuse' | 'cancel',
  viewer: Viewer,
  order: BoardOrderRow,
  events: readonly BoardEventRow[],
  lines: readonly BoardLineRow[],
  input: Cancellation,
  timeZone: string,
) {
  if (!versionStillCurrent(order, input.expectedVersion)) {
    throw orderChanged(order, events, timeZone);
  }
  const role = staffRole(viewer);
  const fits =
    mode === 'refuse' ? order.status === 'PLACED' : STAFF_CANCELLABLE.includes(order.status);
  if (!fits || !staffTransitionAllowed(role, order.status, 'CANCELLED')) {
    throw invalidState(mode, order);
  }
  const own = new Set(lines.map((line) => line.id));
  if (input.lineIds.some((id) => !own.has(id))) {
    throw invalidInput(BOARD_FIELD_ERRORS.dishes, { lineIds: [BOARD_FIELD_ERRORS.dishes] });
  }
}

async function cancelFlow(
  actor: UserActor,
  mode: 'refuse' | 'cancel',
  input: Cancellation,
  stepUp: unknown,
  now: Date,
): Promise<StaffCancelResult> {
  const permission: Permission =
    mode === 'refuse' ? { order: ['refuse'] } : { order: ['cancel', 'read-any'] };
  const viewer = await requireBoard(actor, permission, true);
  if (input.markSoldOut && !can(viewer.role, { menu: ['update-availability'] })) {
    throw forbidden();
  }
  const timeZone = await storeTimeZone(now);
  const { orderId } = input;

  // A cancellation that refunds a card after Accept asks for a code first (A7.10). The code is
  // checked before the order is locked, so a wrong one changes nothing; the checks before it
  // run here too, so a stale screen hears ORDER_CHANGED rather than being asked for a code.
  let fresh: Date | null = null;
  let steppedUp = false;
  if (mode === 'cancel') {
    const current = await runAs(actor, async (ctx) => {
      const order = await findOrderRow(ctx, orderId);
      if (!order) return null;
      return {
        order,
        events: await listEvents(ctx, orderId),
        lines: await listLines(ctx, [orderId]),
      };
    });
    if (!current) throw orderNotFound();
    if (!replayedCancel(current.order, current.events, viewer, now)) {
      checkCancellable(mode, viewer, current.order, current.events, current.lines, input, timeZone);
      fresh = await stepUpFreshUntilFor(actor, now);
      if (stepUpNeeded(stepUpFacts(current.order), fresh, now)) {
        await passStepUp(actor, stepUp, now);
        steppedUp = true;
        fresh = new Date(now.getTime() + STEP_UP_WINDOW_MS);
      }
    }
  }

  const outcome = await runAs(actor, async (ctx) => {
    const { order, events } = await loadLocked(ctx, orderId);
    const replay = replayedCancel(order, events, viewer, now);
    if (replay) return { result: replay, effects: [] as BoardEffect[] };

    const lines = await listLines(ctx, [orderId]);
    checkCancellable(mode, viewer, order, events, lines, input, timeZone);
    if (mode === 'cancel' && stepUpNeeded(stepUpFacts(order), fresh, now)) {
      throw refusal(
        'STEP_UP_REQUIRED',
        'Enter a code from your authenticator app to continue.',
        403,
        {
          action: 'refund',
          windowMinutes: STEP_UP_WINDOW_MS / MINUTE_MS,
        },
      );
    }

    const kind = refundKindOf(order);
    const refundCents = kind === 'card' ? refundableCents(order) : 0;
    const by = await eventActor(ctx, viewer);
    const version = await applyStatusChange(ctx, orderId, order.version, {
      status: 'CANCELLED',
      cancelledAt: now,
      cancelReason: cancelReasonFor(staffRole(viewer)),
      cancelCode: input.reason,
      cancelLineIds: input.lineIds,
      ...(kind === 'card' && { autoRefundReason: 'staff-cancel' as const }),
    });
    const codeReleased = await releaseOrderCode(ctx, orderId);
    const ticked = lines.filter((line) => input.lineIds.includes(line.id));
    const dishes = [...new Set(ticked.map((line) => line.title))];
    const event = await insertEvent(ctx, {
      orderId,
      type: mode === 'refuse' ? 'refused' : 'cancelled',
      fromStatus: order.status,
      toStatus: 'CANCELLED',
      actorId: viewer.userId,
      data: staffCancelEventData.parse({
        actor: 'staff',
        by,
        reason: input.reason,
        lineIds: input.lineIds,
        dishes,
        ...(input.note && { note: input.note }),
        refundCents,
        refundAnnounced: kind === 'card',
        sample: kind === 'sample',
        codeReleased,
      }),
      at: now,
    });

    // "Also mark Pad Thai sold out" (design 3.2): in the same transaction, with its own entry.
    let soldOut: { id: string; title: string }[] = [];
    if (input.markSoldOut) {
      const dishIds = [...new Set(ticked.map((line) => line.dishId))];
      soldOut = await setDishesAvailable(ctx, dishIds, false, viewer.userId, now);
      if (soldOut.length > 0) {
        await insertEvent(ctx, {
          orderId,
          type: 'sold-out',
          fromStatus: null,
          toStatus: null,
          actorId: viewer.userId,
          data: soldOutEventData.parse({
            by,
            dishIds: soldOut.map((dish) => dish.id),
            dishes: soldOut.map((dish) => dish.title),
          }),
          at: now,
        });
        await soldOut.reduce(
          (previous, dish) =>
            previous.then(() =>
              audit(ctx, {
                action: 'menu.dish-sold-out',
                targetType: 'menu_item',
                targetId: dish.id,
                data: { dishId: dish.id, title: dish.title, from: 'order', orderId },
              }),
            ),
          Promise.resolve(),
        );
      }
    }

    const action = mode === 'refuse' ? 'order.refused' : 'order.cancelled-by-staff';
    await audit(ctx, {
      action,
      targetType: 'order',
      targetId: orderId,
      data: {
        orderId,
        number: order.number,
        reason: input.reason,
        dishes,
        refundCents,
        sample: kind === 'sample',
        codeReleased: codeReleased !== null,
        soldOut: soldOut.map((dish) => dish.id),
        hasNote: Boolean(input.note),
        ...(mode === 'cancel' && steppedUp && { stepUp: true }),
      },
    });
    const recent = await countRecentAudits(
      ctx,
      viewer.userId,
      action,
      new Date(now.getTime() - HOUR_MS),
    );
    const alertAt = mode === 'refuse' ? REFUSAL_ALERT_AT : STAFF_CANCEL_ALERT_AT;
    if (recent === alertAt) {
      logger.error(
        { userId: viewer.userId, action, count: recent, alert: `staff-${mode}-burst` },
        'one account is refusing or cancelling many orders',
      );
    }

    const effects: BoardEffect[] = [
      { kind: 'order', effect: published(orderId, now, order.status) },
      {
        kind: 'order',
        effect: {
          kind: 'email',
          orderId,
          email: 'cancelled',
          change: 'cancelled',
          ...(kind === 'card' && { refundCents, at: now.toISOString() }),
        },
      },
      ...(kind === 'card'
        ? [{ kind: 'order' as const, effect: { kind: 'refund' as const, orderId } }]
        : []),
      { kind: 'cancelled', orderId, at: now },
      ...soldOut.map((dish) => ({
        kind: 'dish' as const,
        dishId: dish.id,
        available: false,
        at: now,
      })),
    ];
    if (kind === 'sample') {
      logger.info({ orderId }, 'sample order cancelled; nothing to refund');
    }
    const kitchen = isKitchenView(viewer.role);
    return {
      result: {
        orderId,
        number: order.number,
        status: 'CANCELLED',
        version,
        at: now.toISOString(),
        eventId: event.id,
        refund:
          kind === 'card' ? { kind: 'card', amountCents: kitchen ? null : refundCents } : { kind },
        codeReleased: kitchen ? null : codeReleased,
        soldOut: soldOut.map((dish) => ({ dishId: dish.id, title: dish.title })),
        replayed: false,
      } satisfies StaffCancelResult,
      effects,
    };
  });
  await runBoardEffects(outcome.effects);
  return outcome.result;
}

/** "Can't make it" on a New order (A6). */
export async function refuseOrder(
  actor: UserActor,
  input: unknown,
  now = new Date(),
): Promise<StaffCancelResult> {
  return cancelFlow(actor, 'refuse', refuseOrderInput.parse(input), undefined, now);
}

/** SUPPORT, ADMIN: cancel from New to Ready; step-up for a card refund after Accept (A7). */
export async function staffCancelOrder(
  actor: UserActor,
  input: unknown,
  now = new Date(),
): Promise<StaffCancelResult> {
  const parsed = staffCancelInput.parse(input);
  return cancelFlow(actor, 'cancel', parsed, parsed.stepUp, now);
}

// ------------------------------------------------------------------ handing over (A9)

async function handOver(
  actor: UserActor,
  mode: 'pickUp' | 'deliver',
  input: ReturnType<typeof markPickedUpInput.parse> & { cashCollected?: boolean },
  now: Date,
): Promise<StatusChangeResult> {
  const viewer = await requireBoard(actor, { order: ['hand-over'] }, true);
  const role = staffRole(viewer);
  const timeZone = await storeTimeZone(now);
  const { orderId, expectedVersion, reason, note } = input;
  const from: OrderStatus = mode === 'pickUp' ? 'READY' : 'PICKED_UP';
  const to: OrderStatus = mode === 'pickUp' ? 'PICKED_UP' : 'DELIVERED';
  // F7: "Picked up by the assigned courier" only when a courier holds the order.
  if (mode === 'pickUp' && reason === 'assigned-courier' && !(await courierHolding(orderId))) {
    throw invalidInput(BOARD_FIELD_ERRORS.noCourier, { reason: [BOARD_FIELD_ERRORS.noCourier] });
  }

  const outcome = await runAs(actor, async (ctx) => {
    const { order, events } = await loadLocked(ctx, orderId);
    if (!versionStillCurrent(order, expectedVersion))
      throw orderChanged(order, events, timeZone, to);
    if (order.status !== from || !staffTransitionAllowed(role, from, to)) {
      throw invalidState(mode, order);
    }
    const collectsCash =
      mode === 'deliver' && order.paymentMethod === 'CASH' && order.paymentStatus === 'UNPAID';
    if (collectsCash && !input.cashCollected) {
      throw invalidInput(BOARD_FIELD_ERRORS.cashCollected, {
        cashCollected: [BOARD_FIELD_ERRORS.cashCollected],
      });
    }

    const by = await eventActor(ctx, viewer);
    const version = await applyStatusChange(ctx, orderId, order.version, {
      status: to,
      ...(mode === 'pickUp' ? { pickedUpAt: now } : { deliveredAt: now }),
      ...(collectsCash && { paymentStatus: 'PAID' as const }),
    });
    const cashCollectedCents = collectsCash ? order.totalCents : null;
    const event = await insertEvent(ctx, {
      orderId,
      type: mode === 'pickUp' ? 'picked-up' : 'delivered',
      fromStatus: from,
      toStatus: to,
      actorId: viewer.userId,
      data: handOverEventData.parse({ by, reason, ...(note && { note }), cashCollectedCents }),
      at: now,
    });
    await audit(ctx, {
      action: mode === 'pickUp' ? 'order.marked-picked-up' : 'order.marked-delivered',
      targetType: 'order',
      targetId: orderId,
      data:
        mode === 'pickUp'
          ? { number: order.number, reason }
          : { number: order.number, reason, cashCollectedCents },
    });
    const effects: BoardEffect[] = [
      { kind: 'order', effect: published(orderId, now, from) },
      {
        kind: 'dispatch',
        orderId,
        change:
          mode === 'deliver'
            ? 'delivered'
            : reason === 'assigned-courier'
              ? 'picked-up-by-courier'
              : 'handed-over',
      },
    ];
    // U23: no "On its way" notice when the customer collected it herself.
    if (mode === 'deliver' || reason !== 'customer-collected') {
      effects.push({
        kind: 'order',
        effect: { kind: 'notice', orderId, step: mode === 'pickUp' ? 'picked-up' : 'delivered' },
      });
    }
    return {
      result: {
        orderId,
        number: order.number,
        status: to,
        version,
        at: now.toISOString(),
        eventId: event.id,
        replayed: false,
      } satisfies StatusChangeResult,
      effects,
    };
  });
  await runBoardEffects(outcome.effects);
  return outcome.result;
}

/** ADMIN: Ready → Out for delivery by hand (A9). */
export async function markPickedUp(
  actor: UserActor,
  input: unknown,
  now = new Date(),
): Promise<StatusChangeResult> {
  return handOver(actor, 'pickUp', markPickedUpInput.parse(input), now);
}

/** ADMIN: Out for delivery → Delivered by hand; cash is confirmed and marked paid (A9.2). */
export async function markDelivered(
  actor: UserActor,
  input: unknown,
  now = new Date(),
): Promise<StatusChangeResult> {
  return handOver(actor, 'deliver', markDeliveredInput.parse(input), now);
}

// ------------------------------------------------------------------ "86 it"

/** "86 it": sold out or back on the menu (lead decision, design 4). */
export async function setDishAvailability(
  actor: UserActor,
  input: unknown,
  now = new Date(),
): Promise<SetDishAvailabilityResult> {
  const { dishId, available } = setDishAvailabilityInput.parse(input);
  const viewer = await requireBoard(actor, { menu: ['update-availability'] }, true);

  const outcome = await runAs(actor, async (ctx) => {
    const dish = await findDish(ctx, dishId);
    if (!dish) throw new AppError('NOT_FOUND', 'Dish not found.', 404);
    const changed = await setDishesAvailable(ctx, [dishId], available, viewer.userId, now);
    if (changed.length > 0) {
      await audit(ctx, {
        action: available ? 'menu.dish-back-on' : 'menu.dish-sold-out',
        targetType: 'menu_item',
        targetId: dishId,
        data: { dishId, title: dish.title, from: 'sheet' },
      });
    }
    return { title: dish.title, changed: changed.length > 0 };
  });
  if (outcome.changed) {
    await runBoardEffects([{ kind: 'dish', dishId, available, at: now }]);
  }
  return { dishId, title: outcome.title, available, changed: outcome.changed };
}
