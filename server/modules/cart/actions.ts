'use server';

import { publicAction } from '@/server/action';
import { quoteInput } from './schema';
import { quoteCart } from './service';

/**
 * The cart's price breakdown (F3 S2). Guests and signed-in customers alike; limited per network
 * (`cart.quote`, 120 a minute). A code in the request is checked under its own per-account and
 * per-network guessing limits, and a code that can't be checked never stops the quote.
 */
export const quoteCartAction = publicAction
  .metadata({ name: 'cart.quote', rateLimit: 'cart.quote' })
  .inputSchema(quoteInput)
  .action(async ({ parsedInput, ctx }) =>
    quoteCart(ctx.actor, parsedInput, { ip: ctx.request.ip }),
  );
