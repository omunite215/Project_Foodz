'use client';

import { Clock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { storeStatusAt } from '@/server/modules/menu/hours';
import type { StoreStatus as Status } from '@/server/modules/menu/schema';
import { closedNoticeText, storeStatusText } from '@/lib/format';
import { cn } from '@/lib/utils';

const RECHECK_MS = 60_000;

/**
 * The store's status computed on the server (Boston time), re-checked in the browser every
 * minute so a page left open turns from open to closed on time. Not a live region: the text
 * changes quietly and screen readers hear it when they reach it.
 */
export function useStoreStatus(initial: Status): Status {
  const [status, setStatus] = useState(initial);

  useEffect(() => {
    const timer = setInterval(() => setStatus(storeStatusAt(initial, new Date())), RECHECK_MS);
    return () => clearInterval(timer);
  }, [initial]);

  return status;
}

export function StoreClosedNotice({
  opensAt,
  className,
}: {
  opensAt: Status['opensAt'];
  className?: string;
}) {
  return (
    <div
      className={cn('flex gap-3 rounded-xl bg-tag-6-bg p-4 text-left text-neutral-1', className)}
    >
      <Clock className="mt-0.5 size-5 shrink-0 text-tag-6" aria-hidden />
      <div>
        <p className="text-body-4 font-semibold">We&apos;re closed right now</p>
        <p className="text-body-5">{closedNoticeText(opensAt)}</p>
      </div>
    </div>
  );
}

export function StoreOpenPill({ status, className }: { status: Status; className?: string }) {
  return (
    <p
      className={cn(
        'inline-flex h-8 items-center gap-2 rounded-full bg-brand-soft px-3 text-body-5 font-medium text-neutral-1',
        className,
      )}
    >
      <span className="size-2 rounded-full bg-brand-strong" aria-hidden />
      {storeStatusText(status)}
    </p>
  );
}

/**
 * "Open now · until 10 pm", or the closed notice in the same place. With `hideWhenOpen` (the
 * dish page) only the closed notice shows.
 */
export function StoreStatus({
  status: initial,
  hideWhenOpen = false,
  className,
}: {
  status: Status;
  hideWhenOpen?: boolean;
  className?: string;
}) {
  const status = useStoreStatus(initial);

  if (status.isOpen) {
    return hideWhenOpen ? null : <StoreOpenPill status={status} className={className} />;
  }
  return <StoreClosedNotice opensAt={status.opensAt} className={className} />;
}
