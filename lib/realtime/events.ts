/**
 * Payloads of the realtime events the server publishes. Events carry only what the screen
 * needs; anything sensitive is fetched through the normal, authorized data layer.
 */
export interface RealtimeEvents {
  'notification.created': { id: string; title: string; body: string; link: string | null };
  'order.status-changed': { orderId: string; status: string; at: string };
  'courier.location': {
    orderId: string;
    lat: number;
    lng: number;
    heading: number | null;
    at: string;
  };
}

export type RealtimeEventName = keyof RealtimeEvents;
