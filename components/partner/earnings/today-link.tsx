'use client';

import { ChevronRight, Wallet } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import type { TodayLine } from '@/server/modules/earnings/schema';
import { todayLine } from '@/lib/partner/earnings-text';
import { channels } from '@/lib/realtime/channels';
import { useChannelEvent } from '@/lib/realtime/client';
import { fetchSummary } from './earnings-data';

/*
 * Home's "Today" line (F9 design 1.11): one 48 px link to Earnings under the status, offline
 * and online idle. It follows `earnings.changed` quietly; it isn't a live region.
 */

export function TodayLink({ partnerId, initial }: { partnerId: string; initial: TodayLine }) {
  const [today, setToday] = useState(initial);
  const refresh = () => {
    fetchSummary()
      .then((summary) =>
        setToday({ earnedCents: summary.today.earnedCents, deliveries: summary.today.deliveries }),
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

/** The line itself (also for stories): the words, the icon and a spoken ", see earnings". */
export function TodayLinkView({ today }: { today: TodayLine }) {
  return (
    <Link
      href="/partner/earnings"
      className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-left text-body-4 font-medium text-strong tabular-nums hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid"
    >
      <Wallet className="size-5 shrink-0 text-muted-foreground" aria-hidden />
      <span>
        {todayLine(today)}
        <span className="sr-only">, see earnings</span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  );
}
