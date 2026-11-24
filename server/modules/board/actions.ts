'use server';

import { userAction } from '@/server/action';
import { AppError } from '@/server/errors';
import {
  boardCardsInput,
  boardInput,
  findOrderInput,
  markDeliveredInput,
  markPickedUpInput,
  moveBackInput,
  moveOrderInput,
  refuseOrderInput,
  setDishAvailabilityInput,
  staffCancelInput,
  staffOrderInput,
  undoMoveInput,
} from './schema';
import {
  findOrder,
  getBoard,
  getCancelPreview,
  getBoardCards,
  getStaffOrderDetail,
  listBoardDishes,
  markDelivered,
  markPickedUp,
  moveBack,
  moveOrder,
  refuseOrder,
  setDishAvailability,
  staffCancelOrder,
  undoMove,
} from './service';
import { DEMO_CANNOT_CHANGE } from './text';

/*
 * The staff order board's actions (F5). Each names its permission, so the wrapper refuses
 * customers, couriers and content editors (403), staff without two-factor
 * (TWO_FACTOR_REQUIRED) and, for changes, the demo admin (DEMO_READ_ONLY) before anything else
 * runs. The service checks again and decides what the role may see.
 */

const READ = { order: ['read-any'] } as const;

// ------------------------------------------------------------------ reads (demo admin allowed)

/** The board, for the 60-second refresh, reconnects and polling (A12.3, A12.4, A12.6). */
export const boardSnapshotAction = userAction
  .metadata({ name: 'board.snapshot', rateLimit: 'board.read', permission: READ, write: false })
  .inputSchema(boardInput)
  .action(async ({ ctx }) => getBoard(ctx.actor));

/** Cards named by realtime events: new orders, orders that left, money changes. */
export const boardCardsAction = userAction
  .metadata({ name: 'board.cards', rateLimit: 'board.read', permission: READ, write: false })
  .inputSchema(boardCardsInput)
  .action(async ({ parsedInput, ctx }) => getBoardCards(ctx.actor, parsedInput));

/** The order detail panel's data and its refetch on events (A10). */
export const staffOrderDetailAction = userAction
  .metadata({ name: 'board.detail', rateLimit: 'board.read', permission: READ, write: false })
  .inputSchema(staffOrderInput)
  .action(async ({ parsedInput, ctx }) => {
    const detail = await getStaffOrderDetail(ctx.actor, parsedInput.orderId);
    if (!detail) throw new AppError('NOT_FOUND', 'Order not found.', 404);
    return detail;
  });

/**
 * What the "Can't make it" and "Cancel order" dialogs show when they open, including whether
 * the code field shows from the start (design 3.2, 3.3, D31).
 */
export const cancelPreviewAction = userAction
  .metadata({
    name: 'board.cancelPreview',
    rateLimit: 'board.read',
    permission: READ,
    write: false,
  })
  .inputSchema(staffOrderInput)
  .action(async ({ parsedInput, ctx }) => getCancelPreview(ctx.actor, parsedInput.orderId));

/** "Find order" (A11.1): 60 a minute. */
export const findOrderAction = userAction
  .metadata({ name: 'board.find', rateLimit: 'order.find', permission: READ, write: false })
  .inputSchema(findOrderInput)
  .action(async ({ parsedInput, ctx }) => findOrder(ctx.actor, parsedInput));

/** The "Dish availability" sheet (design 4.2). SUPPORT sees the sold-out strip only. */
export const boardDishesAction = userAction
  .metadata({ name: 'board.dishes', rateLimit: 'board.read', permission: READ, write: false })
  .inputSchema(boardInput)
  .action(async ({ ctx }) => listBoardDishes(ctx.actor));

// ------------------------------------------------------------------ changes

