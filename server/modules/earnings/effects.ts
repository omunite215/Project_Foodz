import 'server-only';
import { channels } from '@/lib/realtime/channels';
import { logger } from '@/server/logger';
import { notify } from '@/server/modules/notifications/service';
import { publish } from '@/server/realtime/pusher';
import type { EarningKind, PayoutMethod } from './schema';
import { partnerNotice } from './text';

/*
 * After a ledger change is committed (contract §11): `earnings.changed` on the partner's own
 * channel, with no amounts (P60.2), and for staff entries the partner's saved notice. Best
 * effort: a failure is logged and the app's next fetch shows the figures anyway.
 */

/** Tells the partner's open app to refetch its figures. */
export async function announceEarnings(partnerId: string): Promise<void> {
  try {
    await publish(channels.partner(partnerId), 'earnings.changed', {
      at: new Date().toISOString(),
    });
  } catch (error) {
    logger.warn({ err: error, partnerId }, 'earnings.changed not published');
  }
}

/** A60.3, A61.2, A62.2: the partner's notice for a staff entry; never a staff name or note. */
export async function notifyPartnerOfEntry(
  partnerUserId: string,
  entry: {
    kind: EarningKind;
    amountCents: number;
    message: string | null;
    method: PayoutMethod | null;
  },
): Promise<void> {
  const notice = partnerNotice(entry);
  try {
    await notify({
      userId: partnerUserId,
      type: notice.type,
      title: notice.title,
      body: notice.body,
      link: '/partner/earnings',
      partner: { type: notice.type },
    });
  } catch (error) {
    logger.error({ err: error, kind: entry.kind }, 'partner earnings notice failed');
  }
}
