'use server';

import { publicAction } from '@/server/action';
import { dishIdsInput } from './schema';
import { listDishesByIds } from './service';

/**
 * Current price and availability of dishes the browser already knows about (cart lines, a dish
 * page left open), checked before adding them to the cart. Ids that match no dish are left out.
 */
export const dishesByIdAction = publicAction
  .metadata({ name: 'menu.dishesById', rateLimit: 'menu.check' })
  .inputSchema(dishIdsInput)
  .action(async ({ parsedInput }) => listDishesByIds(parsedInput));
