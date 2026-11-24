import type { OrderStatus } from '@/server/db/enums';
import type { OrderNoticeStatus } from '@/server/modules/orders/progress-schema';

/**
 * Payloads of the realtime events the server publishes. Events carry only what the screen
 * needs; anything sensitive is fetched through the normal, authorized data layer. Order events
 * carry ids, status, version and time only: no names, contact details, notes, reasons or
 * amounts (F5 A12.7, S6.8).
 */

/**
 * An order changed. `version` is the order's version after the change: a lower one than the
 * screen already holds is old and is ignored, and the same one is a repeat (A12.5, S3.7).
 * `at` is the server's time of the change (the step time for a status change).
 */
export interface OrderChangedEvent {
  orderId: string;
  status: OrderStatus;
  version: number;
  at: string;
}

/**
 * A notification saved for the user, on `private-user-{id}`. Order notices (F5 S6.1) say which
 * order and step they are about, so the order notice can stay off that order's page and the
 * orders list without reading the link.
 */
export type NotificationCreatedEvent = {
  id: string;
  title: string;
  body: string;
  link: string | null;
} & (
  | { kind: 'general' }
  | {
      kind: 'order';
      orderId: string;
      orderNumber: string;
      status: OrderNoticeStatus;
    }
);

export interface RealtimeEvents {
  'notification.created': NotificationCreatedEvent;
  /**
   * On `private-order-{id}` (the order page) and `private-user-{customerId}` (the orders list
   * and the order notice): every change of status or payment of that order.
   */
  'order.status-changed': OrderChangedEvent;
  /**
   * On `private-ops`: an order joined the board (placed or paid), changed on it, or left it
   * (cancelled, delivered). Orders waiting for payment or failed are never published here.
   */
  'order.board-changed': OrderChangedEvent;
  /** On `private-ops`: "86 it" from any board (design 4.3). */
  'menu.availability-changed': { dishId: string; available: boolean; at: string };
  'courier.location': {
    orderId: string;
    lat: number;
    lng: number;
    heading: number | null;
    at: string;
  };
}

export type RealtimeEventName = keyof RealtimeEvents;