/** Accept, Start cooking, Mark ready (A4): KITCHEN, ADMIN. 120 a minute. */
export const moveOrderAction = userAction
  .metadata({
    name: 'board.move',
    demoMessage: DEMO_CANNOT_CHANGE,
    rateLimit: 'order.move',
    permission: { order: ['update-status'] },
  })
  .inputSchema(moveOrderInput)
  .action(async ({ parsedInput, ctx }) => moveOrder(ctx.actor, parsedInput));

/** Undo your own move within 10 seconds (A8.1): KITCHEN, ADMIN. 60 a minute. */
export const undoMoveAction = userAction
  .metadata({
    name: 'board.undo',
    demoMessage: DEMO_CANNOT_CHANGE,
    rateLimit: 'order.undo',
    permission: { order: ['update-status'] },
  })
  .inputSchema(undoMoveInput)
  .action(async ({ parsedInput, ctx }) => undoMove(ctx.actor, parsedInput));

/** Move back one step with a reason (A8.3): ADMIN. 30 an hour. */
export const moveBackAction = userAction
  .metadata({
    name: 'board.moveBack',
    demoMessage: DEMO_CANNOT_CHANGE,
    rateLimit: 'order.move-back',
    permission: { order: ['move-back'] },
  })
  .inputSchema(moveBackInput)
  .action(async ({ parsedInput, ctx }) => moveBack(ctx.actor, parsedInput));

/** "Can't make it" on a New order (A6): KITCHEN only (design D14). 20 an hour. */
export const refuseOrderAction = userAction
  .metadata({
    name: 'board.refuse',
    rateLimit: 'order.refuse',
    demoMessage: DEMO_CANNOT_CHANGE,
    permission: { order: ['refuse'] },
  })
  .inputSchema(refuseOrderInput)
  .action(async ({ parsedInput, ctx }) => refuseOrder(ctx.actor, parsedInput));

/**
 * Cancel with a reason, New to Ready (A7): SUPPORT, ADMIN. The code for a card refund after
 * Accept comes with it (`stepUp`). `read-any` keeps customers, who hold `order: cancel` for
 * their own orders, out. 30 an hour.
 */
export const staffCancelOrderAction = userAction
  .metadata({
    name: 'board.cancel',
    demoMessage: DEMO_CANNOT_CHANGE,
    rateLimit: 'order.staff-cancel',
    permission: { order: ['cancel', 'read-any'] },
  })
  .inputSchema(staffCancelInput)
  .action(async ({ parsedInput, ctx }) => staffCancelOrder(ctx.actor, parsedInput));

/** Ready → Out for delivery by hand (A9): ADMIN. Shares 30 an hour with delivered. */
export const markPickedUpAction = userAction
  .metadata({
    name: 'board.pickedUp',
    demoMessage: DEMO_CANNOT_CHANGE,
    rateLimit: 'order.handover',
    permission: { order: ['hand-over'] },
  })
  .inputSchema(markPickedUpInput)
  .action(async ({ parsedInput, ctx }) => markPickedUp(ctx.actor, parsedInput));

/** Out for delivery → Delivered by hand (A9): ADMIN. */
export const markDeliveredAction = userAction
  .metadata({
    name: 'board.delivered',
    demoMessage: DEMO_CANNOT_CHANGE,
    rateLimit: 'order.handover',
    permission: { order: ['hand-over'] },
  })
  .inputSchema(markDeliveredInput)
  .action(async ({ parsedInput, ctx }) => markDelivered(ctx.actor, parsedInput));

/** "86 it": sold out or back on (lead decision): KITCHEN, ADMIN. 60 an hour. */
export const setDishAvailabilityAction = userAction
  .metadata({
    name: 'board.dishAvailability',
    demoMessage: DEMO_CANNOT_CHANGE,
    rateLimit: 'menu.availability',
    permission: { menu: ['update-availability'] },
  })
  .inputSchema(setDishAvailabilityInput)
  .action(async ({ parsedInput, ctx }) => setDishAvailability(ctx.actor, parsedInput));
