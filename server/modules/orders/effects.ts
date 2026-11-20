import 'server-only';
import { runAsSystem } from '@/server/db/context';
import {
  inngest,
  orderEmailRequested,
  orderPaymentStarted,
  orderRefundRequested,
} from '@/server/jobs/client';
import { logger } from '@/server/logger';
import { notify } from '@/server/modules/notifications/service';
import { keepSavedCard } from '@/server/modules/payments/service';
import { sendEmail } from '@/server/notifications/email';
import { paymentGateway } from '@/server/payments/stripe';
import { redis, waitUntilReady } from '@/server/redis';
import { takeAttempts } from '@/server/security/rate-limit';
import { type OrderEmailKind, orderNotice, renderOrderEmail } from './emails';
import { findOrderEmailRecipient } from './repo';
import { loadOrderViewAsSystem } from './views';

/*
 * What happens after an order change is committed: emails, refunds, cancelling a payment at
 * Stripe, keeping a saved card, counting a decline. Only the transaction that made the change
 * returns these, so each happens once per change (B6, B17). Each is best effort: a failure is
 * logged and never undoes the change. Emails and refunds go through jobs with retries, keyed
 * so a repeat does nothing.
 */

export type OrderEffect =
  | {
      kind: 'email';
      orderId: string;
      email: OrderEmailKind;
      /** Makes the job's event id: one email per order and change. */
      change: string;
      refundCents?: number;
      at?: string;
    }
  | { kind: 'refund'; orderId: string }
  | { kind: 'cancelIntent'; paymentIntentId: string }
  | { kind: 'keepCard'; customerId: string; paymentMethodId: string; fingerprint: string | null }
  | { kind: 'decline'; userId: string; paymentIntentId: string }
  | { kind: 'expiry'; orderId: string; expiresAt: string };

const networkKey = (paymentIntentId: string) => `payment:network:${paymentIntentId}`;

/** Remembers the network a card payment came from, so its decline counts there too (B11). */
export async function rememberPaymentNetwork(paymentIntentId: string, ip: string) {
  try {
    await waitUntilReady();
    await redis.set(networkKey(paymentIntentId), ip, 'EX', 2 * 60 * 60);
  } catch (error) {
    logger.warn({ err: error }, 'could not remember the payment network');
  }
}

async function networkOf(paymentIntentId: string) {
  try {
    await waitUntilReady();
    return await redis.get(networkKey(paymentIntentId));
  } catch {
    return null;
  }
}

async function runEffect(effect: OrderEffect) {
  switch (effect.kind) {
    case 'email': {
      const loaded = await loadOrderViewAsSystem(effect.orderId);
      if (loaded) {
        const notice = orderNotice(effect.email, loaded.view, effect.refundCents);
        await notify({
          userId: loaded.userId,
          type: `order.${effect.email}`,
          title: notice.title,
          body: notice.body,
          link: `/orders/${effect.orderId}`,
        });
      }
      await inngest.send(
        orderEmailRequested.create(
          {
            orderId: effect.orderId,
            kind: effect.email,
            ...(effect.refundCents !== undefined && { refundCents: effect.refundCents }),
            ...(effect.at && { at: effect.at }),
          },
          { id: `order-email-${effect.orderId}-${effect.change}` },
        ),
      );
      return;
    }
    case 'refund':
      await inngest.send(
        orderRefundRequested.create(
          { orderId: effect.orderId },
          { id: `order-refund-${effect.orderId}` },
        ),
      );
      return;
    case 'cancelIntent': {
      // A declined attempt is over (U2): the same payment can't be tried again.
      await paymentGateway()?.cancelIntent(effect.paymentIntentId);
      return;
    }
    case 'keepCard':
      await keepSavedCard(effect);
      return;
    case 'decline': {
      const network = await networkOf(effect.paymentIntentId);
      await takeAttempts([
        { policy: 'payment.decline.user', key: `user:${effect.userId}` },
        ...(network ? [{ policy: 'payment.decline.ip' as const, key: `ip:${network}` }] : []),
      ]).catch(() => {
        // Already over the limit: card payment is paused, which is the point.
      });
      return;
    }
    case 'expiry':
      await inngest.send(
        orderPaymentStarted.create(
          { orderId: effect.orderId, expiresAt: effect.expiresAt },
          { id: `order-expiry-${effect.orderId}` },
        ),
      );
      return;
    default:
      return;
  }
}

/** One after another, in the order given. */
export async function runEffects(effects: readonly OrderEffect[]) {
  await effects.reduce(
    (previous, effect) =>
      previous.then(() =>
        runEffect(effect).catch((error: unknown) => {
          logger.error({ err: error, effect: effect.kind }, 'order follow-up failed');
        }),
      ),
    Promise.resolve(),
  );
}

// ------------------------------------------------------------------ the email job

/** Run by the background job: renders and sends one order email. */
export async function deliverOrderEmail(input: {
  orderId: string;
  kind: OrderEmailKind;
  refundCents?: number;
  at?: string;
}): Promise<'sent' | 'skipped'> {
  const [loaded, recipient] = await Promise.all([
    loadOrderViewAsSystem(input.orderId),
    runAsSystem('order email', (ctx) => findOrderEmailRecipient(ctx, input.orderId)),
  ]);
  const user = recipient?.user;
  if (!loaded || !user || user.deletedAt || user.banned) return 'skipped';
  await sendEmail(
    renderOrderEmail(input.kind, loaded.view, {
      to: user.email,
      siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3456',
      ...(input.refundCents !== undefined && {
        refund: { amountCents: input.refundCents, at: input.at ?? new Date().toISOString() },
      }),
    }),
  );
  return 'sent';
}
