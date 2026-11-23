'use client';

import { CircleCheck, ListFilter, RefreshCw, TriangleAlert, WifiOff } from 'lucide-react';
import { Banner, BannerAction } from '@/components/admin/banners';
import type { ConnectionBanner } from '@/lib/board/connection';
import {
  backOnlineText,
  hiddenByFiltersText,
  NO_REALTIME_TEXT,
  OFFLINE_TEXT,
  OUT_OF_DATE_TEXT,
  pausedText,
} from '@/lib/board/text';

/*
 * The board's own banners (F5 design 1.5), after demo and session ending: one connection
 * banner at a time, then orders waiting, then hidden by filters.
 */

export function ConnectionBannerRow({
  banner,
  lastUpdate,
  timeZone,
}: {
  banner: ConnectionBanner;
  lastUpdate: string | null;
  timeZone: string;
}) {
  switch (banner) {
    case 'paused':
      return (
        <Banner key="paused" variant="info" icon={RefreshCw}>
          {pausedText(lastUpdate, timeZone)}
        </Banner>
      );
    case 'outOfDate':
      return (
        <Banner key="outOfDate" variant="warning" icon={TriangleAlert}>
          {OUT_OF_DATE_TEXT}
        </Banner>
      );
    case 'noRealtime':
      return (
        <Banner key="noRealtime" variant="info" icon={RefreshCw}>
          {NO_REALTIME_TEXT}
        </Banner>
      );
    case 'offline':
      return (
        <Banner key="offline" variant="error" icon={WifiOff}>
          {OFFLINE_TEXT}
        </Banner>
      );
    default:
      return null;
  }
}

export function BackOnlineBanner({
  changed,
  onDismiss,
}: {
  changed: number;
  onDismiss: () => void;
}) {
  return (
    <Banner variant="success" icon={CircleCheck} onDismiss={onDismiss}>
      {backOnlineText(changed)}
    </Banner>
  );
}

export function WaitingBanner({
  text,
  action,
  onShow,
}: {
  text: string;
  action: string;
  onShow: () => void;
}) {
  return (
    <Banner
      variant="error"
      icon={TriangleAlert}
      action={<BannerAction onClick={onShow}>{action}</BannerAction>}
    >
      {text}
    </Banner>
  );
}

export function HiddenByFiltersBanner({ count, onShow }: { count: number; onShow: () => void }) {
  return (
    <Banner
      variant="info"
      icon={ListFilter}
      action={<BannerAction onClick={onShow}>Show</BannerAction>}
    >
      {hiddenByFiltersText(count)}
    </Banner>
  );
}
