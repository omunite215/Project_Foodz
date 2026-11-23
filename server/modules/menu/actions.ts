'use server';

import { publicAction } from '@/server/action';
import { dishIdsInput, menuSearchInput } from './schema';
import { listDishesByIds, searchMenu } from './service';

/**
 * Current price and availability of dishes the browser already knows about (cart lines, a dish
 * page left open), checked before adding them to the cart. Ids that match no dish are left out.
 */
export const dishesByIdAction = publicAction
  .metadata({ name: 'menu.dishesById', rateLimit: 'menu.check' })
  .inputSchema(dishIdsInput)
  .action(async ({ parsedInput }) => listDishesByIds(parsedInput));

/**
 * Menu search as the customer types (F3 S6), debounced by the browser. Public, limited per
 * network (`search`, 60 a minute). Returns ordered dish ids; the filters run in the browser.
 */
export const searchMenuAction = publicAction
  .metadata({ name: 'menu.search', rateLimit: 'search' })
  .inputSchema(menuSearchInput)
  .action(async ({ parsedInput }) => searchMenu(parsedInput));
