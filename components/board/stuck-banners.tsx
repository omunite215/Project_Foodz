'use client';

import {
  DoorClosed,
  LockKeyhole,
  type LucideIcon,
  MapPinOff,
  MessageCircleWarning,
  TriangleAlert,
} from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useEffect, useRef } from 'react';
import type { AttentionItem } from '@/server/modules/tracking/schema';
import { Banner, BannerAction } from '@/components/admin/banners';
import { audioContext, playNoCourierChime } from '@/lib/board/sound';
import {
  andMoreText,
  attentionKey,
  attentionListLine,
  attentionLook,
  attentionStackText,
  type BannerLook,
} from '@/lib/board/tracking-text';
import { isSitePath } from '@/lib/navigation';

/*
 * Stuck-delivery banners (F8 design 3.9, A49): after F7's no-courier banners, one banner for a
 * stuck delivery with "Open order", or one that lists the oldest three when there are several.
 * Read once when it appears (the minutes keep counting without being read again); F7's falling
 * chime plays once per new case when the board's sound is on. Sound is never the only signal.
 */

const ICONS: Record<BannerLook['icon'], LucideIcon> = {
  door: DoorClosed,
  lock: LockKeyhole,
  alert: MessageCircleWarning,
  signal: MapPinOff,
};

const orderPath = (orderId: string): Route => {
  const href = `/admin/orders/${orderId}`;
  return isSitePath(href) ? href : '/admin/orders';
};

const LIST_MAX = 3;

export function StuckBanners({
  items,
  onOpen,
}: {
  /** Oldest first, words ready (the board's `attention`). */
  items: readonly AttentionItem[];
  /** "Open order": the detail panel; focus comes back to the banner's button. */
  onOpen: (orderId: string) => void;
}) {
  const first = items[0];
  if (!first) return null;
  if (items.length === 1) {
    const look = attentionLook(first);
    return (
      <Banner
        key={`stuck-${attentionKey(first)}`}
        variant={look.variant}
        icon={ICONS[look.icon]}
        data-banner="stuck"
        action={<BannerAction onClick={() => onOpen(first.orderId)}>Open order</BannerAction>}
      >
        {first.words}
      </Banner>
    );
  }
  const shown = items.slice(0, LIST_MAX);
  const more = items.length - shown.length;
  return (
    <Banner key="stuck-many" variant="error" icon={TriangleAlert} data-banner="stuck">
      <p>{attentionStackText(items.length)}</p>
      <ul className="mt-1 space-y-1 text-body-5">
        {shown.map((item) => (
          <li key={attentionKey(item)}>
            <Link
              href={orderPath(item.orderId)}
              scroll={false}
              className="inline-flex min-h-6 items-center underline underline-offset-4"
            >
              {attentionListLine(item)}
            </Link>
          </li>
        ))}
        {more > 0 ? (
          <li>
            <Link
              href={{ pathname: '/admin/map', query: { tab: 'deliveries' } }}
              className="inline-flex min-h-6 items-center underline underline-offset-4"
            >
              {andMoreText(more)}
            </Link>
          </li>
        ) : null}
      </ul>
    </Banner>
  );
}

/** A49.1: F7's chime once for each new stuck case, only with the board's sound on. */
export function useStuckChime(items: readonly AttentionItem[], soundOn: boolean) {
  const heard = useRef<Set<string>>(new Set());
  const key = items.map(attentionKey).join(',');
  useEffect(() => {
    const now = new Set(items.map(attentionKey));
    const before = heard.current;
    heard.current = now;
    if (!soundOn || ![...now].some((item) => !before.has(item))) return;
    const context = audioContext();
    if (context?.state === 'running') playNoCourierChime(context);
    // Keyed by the set of cases, not the array.
    // oxlint-disable-next-line react/exhaustive-deps
  }, [key, soundOn]);
}
