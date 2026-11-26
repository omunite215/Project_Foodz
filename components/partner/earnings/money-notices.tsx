'use client';

import { useSelector } from '@tanstack/react-store';
import { Banknote, CircleMinus, CirclePlus, Landmark, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { announce } from '@/lib/announce';
import {
  addMoneyNotice,
  dismissMoneyNotice,
  type MoneyNoticeKind,
  moneyNoticeOf,
  moneyNoticeStore,
  moneyNoticeTone,
} from '@/lib/partner/money-notices';
import { channels } from '@/lib/realtime/channels';
import { useChannelEvent } from '@/lib/realtime/client';
import { PartnerNotice } from '../shell';

/*
 * The staff money notices in an app screen's notice slot (F9 design 1.10): Home, Earnings,
 * Profile and Your ratings. Never over an offer card (the layer covers the page and they wait
 * underneath), never a staff name, and they stay until dismissed. "See earnings" everywhere but
 * on Earnings itself.
 */

const ICONS: Record<MoneyNoticeKind, LucideIcon> = {
  cash: Banknote,
  added: CirclePlus,
  takenOff: CircleMinus,
  payout: Landmark,
};

export function MoneyNoticeSlot({
  userId,
  onEarnings = false,
}: {
  userId: string | null;
  onEarnings?: boolean;
}) {
  const items = useSelector(moneyNoticeStore, (state) => state.items);
  useChannelEvent(userId ? channels.user(userId) : null, 'notification.created', (event) => {
    const notice = moneyNoticeOf(event);
    if (notice && addMoneyNotice(notice)) announce(notice.text);
  });
  if (items.length === 0) return null;
  return (
    <div className="space-y-3">
      {items.map((item) => (
        <PartnerNotice
          key={item.id}
          tone={moneyNoticeTone(item.kind)}
          icon={ICONS[item.kind]}
          onDismiss={() => dismissMoneyNotice(item.id)}
          action={
            onEarnings ? undefined : (
              <Button asChild variant="outline" size="kitchen" className="bg-card text-strong">
                <Link href="/partner/earnings">See earnings</Link>
              </Button>
            )
          }
        >
          {item.text}
        </PartnerNotice>
      ))}
    </div>
  );
}
