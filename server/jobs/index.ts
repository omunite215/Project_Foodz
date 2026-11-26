import 'server-only';
import type { InngestFunction } from 'inngest';
import { accountEmail } from './functions/account-email';
import {
  deliveryEta,
  deliveryLocationsRetention,
  deliveryNoAnswer,
  demoDeliveryRun,
} from './functions/tracking';
import {
  dispatchOrder,
  dispatchWake,
  expireOfferJob,
  withdrawOnOffline,
} from './functions/dispatch';
import { notificationEmail } from './functions/notification-email';
import { orderEmail } from './functions/order-email';
import { orderExpiry } from './functions/order-expiry';
import { orderRefund } from './functions/order-refund';
import { orderRefundSweep } from './functions/order-refund-sweep';
import { orderStepNotice } from './functions/order-step-notice';
import { orderSweep } from './functions/order-sweep';
import { partnerAutoOffline } from './functions/partner-auto-offline';
import { partnerEmail } from './functions/partner-email';
import { partnerFilesCleanup } from './functions/partner-files-cleanup';
import { partnerSessionEndedJob } from './functions/partner-session-ended';
import { processUploadJob } from './functions/process-upload';

/** Every background function the app serves at /api/inngest. */
export const functions: InngestFunction.Any[] = [
  accountEmail,
  notificationEmail,
  processUploadJob,
  orderEmail,
  orderExpiry,
  orderRefund,
  orderRefundSweep,
  orderSweep,
  orderStepNotice,
  partnerEmail,
  partnerAutoOffline,
  partnerFilesCleanup,
  partnerSessionEndedJob,
  dispatchOrder,
  expireOfferJob,
  dispatchWake,
  withdrawOnOffline,
  deliveryEta,
  deliveryNoAnswer,
  deliveryLocationsRetention,
  demoDeliveryRun,
];
