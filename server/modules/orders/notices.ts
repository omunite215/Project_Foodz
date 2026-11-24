import 'server-only';
import { formatPrice } from '@/lib/format';
import { runAsSystem } from '@/server/db/context';
import type { OrderStatus } from '@/server/db/enums';
import { logger } from '@/server/logger';
import { notify } from '@/server/modules/notifications/service';
import { arrivalText } from './emails';
import type { OrderNoticeStatus } from './progress-schema';
import { claimNotice, findOrderChange, findStepEvent } from './repo';
import type { OrderView } from './schema';
import { loadOrderViewAsSystem } from './views';

/*
 * The customer's order notices for the kitchen's steps and the hand-over (F5 S6.1 to S6.3).
 * Accepted and Ready wait out the board's undo window in a job; On its way and Delivered go at
 * once. Each step notifies at most once per order: the sender claims it in
 * `orders.notified_steps` with one conditional update, so a step redone after a move back, a
 * retried job or a double press sends nothing more.
 */

/** The steps stored in `notified_steps`. */
export type NoticeStep = 'accepted' | 'ready' | 'picked-up' | 'delivered' | 'cancelled';

const NOTICE_STATUS: Record<NoticeStep, OrderNoticeStatus> = {
  accepted: 'accepted',
  ready: 'ready',
  'picked-up': 'pickedUp',
  delivered: 'delivered',
  cancelled: 'cancelled',
};

const RANK: Partial<Record<OrderStatus, number>> = {
  PLACED: 0,
  ACCEPTED: 1,
  PREPARING: 2,
  READY: 3,
  PICKED_UP: 4,
  DELIVERED: 5,
};

export type StepNoticeVerdict = 'send' | 'undone' | 'cancelled' | 'notReached' | 'overtaken';

/**
 * Whether a delayed step notice still goes out (B19): not when its move was undone, the order
 * was cancelled, it is no longer at or past the step, or a later step that notifies was reached
 * first (Ready overtakes Accepted; a hand-over overtakes Ready). Start cooking overtakes
 * nothing.
 */
export function stepNoticeVerdict(
  step: 'accepted' | 'ready',
  move: { type: string; undone: boolean } | null,
  status: OrderStatus,
): StepNoticeVerdict {
  if (!move || move.type !== step || move.undone) return 'undone';
  if (status === 'CANCELLED') return 'cancelled';
  const rank = RANK[status];
  if (rank === undefined) return 'notReached';
  const at = step === 'accepted' ? 1 : 3;
  const overtakenAt = step === 'accepted' ? 3 : 4;
  if (rank < at) return 'notReached';
  if (rank >= overtakenAt) return 'overtaken';
  return 'send';
}

/** "Arriving about 8:09–8:19 pm." while the window the page shows hasn't passed. */
function arrivingLine(view: OrderView) {
  const arrival = view.progress.arrival;
  if (!arrival || arrival.kind === 'pastDue') return '';
  return ` Arriving about ${arrivalText(arrival.from, arrival.to, view.store.timeZone)}.`;
}

/** The words of each step notice (S6.1). */
export function stepNoticeText(step: Exclude<NoticeStep, 'cancelled'>, view: OrderView) {
  const number = view.number;
  switch (step) {
    case 'accepted':
      return {
        title: `Order ${number} accepted`,
        body: 'The kitchen has your order and will start cooking soon.',
      };
    case 'ready':
      return {
        title: `Order ${number} is ready`,
        body: `It's packed and waiting for the courier.${arrivingLine(view)}`,
      };
    case 'picked-up':
      return {
        title: `Order ${number} is on its way`,
        body: `It's left the kitchen.${arrivingLine(view)}`,
      };
    case 'delivered':
    default:
      return {
        title: `Order ${number} was delivered`,
        body: view.progress.cashCollected
          ? `Paid ${formatPrice(view.breakdown.totalCents)} in cash. Enjoy your meal.`
          : 'Enjoy your meal.',
      };
  }
}

/** Claims a step for an order: true for the one sender that may notify. */
export function claimOrderNotice(orderId: string, step: NoticeStep) {
  return runAsSystem('order notice', (ctx) => claimNotice(ctx, orderId, step));
}

/** The order-notice fields `notify()` publishes with `kind: 'order'`. */
export const orderNoticeMeta = (view: OrderView, step: NoticeStep) => ({
  orderId: view.id,
  orderNumber: view.number,
  status: NOTICE_STATUS[step],
});

async function notifyStep(orderId: string, step: Exclude<NoticeStep, 'cancelled'>) {
  const loaded = await loadOrderViewAsSystem(orderId);
  if (!loaded) return 'skipped' as const;
  if (!(await claimOrderNotice(orderId, step))) return 'already-sent' as const;
  const text = stepNoticeText(step, loaded.view);
  await notify({
    userId: loaded.userId,
    type: `order.${step}`,
    title: text.title,
    body: text.body,
    link: `/orders/${orderId}`,
    order: orderNoticeMeta(loaded.view, step),
  });
  return 'sent' as const;
}

/**
 * The delayed notice for Accepted or Ready, run by the job once `dueAt` has passed. Undone,
 * cancelled, moved back or overtaken steps send nothing.
 */
export async function sendOrderStepNotice(input: {
  orderId: string;
  step: 'accepted' | 'ready';
  eventId: string;
}): Promise<StepNoticeVerdict | 'already-sent' | 'skipped'> {
  const facts = await runAsSystem('order step notice', async (ctx) => ({
    order: await findOrderChange(ctx, input.orderId),
    move: await findStepEvent(ctx, input.orderId, input.eventId),
  }));
  if (!facts.order) return 'skipped';
  const verdict = stepNoticeVerdict(input.step, facts.move, facts.order.status);
  if (verdict !== 'send') {
    logger.info({ orderId: input.orderId, step: input.step, verdict }, 'order step notice dropped');
    return verdict;
  }
  const sent = await notifyStep(input.orderId, input.step);
  return sent === 'sent' ? 'send' : sent;
}

/** On its way and Delivered: no undo, so they go at once (still once per order). */
export function sendOrderNotice(orderId: string, step: 'picked-up' | 'delivered') {
  return notifyStep(orderId, step);
}
