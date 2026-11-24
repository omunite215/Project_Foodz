'use server';

import { userAction } from '@/server/action';
import { reorderInput } from './progress-schema';
import { reorder } from './progress-service';

/**
 * "Order again" (S7.5): any signed-in account, the demo customer included (the cart is hers to
 * fill); the service answers "Order not found." for anything but the caller's own finished
 * order. 30 a minute.
 */
export const reorderAction = userAction
  .metadata({ name: 'orders.reorder', rateLimit: 'order.reorder' })
  .inputSchema(reorderInput)
  .action(async ({ parsedInput, ctx }) => reorder(ctx.actor, parsedInput));
