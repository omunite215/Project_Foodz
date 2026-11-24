'use server';

import { userAction } from '@/server/action';
import {
  assignableCouriersInput,
  courierPhotoInput,
  restartSearchInput,
  sendStaffOfferInput,
  takeOffCourierInput,
} from './schema';
import {
  courierPhotoLink,
  listAssignableCouriers,
  restartSearch,
  sendStaffOffer,
  takeOffCourier,
} from './service';

/*
 * Staff dispatch actions (F7 A37 to A39) and the customer's courier photo. Each names its
 * permission, so the wrapper refuses KITCHEN, CONTENT_EDITOR, customers and partners (403),
 * staff without two-factor and, for changes, the demo admin before anything else runs. The
 * partner's own routes live under /api/v1/partner.
 */

const ASSIGN = { delivery: ['assign'] } as const;
const DEMO_CANNOT = 'Read-only in the demo';

/** The assign dialog's list (A37.2). The demo admin may read it (masked). */
export const assignableCouriersAction = userAction
  .metadata({
    name: 'delivery.assignable',
    rateLimit: 'delivery.read',
    permission: { order: ['read-any'], delivery: ['assign'] },
    write: false,
  })
  .inputSchema(assignableCouriersInput)
  .action(async ({ parsedInput, ctx }) => listAssignableCouriers(ctx.actor, parsedInput));

/** A37.3: a 60-second staff offer. 60 an hour. */
export const sendStaffOfferAction = userAction
  .metadata({
    name: 'delivery.staffOffer',
    rateLimit: 'delivery.staff-offer',
    permission: ASSIGN,
    demoMessage: DEMO_CANNOT,
  })
  .inputSchema(sendStaffOfferInput)
  .action(async ({ parsedInput, ctx }) => sendStaffOffer(ctx.actor, parsedInput));

/** A38: take an order off its courier before pickup. 30 an hour. */
export const takeOffCourierAction = userAction
  .metadata({
    name: 'delivery.takeOff',
    rateLimit: 'delivery.take-off',
    permission: ASSIGN,
    demoMessage: DEMO_CANNOT,
  })
  .inputSchema(takeOffCourierInput)
  .action(async ({ parsedInput, ctx }) => takeOffCourier(ctx.actor, parsedInput));

/** A39.4: "Find a courier". 30 an hour. */
export const restartSearchAction = userAction
  .metadata({
    name: 'delivery.restart',
    rateLimit: 'delivery.restart',
    permission: ASSIGN,
    demoMessage: DEMO_CANNOT,
  })
  .inputSchema(restartSearchInput)
  .action(async ({ parsedInput, ctx }) => restartSearch(ctx.actor, parsedInput));

/** B11, S2.6: the customer's fresh courier photo link; own order only, else 404. */
export const courierPhotoAction = userAction
  .metadata({ name: 'delivery.courierPhoto', rateLimit: 'delivery.courier-photo' })
  .inputSchema(courierPhotoInput)
  .action(async ({ parsedInput, ctx }) => courierPhotoLink(ctx.actor, parsedInput));
