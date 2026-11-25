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
  // F7 P25.2.
  'partner.offline-missed-offers',
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
  | 'demo-other-visitor'
  // F7 P25.2: three automatic offers in a row shown on the phone and not answered.
  | 'missed-offers';

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

/** F7: an offer was made to this partner. `expiresAt` is the database's clock. */
export interface OfferCreatedEvent {
  offerId: string;
  expiresAt: string;
}

/** F7: why an offer ended, so the phone picks the right notice (design 1.7). */
export interface OfferEndedEvent {
  offerId: string;
  why:
    | 'expired'
    | 'declined'
    | 'withdrawn-order'
    | 'withdrawn-staff'
    | 'taken'
    | 'withdrawn-offline';
}

/** F7: the delivery of an order changed. `version` orders events as F5's do. */
export interface DeliveryChangedEvent {
  orderId: string;
  status: 'SEARCHING' | 'ASSIGNED' | 'AT_RESTAURANT' | 'PICKED_UP' | 'DELIVERED' | 'CANCELLED';
  version: number;
  at: string;
  /**
   * F8, on the partner's own channel only: why staff changed his delivery, so the phone picks
   * the right words (design 2.9, 2.10). Never on the order or ops channels.
   */
  notice?: 'askedToWait' | 'confirmed' | 'cancelledBringBack' | 'markedDelivered';
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
  /** F7, on `private-partner-{id}`: an offer for this partner; the card fetches the rest (P33.3). */
  'offer.created': OfferCreatedEvent;
  /** F7, on `private-partner-{id}`: the offer ended without this phone's answer (P24). */
  'offer.ended': OfferEndedEvent;
  /**
   * F7, on `private-ops`, `private-order-{id}` and the assigned (or released) partner's channel:
   * the order's delivery changed (A34.4, S5.1, W11.1). Names, phones, positions and distances
   * are fetched through the authorized data layer, never sent here.
   */
  'delivery.changed': DeliveryChangedEvent;
  /** On `private-ops`: "86 it" from any board (design 4.3). */
  'menu.availability-changed': { dishId: string; available: boolean; at: string };
  /**
   * F8, on `private-track-{orderId}` only (not the order channel, which staff can watch): the
   * courier's latest accepted point, at most every 4 s, picked up to delivered (L2.1).
   */
  'courier.location': {
    orderId: string;
    lat: number;
    lng: number;
    heading: number | null;
    at: string;
  };
  /**
   * F8, on `private-ops-map` or `private-ops-map-demo`: an online courier's point, at most every
   * 10 s and at once on a state change (L3.1). No name, phone or address (L9.2).
   */
  'courier.position': {
    partnerId: string;
    lat: number;
    lng: number;
    heading: number | null;
    state:
      | 'free'
      | 'offered'
      | 'toKitchen'
      | 'atKitchen'
      | 'delivering'
      | 'noAnswer'
      | 'problem'
      | 'locked';
    at: string;
  };
  /** F8, on `private-ops-map-demo`: the demo run started, moved on or ended (A54). */
  'demo.run-changed': { running: boolean; endsAt: string | null; at: string };
}

export type RealtimeEventName = keyof RealtimeEvents;
