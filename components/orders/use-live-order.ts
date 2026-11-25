'use client';

import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type { OrderView } from '@/server/modules/orders/schema';
import { announce } from '@/lib/announce';
import { cancellationAnnouncement, statusAnnouncement } from '@/lib/order-progress';
import { tracksLive } from '@/lib/order-tracking';
import { channels } from '@/lib/realtime/channels';
import { adoptTrackingView, forgetTracking, onCourierLocation } from '@/lib/tracking/live-point';
import { useChannelEvent, useRealtimeStatus } from '@/lib/realtime/client';
import { useHydrated } from '@/lib/use-hydrated';
import { useOnline } from '@/lib/use-online';
import type { LiveLine } from './order-progress';

/*
 * Keeps the customer's order page current (F5 design 6.6, S3): realtime on the order's own
 * channel triggers a refetch of the view (events carry ids, status, version and time only), a
 * quiet refresh every 60 s while visible and connected, every 15 s without realtime, and at the
 * view's own `refreshAt`. A finished order holds no connection. After the session ends the
 * subscription is dropped (S3.10, security note S21). Status changes are announced once;
 * a store cancellation assertively (S5.8).
 */

const REFRESH_MS = 60_000;
const POLL_MS = 15_000;
/** "Reconnecting…" shows after a drop of more than 10 s (S3.2). */
const BEHIND_AFTER_MS = 10_000;

export function useLiveOrder({
  view,
  refetch,
  signedOut,
}: {
  view: OrderView;
  /** Fetches the view again; resolves with it, or null when that failed. */
  refetch: () => Promise<OrderView | null>;
  signedOut: boolean;
}): LiveLine {
  const hydrated = useHydrated();
  const online = useOnline();
  const live = view.progress.live;
  const channel = hydrated && live && !signedOut ? channels.order(view.id) : null;
  const realtime = useRealtimeStatus(channel);
  const connected = realtime.status === 'connected';
  const [droppedAt, setDroppedAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const version = useRef(view.progress.version);
  const shown = useRef(view);

  const refresh = useEffectEvent(() => void refetch());

  // Events older than what the page shows are ignored (S3.7).
  useChannelEvent(channel, 'order.status-changed', (event) => {
    if (event.version > version.current) void refetch();
  });
  // F7 S5.1: a change of courier leaves the order's version alone; the view is read again.
  useChannelEvent(channel, 'delivery.changed', () => void refetch());

  // F8 (L2): the courier's point on the order's own track channel, picked up to delivered. The
  // view's point is adopted first; nothing of his position stays once tracking ends (S6.1).
  const tracking = view.progress.tracking ?? null;
  const tracked = tracksLive(tracking);
  const trackChannel = channel && tracked ? channels.track(view.id) : null;
  useChannelEvent(trackChannel, 'courier.location', (event) => onCourierLocation(event));
  useEffect(() => {
    if (tracked && tracking) {
      adoptTrackingView(view.id, tracking.courierPoint, view.progress.asOf);
    } else {
      forgetTracking();
    }
  }, [tracked, tracking, view.id, view.progress.asOf]);

  // Announce what changed, once: the current status after a catch-up, never the old ones.
  useEffect(() => {
    const before = shown.current;
    shown.current = view;
    version.current = Math.max(version.current, view.progress.version);
    if (before === view || before.progress.version === view.progress.version) return;
    const cancellation = view.progress.cancellation;
    if (
      view.status === 'CANCELLED' &&
      before.status !== 'CANCELLED' &&
      cancellation?.by === 'store'
    ) {
      announce(cancellationAnnouncement(view.number, cancellation), { assertive: true });
      return;
    }
    if (view.status !== before.status) {
      const message = statusAnnouncement(view);
      if (message) announce(message);
    }
  }, [view]);

  // A drop after being live: when it started, for the 10-second "Reconnecting…". Without
  // realtime at all the page polls silently and says it updates by itself (S3.6).
  const dropped = Boolean(channel) && realtime.status === 'reconnecting' && realtime.everConnected;
  useEffect(() => {
    const timer = setTimeout(
      () => setDroppedAt((current) => (dropped ? (current ?? Date.now()) : null)),
      0,
    );
    return () => clearTimeout(timer);
  }, [dropped]);
  useEffect(() => {
    if (droppedAt === null) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [droppedAt]);

  // Back after a drop: a fresh copy first (S3.3).
  const wasConnected = useRef(false);
  useEffect(() => {
    if (connected && !wasConnected.current) refresh();
    wasConnected.current = connected;
  }, [connected]);

  // Quiet refreshes while visible: 60 s connected, 15 s without realtime (S3.5, S3.6).
  useEffect(() => {
    if (!hydrated || !live || signedOut) return undefined;
    const every = connected ? REFRESH_MS : POLL_MS;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, every);
    return () => clearInterval(timer);
  }, [hydrated, live, signedOut, connected]);

  // The next moment the answer changes by itself (a wait line, the window passing).
  const refreshAt = view.progress.refreshAt;
  useEffect(() => {
    if (!refreshAt || signedOut) return undefined;
    const wait = Date.parse(refreshAt) - Date.parse(view.progress.asOf);
    if (wait <= 0 || wait > 24 * 60 * 60 * 1000) return undefined;
    const timer = setTimeout(() => refresh(), wait + 500);
    return () => clearTimeout(timer);
  }, [refreshAt, view.progress.asOf, signedOut]);

  if (!live) return 'hidden';
  if (!online) return 'hidden';
  if (signedOut || realtime.status === 'signedOut') return 'signedOut';
  if (droppedAt !== null && now - droppedAt > BEHIND_AFTER_MS) return 'behind';
  return 'live';
}
