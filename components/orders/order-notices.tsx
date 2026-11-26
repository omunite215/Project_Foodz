'use client';

import {
  CircleX,
  ClipboardCheck,
  House,
  type LucideIcon,
  PackageCheck,
  Star,
  Truck,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useReducer, useRef, useState } from 'react';
import type { OrderNoticeStatus } from '@/server/modules/orders/progress-schema';
import { Button } from '@/components/ui/button';
import { announce } from '@/lib/announce';
import { useMotion } from '@/lib/motion';
import {
  dismissNoticeName,
  noticeHiddenOn,
  type OrderNotice,
  orderNoticesReducer,
  viewOrderName,
} from '@/lib/order-notices';
import { orderHref } from '@/lib/order-text';
import { channels } from '@/lib/realtime/channels';
import { useChannelEvent } from '@/lib/realtime/client';
import { useHydrated } from '@/lib/use-hydrated';
import { cn } from '@/lib/utils';

/*
 * Order notices in the visible tab (F5 design 9, S6.4): one per order, at most three, above any
 * pinned bar. They never take focus, are announced once (title and body), and leave after 10
 * seconds of visible time (held while hovered or focused); a cancellation stays until
 * dismissed. Never on that order's own page or the orders list, which change in place.
 */

const ICONS: Record<OrderNoticeStatus, LucideIcon> = {
  accepted: ClipboardCheck,
  ready: PackageCheck,
  pickedUp: Truck,
  delivered: House,
  cancelled: CircleX,
  rate: Star,
};

const TICK_MS = 500;

export function OrderNoticeCard({
  notice,
  onDismiss,
}: {
  notice: OrderNotice;
  onDismiss: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const Icon = ICONS[notice.status];
  const cancelled = notice.status === 'cancelled';
  const titleId = `order-notice-${notice.orderId}`;

  useMotion(
    (motion) => {
      if (!ref.current) return;
      motion.from(ref.current, { y: 8, opacity: 0, duration: motion.reduced ? 0.12 : 0.2 });
    },
    { scope: ref },
  );

  return (
    <section
      ref={ref}
      aria-labelledby={titleId}
      className="rounded-xl border border-neutral-6 bg-white p-4 shadow-raised"
    >
      <div className="flex gap-3">
        <span
          aria-hidden
          className={cn(
            'flex size-10 shrink-0 items-center justify-center rounded-full',
            cancelled ? 'bg-tag-2-bg' : 'bg-brand-soft',
          )}
        >
          <Icon className={cn('size-5', cancelled ? 'text-destructive' : 'text-brand-strong')} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="text-body-4 font-semibold text-neutral-1">
            {notice.title}
          </h2>
          <p className="mt-0.5 line-clamp-3 text-body-5 text-neutral-3">{notice.body}</p>
          <div className="mt-3 flex gap-2">
            <Button asChild variant="outline" size="touch" className="bg-white">
              <Link href={orderHref(notice.orderId)} aria-label={viewOrderName(notice.orderNumber)}>
                View order
              </Link>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="touch"
              aria-label={dismissNoticeName(notice.orderNumber)}
              onClick={onDismiss}
              onKeyDown={(event) => {
                if (event.key === 'Escape') onDismiss();
              }}
            >
              Dismiss
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

export function OrderNoticeStack({ userId }: { userId: string }) {
  const hydrated = useHydrated();
  const pathname = usePathname();
  const [notices, dispatch] = useReducer(orderNoticesReducer, []);
  const [held, setHeld] = useState(false);
  const stackRef = useRef<HTMLElement>(null);

  useChannelEvent(hydrated ? channels.user(userId) : null, 'notification.created', (event) => {
    if (event.kind !== 'order' || !navigator.onLine) return;
    dispatch({ type: 'received', event });
    if (!noticeHiddenOn(window.location.pathname, event.orderId)) {
      announce(`${event.title}. ${event.body}`);
    }
  });

  // Only visible time counts, and none while the person is hovering or inside a notice.
  useEffect(() => {
    if (held || notices.every((notice) => notice.leftMs === null)) return undefined;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') dispatch({ type: 'elapsed', ms: TICK_MS });
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [held, notices]);

  useEffect(() => {
    const stack = stackRef.current;
    if (!stack) return undefined;
    const hold = () => setHeld(true);
    const release = (event: Event) => {
      const next = event instanceof FocusEvent ? event.relatedTarget : null;
      if (next instanceof Node && stack.contains(next)) return;
      setHeld(false);
    };
    stack.addEventListener('pointerenter', hold);
    stack.addEventListener('pointerleave', release);
    stack.addEventListener('focusin', hold);
    stack.addEventListener('focusout', release);
    return () => {
      stack.removeEventListener('pointerenter', hold);
      stack.removeEventListener('pointerleave', release);
      stack.removeEventListener('focusin', hold);
      stack.removeEventListener('focusout', release);
    };
  });

  const shown = notices.filter((notice) => !noticeHiddenOn(pathname, notice.orderId));
  if (shown.length === 0) return null;
  return (
    <aside
      ref={stackRef}
      aria-label="Order updates"
      className="fixed inset-x-4 bottom-[calc(var(--pinned-bottom,0px)+1rem)] z-40 flex flex-col gap-2 md:right-6 md:left-auto md:w-[400px]"
    >
      {shown.map((notice) => (
        <OrderNoticeCard
          key={notice.id}
          notice={notice}
          onDismiss={() => dispatch({ type: 'dismissed', orderId: notice.orderId })}
        />
      ))}
    </aside>
  );
}
