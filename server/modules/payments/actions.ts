'use server';

import { userAction } from '@/server/action';
import { removeSavedCardInput } from './schema';
import { listSavedCards, removeSavedCard } from './service';

/*
 * Saved cards (S6.13, S6.14). Only the caller's own Stripe customer's cards are listed; removing
 * a card that isn't theirs answers "not found" and removes nothing. The shared demo account and
 * a machine without Stripe keys are refused.
 */

export const listSavedCardsAction = userAction
  .metadata({ name: 'cards.list', rateLimit: 'cards.read' })
  .action(async ({ ctx }) => listSavedCards(ctx.actor));

/** 20 changes per 10 minutes per account. */
export const removeSavedCardAction = userAction
  .metadata({ name: 'cards.remove', rateLimit: 'cards.write' })
  .inputSchema(removeSavedCardInput)
  .action(async ({ parsedInput, ctx }) => removeSavedCard(ctx.actor, parsedInput));
