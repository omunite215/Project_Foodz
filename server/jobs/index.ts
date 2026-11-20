import 'server-only';
import type { InngestFunction } from 'inngest';
import { accountEmail } from './functions/account-email';
import { notificationEmail } from './functions/notification-email';
import { processUploadJob } from './functions/process-upload';

/** Every background function the app serves at /api/inngest. */
export const functions: InngestFunction.Any[] = [accountEmail, notificationEmail, processUploadJob];
