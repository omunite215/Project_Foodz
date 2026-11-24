import type { NotificationCreatedEvent } from '@/lib/realtime/events';
import type { OrderNoticeStatus } from '@/server/modules/orders/progress-schema';

/*
 * The order notice in a visible tab (F5 design 9, S6.4): a small notice about one of the
 * customer's orders. Pure rules here: one notice per order (a newer one replaces its text), three
 * at most, never on that order's own page or on the orders list (they change in place), step
 * notices leave after 10 seconds of visible time, cancellations stay until dismissed.
 */

export interface OrderNotice {
  /** The notification's id; changes when a newer one replaces the text. */
  id: string;
  orderId: string;
  orderNumber: string;
  status: OrderNoticeStatus;
  title: string;
  body: string;
  /** Visible milliseconds left; null for notices that stay until dismissed. */
  leftMs: number | null;
}

export const NOTICE_VISIBLE_MS = 10_000;
export const MAX_ORDER_NOTICES = 3;

export type OrderNoticeAction =
  | { type: 'received'; event: NotificationCreatedEvent }
  | { type: 'dismissed'; orderId: string }
  /** Time passed while the tab was visible and the notices weren't held. */
  | { type: 'elapsed'; ms: number };

/** The order notice in a `notification.created` event, or null for a general one. */
export function noticeFrom(event: NotificationCreatedEvent): OrderNotice | null {
  if (event.kind !== 'order') return null;
  return {
    id: event.id,
    orderId: event.orderId,
    orderNumber: event.orderNumber,
    status: event.status,
    title: event.title,
    body: event.body,
    leftMs: event.status === 'cancelled' ? null : NOTICE_VISIBLE_MS,
  };
}

export function orderNoticesReducer(
  notices: readonly OrderNotice[],
  action: OrderNoticeAction,
): OrderNotice[] {
  switch (action.type) {
    case 'received': {
      const notice = noticeFrom(action.event);
      if (!notice) return [...notices];
      const index = notices.findIndex((item) => item.orderId === notice.orderId);
      if (index >= 0) {
        // One per order: the newer notification replaces the text in place.
        return notices.map((item, position) => (position === index ? notice : item));
      }
      return [...notices, notice].slice(-MAX_ORDER_NOTICES);
    }
    case 'dismissed':
      return notices.filter((item) => item.orderId !== action.orderId);
    case 'elapsed':
    default:
      return notices
        .map((item) => (item.leftMs === null ? item : { ...item, leftMs: item.leftMs - action.ms }))
        .filter((item) => item.leftMs === null || item.leftMs > 0);
  }
}

/** Never on that order's own page, nor on the orders list, which change in place. */
export function noticeHiddenOn(pathname: string, orderId: string): boolean {
  return pathname === '/account/orders' || pathname === `/orders/${orderId}`;
}

/** "View order 1042" / "Dismiss notice about order 1042". */
export const viewOrderName = (number: string) => `View order ${number}`;
export const dismissNoticeName = (number: string) => `Dismiss notice about order ${number}`;
