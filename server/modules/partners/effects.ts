import 'server-only';
import { channels } from '@/lib/realtime/channels';
import type { PartnerAvailabilityReason } from '@/lib/realtime/events';
import { runAsSystem } from '@/server/db/context';
import { inngest } from '@/server/jobs/client';
import {
  partnerApproved,
  partnerEmailRequested,
  partnerSuspended,
  partnerWentOffline,
  partnerWentOnline,
} from '@/server/jobs/partner-events';
import { logger } from '@/server/logger';
import { announceCouriersCount } from '@/server/modules/delivery/service';
import { notify } from '@/server/modules/notifications/service';
import { publish } from '@/server/realtime/pusher';
import { deleteObject } from '@/server/storage/s3';
import { deletePoint } from './location-store';
import type { NoticeText, PartnerEmailKind } from './notices';
import { deleteSessions, deleteUploadRows, findUploads } from './repo';

/*
 * What happens after a partner change is committed: realtime messages, notices, emails, ended
 * sessions, deleted files and the domain events. Each is best effort and keyed so a repeat does
 * nothing; a failure is logged and never undoes the change. They run in the order given, which
 * matters for approval (notice and email before the sessions end, B6) and suspension (the live
 * point goes first, A25.2).
 */

export type PartnerEffect =
  | { kind: 'deletePoint'; partnerId: string }
  | {
      kind: 'availability';
      partnerId: string;
      online: boolean;
      reason: PartnerAvailabilityReason;
      changeId: string;
      at: Date;
    }
  | { kind: 'status'; partnerId: string; status: 'APPROVED' | 'SUSPENDED'; at: Date }
  | { kind: 'notify'; userId: string; notice: NoticeText }
  | { kind: 'email'; partnerId: string; eventId: string; email: PartnerEmailKind }
  | { kind: 'endSessions'; userId: string }
  | { kind: 'deleteFiles'; uploadIds: string[] }
  | { kind: 'approved'; partnerId: string; at: Date }
  | { kind: 'suspended'; partnerId: string; wasOnline: boolean; at: Date }
  | { kind: 'online'; partnerId: string; at: Date }
  | { kind: 'offline'; partnerId: string; reason: PartnerAvailabilityReason; at: Date };

/** Deletes upload files and rows (withdrawn, replaced, expired, account deleted). */
export async function deleteUploads(uploadIds: readonly string[]) {
  if (uploadIds.length === 0) return;
  const uploads = await runAsSystem('partner files', (ctx) => findUploads(ctx, [...uploadIds]));
  await Promise.all(
    uploads.map((upload) =>
      deleteObject(upload.bucket === 'PUBLIC' ? 'PUBLIC' : 'PRIVATE', upload.key),
    ),
  );
  await runAsSystem('partner files', (ctx) => deleteUploadRows(ctx, [...uploadIds]));
}

async function runOne(effect: PartnerEffect) {
  switch (effect.kind) {
    case 'deletePoint':
      await deletePoint(effect.partnerId);
      return;
    case 'availability':
      await publish(channels.partner(effect.partnerId), 'partner.availability-changed', {
        online: effect.online,
        reason: effect.reason,
        changeId: effect.changeId,
        at: effect.at.toISOString(),
      });
      // A35.1: the boards' couriers chip, within moments.
      await announceCouriersCount(effect.at);
      return;
    case 'status':
      await publish(channels.partner(effect.partnerId), 'partner.status-changed', {
        status: effect.status,
        at: effect.at.toISOString(),
      });
      return;
    case 'notify':
      await notify({
        userId: effect.userId,
        type: effect.notice.type,
        title: effect.notice.title,
        body: effect.notice.body,
        link: '/partner',
        partner: { type: effect.notice.type },
      });
      return;
    case 'email':
      await inngest.send(
        partnerEmailRequested.create(
          { partnerId: effect.partnerId, eventId: effect.eventId, kind: effect.email },
          { id: `partner-email-${effect.eventId}` },
        ),
      );
      return;
    case 'endSessions':
      await runAsSystem('end partner sessions', (ctx) => deleteSessions(ctx, effect.userId));
      return;
    case 'deleteFiles':
      await deleteUploads(effect.uploadIds);
      return;
    case 'approved':
      await inngest.send(
        partnerApproved.create(
          { partnerId: effect.partnerId, at: effect.at.toISOString() },
          { id: `partner-approved-${effect.partnerId}-${effect.at.getTime()}` },
        ),
      );
      return;
    case 'suspended':
      await inngest.send(
        partnerSuspended.create(
          { partnerId: effect.partnerId, wasOnline: effect.wasOnline, at: effect.at.toISOString() },
          { id: `partner-suspended-${effect.partnerId}-${effect.at.getTime()}` },
        ),
      );
      return;
    case 'online':
      await inngest.send(
        partnerWentOnline.create(
          { partnerId: effect.partnerId, at: effect.at.toISOString() },
          { id: `partner-online-${effect.partnerId}-${effect.at.getTime()}` },
        ),
      );
      return;
    default:
      await inngest.send(
        partnerWentOffline.create(
          { partnerId: effect.partnerId, reason: effect.reason, at: effect.at.toISOString() },
          { id: `partner-offline-${effect.partnerId}-${effect.at.getTime()}` },
        ),
      );
  }
}

/** One after another, in the order given; each failure is logged and the rest still run. */
export async function runPartnerEffects(effects: readonly PartnerEffect[]) {
  await effects.reduce(
    (previous, effect) =>
      previous.then(() =>
        runOne(effect).catch((error: unknown) => {
          logger.error({ err: error, effect: effect.kind }, 'partner follow-up failed');
        }),
      ),
    Promise.resolve(),
  );
}
