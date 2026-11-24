'use client';

import { TriangleAlert } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Banner, BannerAction } from '@/components/admin/banners';
import { BLOCKED_BUTTON_CLASS } from '@/components/forms/submit-button';
import { announce } from '@/lib/announce';
import { NOBODY_ONLINE_TEXT, noCourierBannerText } from '@/lib/board/courier-text';
import { audioContext, NO_COURIER_REPEAT_MS, playNoCourierChime } from '@/lib/board/sound';
import { READ_ONLY_CAPTION } from '@/lib/board/text';

/*
 * The no-courier banners (F7 design 2.9, A39): after F5's "orders waiting", one for orders
 * with no courier after 5 minutes and one when nobody is online. Their words are read once
 * when they appear; the falling chime plays when an order escalates and every 2 minutes while
 * any order is still without a courier, only when the board's sound is on. Sound is never the
 * only signal.
 */

export function NoCourierBanner({
  orders,
  viewer,
  readOnly,
  onAssign,
  onShowOldest,
}: {
  orders: readonly { id: string; number: string }[];
  viewer: 'kitchen' | 'full';
  readOnly: boolean;
  onAssign: (orderId: string) => void;
  onShowOldest: () => void;
}) {
  const words = noCourierBannerText(orders, viewer);
  if (!words) return null;
  const first = orders[0];
  const action =
    words.action === 'assign' && first ? (
      <BannerAction
        onClick={() => {
          if (readOnly) {
            announce(READ_ONLY_CAPTION);
            return;
          }
          onAssign(first.id);
        }}
        className={readOnly ? BLOCKED_BUTTON_CLASS : undefined}
      >
        Assign courier
      </BannerAction>
    ) : words.action === 'show' ? (
      <BannerAction onClick={onShowOldest}>Show the oldest</BannerAction>
    ) : null;
  return (
    <Banner
      key={words.text}
      variant="error"
      icon={TriangleAlert}
      action={action}
      data-banner="no-courier"
    >
      {words.text}
    </Banner>
  );
}

export function NobodyOnlineBanner() {
  return (
    <Banner variant="error" icon={TriangleAlert} data-banner="no-couriers-online">
      {NOBODY_ONLINE_TEXT}
    </Banner>
  );
}

/**
 * The falling chime: once when a new order escalates, then every 2 minutes while any order is
 * without a courier (U23). Only when the board's sound is on.
 */
export function useNoCourierChime(escalatedIds: readonly string[], soundOn: boolean) {
  const heard = useRef<Set<string>>(new Set());
  const key = escalatedIds.join(',');
  const any = escalatedIds.length > 0;

  useEffect(() => {
    const fresh = escalatedIds.filter((id) => !heard.current.has(id));
    heard.current = new Set(escalatedIds);
    if (!soundOn || fresh.length === 0) return;
    const context = audioContext();
    if (context?.state === 'running') playNoCourierChime(context);
    // Keyed by the set of orders, not the array.
    // oxlint-disable-next-line react/exhaustive-deps
  }, [key, soundOn]);

  useEffect(() => {
    if (!any || !soundOn) return undefined;
    const timer = setInterval(() => {
      const context = audioContext();
      if (context?.state === 'running') playNoCourierChime(context);
    }, NO_COURIER_REPEAT_MS);
    return () => clearInterval(timer);
  }, [any, soundOn]);
}
