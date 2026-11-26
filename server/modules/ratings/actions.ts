'use server';

import { userAction } from '@/server/action';
import {
  excludeRatingInput,
  includeRatingInput,
  partnerRatingsInput,
  rateOrderInput,
  skipRatingInput,
} from './schema';
import { excludeRating, getPartnerRatings, includeRating, rateOrder, skipRating } from './service';

/*
 * Ratings actions (contract §6). Rating and skipping need a signed-in customer (the service
 * refuses staff with NOT_A_CUSTOMER and checks the order is hers); the shared demo customer may
 * rate, into the demo pool, without comments. Moderation names its permission, so customers,
 * partners, KITCHEN and CONTENT_EDITOR get 403 and the demo admin DEMO_READ_ONLY.
 */

const DEMO_READ_ONLY = 'Read-only in the demo';

/** S1–S5: stars, tags and a comment per dish and for the courier; a repeat saves once. */
export const rateOrderAction = userAction
  .metadata({ name: 'ratings.rate', rateLimit: 'rating.submit' })
  .inputSchema(rateOrderInput)
  .action(async ({ parsedInput, ctx }) => rateOrder(ctx.actor, parsedInput));

/** S3: "Skip": no reminder; rating later still works. */
export const skipRatingAction = userAction
  .metadata({ name: 'ratings.skip', rateLimit: 'rating.submit' })
  .inputSchema(skipRatingInput)
  .action(async ({ parsedInput, ctx }) => skipRating(ctx.actor, parsedInput));

/** A58.2: out of the average, with a reason. */
export const excludeRatingAction = userAction
  .metadata({
    name: 'ratings.exclude',
    rateLimit: 'rating.moderate',
    permission: { review: ['moderate'] },
    demoMessage: DEMO_READ_ONLY,
  })
  .inputSchema(excludeRatingInput)
  .action(async ({ parsedInput, ctx }) => excludeRating(ctx.actor, parsedInput));

/** A58.3: back into the average. */
export const includeRatingAction = userAction
  .metadata({
    name: 'ratings.include',
    rateLimit: 'rating.moderate',
    permission: { review: ['moderate'] },
    demoMessage: DEMO_READ_ONLY,
  })
  .inputSchema(includeRatingInput)
  .action(async ({ parsedInput, ctx }) => includeRating(ctx.actor, parsedInput));

/** A58.1: a partner's ratings for staff, 20 at a time. */
export const partnerRatingsAction = userAction
  .metadata({
    name: 'ratings.partner',
    rateLimit: 'earnings.staff-read',
    permission: { review: ['moderate'] },
    write: false,
  })
  .inputSchema(partnerRatingsInput)
  .action(async ({ parsedInput, ctx }) => getPartnerRatings(ctx.actor, parsedInput));
