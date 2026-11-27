'use client';

import { useSelector } from '@tanstack/react-store';
import { ChevronRight, Wallet } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import type { TodayLine } from '@/server/modules/earnings/schema';
import { dispatchStore } from '@/lib/partner/dispatch';
import { todayLine } from '@/lib/partner/earnings-text';
import { channels } from '@/lib/realtime/channels';
import { useChannelEvent } from '@/lib/realtime/client';
import { fetchSummary } from './earnings-data';

/*
 * Home's "Today" line (F9 design 1.11): one 48 px link to Earnings under the status, offline
 * and online idle. It follows `earnings.changed` quietly; it isn't a live region.
 */

export function TodayLink({ partnerId, initial }: { partnerId: string; initial: TodayLine }) {
  const [fetched, setFetched] = useState({ line: initial, at: 0 });
  // QA F4: the delivered sheet's own figures, read with the hand-over, win until a newer read.
  const handedOver = useSelector(dispatchStore, (state) => state.latestToday);
  const today =
    handedOver && handedOver.at > fetched.at
      ? { earnedCents: handedOver.earnedCents, deliveries: handedOver.deliveries }
      : fetched.line;
  const refresh = () => {
    const asked = Date.now();
    fetchSummary()
      .then((summary) =>
        setFetched({
          line: { earnedCents: summary.today.earnedCents, deliveries: summary.today.deliveries },
          at: asked,
        }),
      )
      .catch(() => {
        // The last value stays (design, States: "Last value").
      });
  };
  const channel = channels.partner(partnerId);
  useChannelEvent(channel, 'earnings.changed', refresh);
  useChannelEvent(channel, 'delivery.changed', (event) => {
    if (event.status === 'DELIVERED' || event.status === 'CANCELLED') refresh();
  });
  return <TodayLinkView today={today} />;
}

/** The line itself (also for stories): the words, the icon, and ", see earnings" in its name. */
export function TodayLinkView({ today }: { today: TodayLine }) {
  return (
    <Link
      href="/partner/earnings"
      // One name, the visible words first (a hidden suffix would be read after a stray space).
      aria-label={`${todayLine(today)}, see earnings`}
      className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-left text-body-4 font-medium text-strong tabular-nums hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid"
    >
      <Wallet className="size-5 shrink-0 text-muted-foreground" aria-hidden />
      <span>{todayLine(today)}</span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  );
}
