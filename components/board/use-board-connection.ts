'use client';

import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { type ConnectionKind, connectionKind, refreshInterval } from '@/lib/board/connection';
import { useRealtimeStatus } from '@/lib/realtime/client';
import { channels } from '@/lib/realtime/channels';
import { useHydrated } from '@/lib/use-hydrated';
import { useOnline } from '@/lib/use-online';

/*
 * The board's connection (F5 design 2.12, A12): the realtime status turned into what the chip
 * and banners say, the refresh cadence, and the moments that need a fresh copy: the first
 * subscription (events between the server render and now) and every reconnect (A12.3).
 */

export interface BoardConnection {
  kind: ConnectionKind;
  /** The `private-ops` channel once realtime may be used; null otherwise. */
  channel: string | null;
  /** The refresh interval for this state. */
  refreshEvery: number | false;
}

export function useBoardConnection({
  configured,
  signedOut,
  onFirstLive,
  onReconnected,
}: {
  configured: boolean;
  signedOut: boolean;
  /** The first subscription: a quiet refresh, no banner. */
  onFirstLive: () => void;
  /** Back after a drop: refresh, then say what changed. Resolves when the copy has arrived. */
  onReconnected: () => Promise<void>;
}): BoardConnection {
  const hydrated = useHydrated();
  const online = useOnline();
  // The two-factor gate never gets here; the board itself only subscribes after hydration.
  const channel = hydrated && configured && !signedOut ? channels.ops : null;
  const realtime = useRealtimeStatus(channel);
  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [droppedAt, setDroppedAt] = useState<number | null>(null);
  const [catchingUp, setCatchingUp] = useState(false);
  const wasLive = useRef(false);
  const everLive = useRef(false);
  const [everConnected, setEverConnected] = useState(false);

  const firstLive = useEffectEvent(onFirstLive);
  const reconnected = useEffectEvent(onReconnected);

  useEffect(() => {
    const live = realtime.status === 'connected';
    if (live && !wasLive.current) {
      wasLive.current = true;
      const timer = setTimeout(() => {
        setDroppedAt(null);
        if (!everLive.current) {
          everLive.current = true;
          setEverConnected(true);
          firstLive();
          return;
        }
        setCatchingUp(true);
        void reconnected().finally(() => setCatchingUp(false));
      }, 0);
      return () => clearTimeout(timer);
    }
    if (!live && wasLive.current) {
      wasLive.current = false;
      const timer = setTimeout(() => setDroppedAt(Date.now()), 0);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [realtime.status]);

  // The 5 and 30 second thresholds (and the first connection's 10) need a clock while not live.
  useEffect(() => {
    if (realtime.status === 'connected') return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [realtime.status]);

  const kind = connectionKind({
    configured,
    realtime: channel ? realtime.status : configured ? 'reconnecting' : 'unavailable',
    online,
    signedOut,
    everConnected,
    droppedAt,
    startedAt,
    catchingUp,
    now: Math.max(now, startedAt),
  });

  return { kind, channel, refreshEvery: refreshInterval(kind) };
}
