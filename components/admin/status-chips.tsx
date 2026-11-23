import { LogOut, RefreshCw, Store, WifiOff } from 'lucide-react';
import type { ReactNode } from 'react';
import type { LiveChipState } from '@/lib/board/connection';
import { cn } from '@/lib/utils';

/*
 * The store state and live chips in the top bar (F5 design 1.4). Plain text, not buttons and
 * not live regions: their changes are announced once through announce(). The live dot never
 * pulses: nothing on the board moves on its own.
 */

const CHIP =
  'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-body-5 font-medium whitespace-nowrap text-neutral-1';

function Chip({ className, children }: { className: string; children: ReactNode }) {
  return <span className={cn(CHIP, className)}>{children}</span>;
}

export function StoreChip({
  store,
  className,
}: {
  store: { isOpen: boolean; label: string };
  className?: string;
}) {
  return (
    <Chip className={cn(store.isOpen ? 'bg-brand-soft' : 'bg-neutral-7', className)}>
      <Store
        className={cn('size-3.5', store.isOpen ? 'text-brand-strong' : 'text-neutral-3')}
        aria-hidden
      />
      {store.label}
    </Chip>
  );
}

const LIVE: Record<LiveChipState, { text: string; className: string; icon: ReactNode }> = {
  live: {
    text: 'Live',
    className: 'bg-brand-soft',
    icon: <span className="size-2 rounded-full bg-brand-strong" aria-hidden />,
  },
  reconnecting: {
    text: 'Reconnecting…',
    className: 'bg-tag-6-bg',
    icon: <RefreshCw className="size-3.5 text-warning-strong" aria-hidden />,
  },
  notLive: {
    text: 'Not live',
    className: 'bg-neutral-7',
    icon: <RefreshCw className="size-3.5 text-neutral-3" aria-hidden />,
  },
  offline: {
    text: 'Offline',
    className: 'bg-neutral-7',
    icon: <WifiOff className="size-3.5 text-neutral-3" aria-hidden />,
  },
  signedOut: {
    text: 'Signed out',
    className: 'bg-neutral-7',
    icon: <LogOut className="size-3.5 text-neutral-3" aria-hidden />,
  },
};

export function LiveChip({ state, className }: { state: LiveChipState; className?: string }) {
  const chip = LIVE[state];
  return (
    <Chip className={cn(chip.className, className)}>
      {chip.icon}
      {chip.text}
    </Chip>
  );
}
