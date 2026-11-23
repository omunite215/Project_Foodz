'use server';

import { userAction } from '@/server/action';
import { AppError } from '@/server/errors';
import {
  attemptStatusInput,
  listOrdersInput,
  orderIdInput,
  orderStatusInput,
  placeOrderInput,
  resumePaymentInput,
} from './schema';
import {
  cancelOrder,
  checkOrderStatus,
  getAttemptStatus,
  getOrderView,
  listMyOrders,
  placeOrder,
  resumePayment,
} from './service';

/*
 * Checkout and order actions (F4). Each needs a signed-in account; the service decides who may
 * order (customer accounts, email confirmed, not the shared demo) and only ever touches the
 * caller's own orders: another person's order id answers "not found".
 */

/**
 * Places the order (B2): priced again on the server, refused on any change. Limited to 10 an
 * hour per account (`order.place.user`) and 30 per network (in the service).
 */
export const placeOrderAction = userAction
  .metadata({ name: 'orders.place', rateLimit: 'order.place.user' })
  .inputSchema(placeOrderInput)
  .action(async ({ parsedInput, ctx }) =>
    placeOrder(ctx.actor, parsedInput, { ip: ctx.request.ip }),
  );

/** The order page's poll while a card payment is confirmed (B7): 120 a minute. */
export const orderStatusAction = userAction
  .metadata({ name: 'orders.status', rateLimit: 'order.status' })
  .inputSchema(orderStatusInput)
  .action(async ({ parsedInput, ctx }) => checkOrderStatus(ctx.actor, parsedInput));

/** What became of a press, by its attempt key (S7.3, B16). Shares the status limit. */
export const attemptStatusAction = userAction
  .metadata({ name: 'orders.attempt', rateLimit: 'order.status' })
  .inputSchema(attemptStatusInput)
  .action(async ({ parsedInput, ctx }) => getAttemptStatus(ctx.actor, parsedInput));

/** The order page's data, for a refetch on tab focus (S11.2). */
export const orderViewAction = userAction
  .metadata({ name: 'orders.view', rateLimit: 'order.read' })
  .inputSchema(orderIdInput)
  .action(async ({ parsedInput, ctx }) => {
    const view = await getOrderView(ctx.actor, parsedInput.orderId);
    if (!view) throw new AppError('NOT_FOUND', 'Order not found.', 404);
    return view;
  });

/** /account/orders: 20 at a time (S12.1, S12.2). */
export const listOrdersAction = userAction
  .metadata({ name: 'orders.list', rateLimit: 'order.read' })
  .inputSchema(listOrdersInput)
  .action(async ({ parsedInput, ctx }) => listMyOrders(ctx.actor, parsedInput));

/** Cancels until the kitchen accepts (U6); a paid card order is refunded in full. 10 an hour. */
export const cancelOrderAction = userAction
  .metadata({ name: 'orders.cancel', rateLimit: 'order.cancel' })
  .inputSchema(orderIdInput)
  .action(async ({ parsedInput, ctx }) => cancelOrder(ctx.actor, parsedInput));

/** "Finish paying" (S7.6): the waiting order's payment again. 20 per 10 minutes. */
export const resumePaymentAction = userAction
  .metadata({ name: 'orders.resumePayment', rateLimit: 'order.pay' })
  .inputSchema(resumePaymentInput)
  .action(async ({ parsedInput, ctx }) =>
    resumePayment(ctx.actor, parsedInput, { ip: ctx.request.ip }),
  );
