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
  /**
   * Partner news (F6 design 11): the pending screen acts on `type` without reading the text.
   * Bodies never carry a reviewer's reason or message (design D23).
   */
  | { kind: 'partner'; type: PartnerNoticeType }
);

export const PARTNER_NOTICE_TYPES = [
  'partner.application-received',
  'partner.sent-back',
  'partner.approved',
  'partner.rejected',
  'partner.reopened',
  'partner.suspended',
  'partner.reinstated',
  'partner.offline-no-location',
  'partner.offline-kitchen-closed',
] as const;
export type PartnerNoticeType = (typeof PARTNER_NOTICE_TYPES)[number];

/** Why a partner's online state changed (F6 B10, design "[BE] needs"). */
export type PartnerAvailabilityReason =
  | 'self'
  | 'no-location'
  | 'kitchen-closed'
  | 'other-device'
  | 'suspended'
  | 'signed-out'
  | 'demo-other-visitor';

/**
 * On `private-partner-{id}`: the partner went online or offline. `changeId` matches the one in
 * the answer to the request that caused it, so the device that asked ignores its own echo; every
 * other device follows it. No position, no personal data, no reason text.
 */
export interface PartnerAvailabilityChangedEvent {
  online: boolean;
  reason: PartnerAvailabilityReason;
  changeId: string;
  at: string;
}

/**
 * On `private-partner-{id}`: approved, suspended or reinstated. A suspension stops location at
 * once, before anything is drawn (design 5.9). Applicants hear decisions through
 * `notification.created`, since they aren't partners yet (B10).
 */
export interface PartnerStatusChangedEvent {
  status: 'APPROVED' | 'SUSPENDED';
  at: string;
}

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
  'partner.availability-changed': PartnerAvailabilityChangedEvent;
  'partner.status-changed': PartnerStatusChangedEvent;
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
