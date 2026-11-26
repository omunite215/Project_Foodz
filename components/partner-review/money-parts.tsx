'use client';

import { AlarmClock, Banknote, Ellipsis, Star, Wallet } from 'lucide-react';
import Link from 'next/link';
import { Fragment, useRef } from 'react';
import type { PartnerListMoney } from '@/server/modules/earnings/schema';
import type { PartnerListQuery, PartnerListRow } from '@/server/modules/partners/review-schema';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  cashBlock,
  moreActionsName,
  notHoldingCash,
  ratingCell,
  READ_ONLY_DEMO,
  weekCell,
} from '@/lib/admin/earnings-text';
import { applicationHref } from '@/lib/partner-review/url';
import { cn } from '@/lib/utils';

/*
 * The Partners list's money (F9 design 3.2): the rating, this week's earnings and the cash a
 * partner owes, and the row menu that records cash handed in. Every state reads in words; the
 * amber block's border and icon only repeat its "since Tue" or "over $150".
 */

/** "★ 4.6 · 31", "5.0 · 1" + "not shown to customers yet", or "—" ("No ratings"). */
export function RatingCell({ rating }: { rating: PartnerListMoney['rating'] }) {
  const words = ratingCell(rating);
  if (words.sr) {
    return (
      <>
        <span aria-hidden>{words.text}</span>
        <span className="sr-only">{words.sr}</span>
      </>
    );
  }
  return (
    <span className="inline-flex flex-col items-start">
      <span className="inline-flex items-center gap-1 tabular-nums">
        <Star className="size-3.5 fill-tag-6 text-warning-strong" aria-hidden />
        {words.text}
      </span>
      {words.second ? <span className="text-body-5 text-neutral-3">{words.second}</span> : null}
    </span>
  );
}

/** "18 deliveries · $126.02", wrapping after the "·", or "—". */
export function WeekCell({ week }: { week: PartnerListMoney['week'] }) {
  const parts = weekCell(week);
  if (!parts) {
    return (
      <>
        <span aria-hidden>—</span>
        <span className="sr-only">No deliveries this week</span>
      </>
    );
  }
  return (
    <span className="tabular-nums">
      <span className="whitespace-nowrap">{parts[0]}</span> ·{' '}
      <span className="whitespace-nowrap">{parts[1]}</span>
    </span>
  );
}

/** The cash a partner owes, as F6 7.6's block, or "—" ("Owes nothing"). */
export function CashBlock({
  cash,
  now,
  timeZone,
}: {
  cash: PartnerListMoney['cash'];
  now: Date;
  timeZone: string;
}) {
  if (!cash) {
    return (
      <>
        <span aria-hidden>—</span>
        <span className="sr-only">Owes nothing</span>
      </>
    );
  }
  const words = cashBlock(cash, now, timeZone);
  const amber = words.tone === 'amber';
  const Icon = amber ? AlarmClock : Banknote;
  return (
    <span
      className={cn(
        'inline-flex items-start gap-1.5 rounded-md border-l-4 px-2 py-1 text-body-5 font-medium text-neutral-1 tabular-nums',
        amber ? 'border-l-warning-strong bg-tag-6-bg' : 'border-l-neutral-5 bg-neutral-7',
      )}
    >
      <Icon
        className={cn(
          'mt-[3px] size-3.5 shrink-0',
          amber ? 'text-warning-strong' : 'text-neutral-3',
        )}
        aria-hidden
      />
      {/* Each part stays whole ("Owes $142.70", "since Nov 17"); it wraps after the dot (P3). */}
      <span aria-hidden>
        {words.text.split(' · ').map((part, index) => (
          <Fragment key={part}>
            {index > 0 ? ' · ' : null}
            <span className="whitespace-nowrap">{part}</span>
          </Fragment>
        ))}
      </span>
      <span className="sr-only">{words.spoken}</span>
    </span>
  );
}

/** One "Hidden for demo staff" over the money columns of a real partner (D29). */
export function HiddenMoney() {
  return <span className="text-body-5 text-neutral-3">Hidden for demo staff</span>;
}

const ITEM = 'h-11 gap-2 text-body-4';

/**
 * The row menu (design 3.2): "Record cash handed in" (or why not), "See earnings", "See
 * ratings". The demo admin sees the record item disabled with its caption, and only "See
 * partner" on a real partner.
 */
export function MoneyRowMenu({
  row,
  query,
  isDemo,
  onRecordCash,
  className,
}: {
  row: PartnerListRow & { money: PartnerListMoney };
  query: PartnerListQuery;
  isDemo: boolean;
  onRecordCash: (opener: HTMLElement | null) => void;
  className?: string;
}) {
  const money = row.money;
  const href = (view: 'earnings' | 'ratings') => applicationHref(row.partnerId, query, { view });
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          ref={triggerRef}
          type="button"
          variant="ghost"
          size="icon-touch"
          aria-label={moreActionsName(row.name)}
          className={cn('text-neutral-2', className)}
        >
          <Ellipsis className="size-5" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {isDemo && money.hidden ? (
          <DropdownMenuItem asChild className={ITEM}>
            <Link href={applicationHref(row.partnerId, query)}>See partner</Link>
          </DropdownMenuItem>
        ) : (
          <>
            {isDemo ? (
              <DropdownMenuItem
                disabled
                className="h-auto min-h-11 flex-col items-start gap-0 py-2"
              >
                <span className="inline-flex items-center gap-2 text-body-4">
                  <Banknote className="size-4" aria-hidden />
                  Record cash handed in
                </span>
                <span className="pl-6 text-body-5 text-neutral-3">{READ_ONLY_DEMO}</span>
              </DropdownMenuItem>
            ) : money.actions.recordCash ? (
              <DropdownMenuItem
                className={ITEM}
                onSelect={() => {
                  // The dialog opens once the menu has closed and handed focus back.
                  const opener = triggerRef.current;
                  requestAnimationFrame(() => onRecordCash(opener));
                }}
              >
                <Banknote className="size-4" aria-hidden />
                Record cash handed in
              </DropdownMenuItem>
            ) : (
              <p className="px-2 py-2 text-body-5 text-neutral-3">{notHoldingCash(row.name)}</p>
            )}
            <DropdownMenuItem asChild className={ITEM}>
              <Link href={href('earnings')}>
                <Wallet className="size-4" aria-hidden />
                See earnings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild className={ITEM}>
              <Link href={href('ratings')}>
                <Star className="size-4" aria-hidden />
                See ratings
              </Link>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
