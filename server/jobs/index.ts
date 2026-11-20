import 'server-only';
import type { InngestFunction } from 'inngest';
import { accountEmail } from './functions/account-email';
import { notificationEmail } from './functions/notification-email';
import { orderEmail } from './functions/order-email';
import { orderExpiry } from './functions/order-expiry';
import { orderRefund } from './functions/order-refund';
import { orderSweep } from './functions/order-sweep';
import { processUploadJob } from './functions/process-upload';

/** Every background function the app serves at /api/inngest. */
export const functions: InngestFunction.Any[] = [
  accountEmail,
  notificationEmail,
  processUploadJob,
  orderEmail,
  orderExpiry,
  orderRefund,
  orderSweep,
];
