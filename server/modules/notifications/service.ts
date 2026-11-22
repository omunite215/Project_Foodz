import 'server-only';
import { channels } from '@/lib/realtime/channels';
import type { UserActor } from '@/server/auth/session';
import { runAs, runAsSystem } from '@/server/db/context';
import { inngest, notificationEmailRequested } from '@/server/jobs/client';
import { logger } from '@/server/logger';
import { actionEmail, sendEmail } from '@/server/notifications/email';
import { publish } from '@/server/realtime/pusher';
import { emailDetails, insertNotification, listForCurrentUser, markRead } from './repo';
import { listNotificationsInput, markReadInput, type NotifyInput, notifyInput } from './schema';

/**
 * Tells a user something happened: saved to their notification list, pushed live to any open
 * tab, and optionally emailed. Call it after the change it reports has been saved.
 */
export async function notify(input: NotifyInput): Promise<{ id: string }> {
  const data = notifyInput.parse(input);

  // Saved by the platform: a staff member's action often notifies someone else.
  const saved = await runAsSystem('notification', (ctx) => insertNotification(ctx, data));

  await publish(channels.user(saved.userId), 'notification.created', {
    id: saved.id,
    title: saved.title,
    body: saved.body,
    link: saved.link,
    // F5 order notices pass their order and step here (contract: notification.created).
    kind: 'general',
  });

  if (data.email) {
    try {
      // The event id makes a repeated send a no-op, so a retried caller cannot email twice.
      await inngest.send(
        notificationEmailRequested.create(
          { notificationId: saved.id },
          { id: `notification-email-${saved.id}` },
        ),
      );
    } catch (error) {
      // The notification is still in the user's list; only the email copy is missing.
      logger.error({ err: error, notificationId: saved.id }, 'could not queue notification email');
    }
  }
  return { id: saved.id };
}

export async function listNotifications(actor: UserActor, input: unknown = {}) {
  const options = listNotificationsInput.parse(input);
  return runAs(actor, (ctx) => listForCurrentUser(ctx, options));
}

/** Marks the caller's own notifications as read; ids belonging to anyone else are ignored. */
export async function markNotificationsRead(actor: UserActor, input: unknown) {
  const { ids } = markReadInput.parse(input);
  return runAs(actor, (ctx) => markRead(ctx, ids, new Date()));
}

/** Run by the background job. Skips accounts that were deleted or suspended since. */
export async function sendNotificationEmail(notificationId: string): Promise<'sent' | 'skipped'> {
  const details = await runAsSystem('notification email', (ctx) =>
    emailDetails(ctx, notificationId),
  );
  if (!details || details.user.deletedAt || details.user.banned) return 'skipped';

  const url = new URL(details.link ?? '/', process.env.NEXT_PUBLIC_SITE_URL).toString();
  await sendEmail({
    to: details.user.email,
    subject: details.title,
    ...actionEmail({ heading: details.title, message: details.body, action: 'Open Foodz', url }),
  });
  return 'sent';
}
