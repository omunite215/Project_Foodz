import 'server-only';
import type { InngestFunction } from 'inngest';
import { notificationEmail } from './functions/notification-email';

/** Every background function the app serves at /api/inngest. */
export const functions: InngestFunction.Any[] = [notificationEmail];
