import 'server-only';
import { db } from '@/server/db/client';
import type { DbContext } from '@/server/db/context';

const listFields = {
  id: true,
  type: true,
  title: true,
  body: true,
  link: true,
  readAt: true,
  createdAt: true,
} as const;

export function insertNotification(
  ctx: DbContext,
  data: { userId: string; type: string; title: string; body: string; link?: string },
) {
  return db(ctx).notification.create({
    data: {
      userId: data.userId,
      type: data.type,
      title: data.title,
      body: data.body,
      link: data.link,
    },
    select: { id: true, userId: true, title: true, body: true, link: true },
  });
}

/** The caller's own notifications; row-level security hides everyone else's. */
export function listForCurrentUser(
  ctx: DbContext,
  options: { unreadOnly: boolean; limit: number },
) {
  return db(ctx).notification.findMany({
    where: options.unreadOnly ? { readAt: null } : {},
    orderBy: { createdAt: 'desc' },
    take: options.limit,
    select: listFields,
  });
}

export async function markRead(ctx: DbContext, ids: string[], at: Date) {
  const result = await db(ctx).notification.updateMany({
    where: { id: { in: ids }, readAt: null },
    data: { readAt: at },
  });
  return result.count;
}

/** What the email job needs: the message and where to send it. */
export function emailDetails(ctx: DbContext, notificationId: string) {
  return db(ctx).notification.findUnique({
    where: { id: notificationId },
    select: {
      title: true,
      body: true,
      link: true,
      user: { select: { email: true, banned: true, deletedAt: true } },
    },
  });
}
