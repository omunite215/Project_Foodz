import { v7 as uuid } from 'uuid';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserActor } from '@/server/auth/session';
import { db } from '@/server/db/client';
import { runAsSystem } from '@/server/db/context';

// Realtime, the job queue and SMTP are outside the database; their calls are recorded instead.
const mocks = vi.hoisted(() => ({
  publish: vi.fn<(channel: string, event: string, data: unknown) => Promise<void>>(),
  send: vi.fn<(event: unknown) => Promise<unknown>>(),
  sendEmail: vi.fn<(email: { to: string; subject: string; text: string }) => Promise<void>>(),
}));
vi.mock('@/server/realtime/pusher', () => ({ publish: mocks.publish }));
vi.mock('@/server/jobs/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/jobs/client')>()),
  inngest: { send: mocks.send },
}));
vi.mock('@/server/notifications/email', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/notifications/email')>()),
  sendEmail: mocks.sendEmail,
}));

const { listNotifications, markNotificationsRead, notify, sendNotificationEmail } =
  await import('@/server/modules/notifications/service');

const alice = uuid();
const bob = uuid();
const banned = uuid();
const asUser = (userId: string): UserActor => ({
  kind: 'user',
  userId,
  role: 'customer',
  isDemo: false,
});

beforeAll(async () => {
  process.env.NEXT_PUBLIC_SITE_URL = 'https://foodz.example';
  await runAsSystem('test setup', (ctx) =>
    db(ctx).user.createMany({
      data: [
        { id: alice, name: 'Alice', email: `alice-${alice}@test.dev` },
        { id: bob, name: 'Bob', email: `bob-${bob}@test.dev` },
        { id: banned, name: 'Banned', email: `banned-${banned}@test.dev`, banned: true },
      ],
    }),
  );
});

beforeEach(() => {
  mocks.publish.mockReset().mockResolvedValue();
  mocks.send.mockReset().mockResolvedValue({ ids: ['evt'] });
  mocks.sendEmail.mockReset().mockResolvedValue();
});

describe('notify', () => {
  it('saves the notification for the recipient only and pushes it live', async () => {
    const { id } = await notify({
      userId: alice,
      type: 'order.ready',
      title: 'Your order is ready',
      body: 'Riley is picking it up now.',
      link: '/orders/1',
    });

    const mine = await listNotifications(asUser(alice));
    expect(mine).toEqual([
      expect.objectContaining({ id, title: 'Your order is ready', readAt: null }),
    ]);
    expect(await listNotifications(asUser(bob))).toEqual([]);

    expect(mocks.publish).toHaveBeenCalledWith(`private-user-${alice}`, 'notification.created', {
      id,
      title: 'Your order is ready',
      body: 'Riley is picking it up now.',
      link: '/orders/1',
    });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('queues one email job per notification when asked to email', async () => {
    const { id } = await notify({
      userId: alice,
      type: 'refund.approved',
      title: 'Refund approved',
      body: 'We refunded $12.99.',
      email: true,
    });

    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'notification.email-requested',
        data: { notificationId: id },
        id: `notification-email-${id}`,
      }),
    );
  });

  it('keeps the notification when the email job cannot be queued', async () => {
    mocks.send.mockRejectedValue(new Error('jobs server down'));
    const { id } = await notify({
      userId: bob,
      type: 'order.cancelled',
      title: 'Order cancelled',
      body: 'Sorry, we ran out.',
      email: true,
    });
    expect((await listNotifications(asUser(bob))).map((n) => n.id)).toContain(id);
  });

  it('rejects invalid input before saving anything', async () => {
    await expect(
      notify({
        userId: alice,
        type: 'x',
        title: 'Hi',
        body: 'There',
        link: 'https://evil.example',
      }),
    ).rejects.toThrow(/Must be a path on this site/);
    expect(mocks.publish).not.toHaveBeenCalled();
  });
});

describe('reading notifications', () => {
  it('marks only the caller’s own notifications as read', async () => {
    const forAlice = await notify({ userId: alice, type: 'promo', title: 'A', body: 'A' });
    const forBob = await notify({ userId: bob, type: 'promo', title: 'B', body: 'B' });

    expect(await markNotificationsRead(asUser(alice), { ids: [forAlice.id, forBob.id] })).toBe(1);

    const bobsUnread = await listNotifications(asUser(bob), { unreadOnly: true });
    expect(bobsUnread.map((n) => n.id)).toContain(forBob.id);
    const alicesUnread = await listNotifications(asUser(alice), { unreadOnly: true });
    expect(alicesUnread.map((n) => n.id)).not.toContain(forAlice.id);
  });

  it('caps how many are returned', async () => {
    await expect(listNotifications(asUser(alice), { limit: 500 })).rejects.toThrow(/Too big/);
  });
});

describe('the email job', () => {
  it('emails the recipient with a link to the site', async () => {
    const { id } = await notify({
      userId: alice,
      type: 'order.delivered',
      title: 'Delivered',
      body: 'Enjoy your meal!',
      link: '/orders/42',
    });

    expect(await sendNotificationEmail(id)).toBe('sent');
    expect(mocks.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: `alice-${alice}@test.dev`,
        subject: 'Delivered',
        text: expect.stringContaining('https://foodz.example/orders/42'),
      }),
    );
  });

  it('skips suspended accounts and notifications that no longer exist', async () => {
    const { id } = await notify({ userId: banned, type: 'promo', title: 'Hi', body: 'There' });
    expect(await sendNotificationEmail(id)).toBe('skipped');
    expect(await sendNotificationEmail(uuid())).toBe('skipped');
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });
});
