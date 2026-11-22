'use client';

import {
  CircleCheck,
  Clock,
  CreditCard,
  type LucideIcon,
  PackageX,
  TicketPercent,
  TrendingUp,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { type ReactNode, type Ref, useRef } from 'react';
import { FormAlert } from '@/components/forms/form-alert';
import { SubmitButton } from '@/components/forms/submit-button';
import { Button } from '@/components/ui/button';
import { useMotion } from '@/lib/motion';
import { orderHref } from '@/lib/order-text';

/*
 * The notices at the top of checkout and of its Summary (F4 design 2.5, 2.6.4, 2.21). Each says
 * why in words; those that appear after a press take focus once and are announced by the caller.
 */

export interface Notice {
  key: string;
  variant: 'error' | 'warning' | 'info' | 'success';
  icon?: LucideIcon;
  text: ReactNode;
  action?: ReactNode;
  onDismiss?: () => void;
}

export function NoticeList({
  notices,
  className,
  focusRef,
}: {
  notices: readonly Notice[];
  className?: string;
  /** The first notice takes focus (tabIndex -1) when the caller asks. */
  focusRef?: Ref<HTMLDivElement>;
}) {
  const scope = useRef<HTMLDivElement>(null);
  const keys = notices.map((notice) => notice.key).join(',');
  // A notice that appears fades in and rises 4 px; under reduced motion it is simply there.
  const seen = useRef<string | null>(null);
  useMotion(
    (motion) => {
      const before = seen.current;
      seen.current = keys;
      if (before === null || motion.reduced || !scope.current) return;
      const added = [...scope.current.querySelectorAll<HTMLElement>('[data-notice]')].filter(
        (element) => !before.split(',').includes(element.dataset.notice ?? ''),
      );
      if (added.length > 0) {
        motion.from(added, { y: -4, opacity: 0, duration: 0.15, ease: 'power2.out' });
      }
    },
    { scope, dependencies: [keys] },
  );
  if (notices.length === 0) return null;
  return (
    <div ref={focusRef} tabIndex={-1} className={className ?? 'space-y-3 outline-none'}>
      <div ref={scope} className="space-y-3">
        {notices.map((notice) => (
          <div key={notice.key} data-notice={notice.key} className="relative">
            <FormAlert
              variant={notice.variant}
              icon={notice.icon}
              action={notice.action}
              className={notice.onDismiss ? 'pr-14' : undefined}
            >
              {notice.text}
            </FormAlert>
            {notice.onDismiss ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-touch"
                aria-label="Dismiss"
                onClick={notice.onDismiss}
                className="absolute top-1.5 right-1.5 text-neutral-1 hover:bg-white/60"
              >
                <X className="size-5" aria-hidden />
              </Button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

export const NOTICE_ICONS = {
  unpaid: CreditCard,
  clock: Clock,
  done: CircleCheck,
  price: TrendingUp,
  soldOut: PackageX,
  promo: TicketPercent,
} as const;

/** Page notice 2 (design 2.21): "Finish paying" and "Cancel it and start again". */
export function UnpaidActions({
  orderId,
  cancelling,
  onCancel,
  inProgress,
}: {
  orderId: string;
  cancelling: boolean;
  onCancel: () => void;
  /** "Your bank is still confirming order 1042. Give it a minute." */
  inProgress: string | null;
}) {
  return (
    <>
      <div className="flex flex-wrap gap-3">
        <Button asChild size="touch">
          <Link href={orderHref(orderId)}>Finish paying</Link>
        </Button>
        <SubmitButton
          type="button"
          variant="outline"
          pending={cancelling}
          pendingLabel="Cancelling…"
          onClick={onCancel}
          className="bg-white"
        >
          Cancel it and start again
        </SubmitButton>
      </div>
      {inProgress ? <p className="mt-2 text-body-5 text-neutral-1">{inProgress}</p> : null}
    </>
  );
}
