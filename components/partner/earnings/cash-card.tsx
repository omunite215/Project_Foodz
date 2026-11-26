'use client';

import { Banknote, ChevronRight, CircleCheck, type LucideIcon, Wallet } from 'lucide-react';
import { useRef, useState } from 'react';
import type { CashCard as CashCardData } from '@/server/modules/earnings/schema';
import { PAYOUT_DAY_WORDS } from '@/server/modules/earnings/schema';
import { Button } from '@/components/ui/button';
import {
  cashCardWords,
  workedOutRows,
  workedOutStart,
  workedOutTotal,
} from '@/lib/partner/earnings-text';
import { cn } from '@/lib/utils';
import { PartnerSheet } from './partner-sheet';

/*
 * The cash card (F9 design 1.3): first in the content on both segments, in one of three tones,
 * each with its own words, so a balance never reads by colour alone. Drawn only from the
 * server's figures; it isn't a live region (a staff change arrives with its notice).
 */

const TONES: Record<CashCardData['state'], { box: string; icon: LucideIcon; mark: string }> = {
  owesYou: { box: 'bg-success-soft', icon: Wallet, mark: 'text-success-mark' },
  handIn: { box: 'bg-warning-soft', icon: Banknote, mark: 'text-warning-mark' },
  square: { box: 'border border-border bg-card', icon: CircleCheck, mark: 'text-success-mark' },
};

export function CashCard({ cash, timeZone }: { cash: CashCardData; timeZone: string }) {
  const [open, setOpen] = useState(false);
  const linkRef = useRef<HTMLButtonElement>(null);
  const words = cashCardWords(cash);
  const tone = TONES[cash.state];
  const Icon = tone.icon;
  return (
    <section aria-labelledby="cash-title" className={cn('rounded-2xl p-4', tone.box)}>
      <div className="flex items-start gap-3">
        <Icon className={cn('mt-0.5 size-6 shrink-0', tone.mark)} aria-hidden />
        <h2
          id="cash-title"
          className="text-title-2 leading-tight font-semibold text-strong tabular-nums [overflow-wrap:anywhere]"
        >
          {words.heading}
        </h2>
      </div>
      {words.body ? (
        <p className="mt-2 text-body-5 text-strong dark:text-foreground">{words.body}</p>
      ) : null}
      {cash.hasEntries ? (
        <>
          <button
            ref={linkRef}
            type="button"
            onClick={() => setOpen(true)}
            className="-mx-2 mt-2 inline-flex h-12 items-center gap-1.5 rounded-lg px-2 text-button-2 font-medium text-strong underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid"
          >
            How this is worked out
            <ChevronRight className="size-4" aria-hidden />
          </button>
          <WorkedOutSheet
            open={open}
            onOpenChange={setOpen}
            cash={cash}
            timeZone={timeZone}
            returnFocus={() => linkRef.current?.focus()}
          />
        </>
      ) : null}
    </section>
  );
}

/** "How this is worked out" (1.9): the server's breakdown, never added up in the page. */
export function WorkedOutSheet({
  open,
  onOpenChange,
  cash,
  timeZone,
  returnFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cash: CashCardData;
  timeZone: string;
  returnFocus: () => void;
}) {
  const breakdown = cash.breakdown;
  const start = workedOutStart(breakdown, timeZone);
  const total = workedOutTotal(breakdown.resultCents);
  return (
    <PartnerSheet
      open={open}
      onOpenChange={onOpenChange}
      title="How this is worked out"
      returnFocus={returnFocus}
    >
      {start ? <p className="mt-3 text-body-4 text-strong tabular-nums">{start}</p> : null}
      <h3 className="mt-4 text-body-5 font-medium text-foreground">Since then</h3>
      <dl className="mt-2 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
        {workedOutRows(breakdown).map((row) => (
          <div
            key={row.label}
            className="flex min-h-12 items-center justify-between gap-4 px-4 text-body-4 tabular-nums"
          >
            <dt className="text-foreground">{row.label}</dt>
            <dd className="text-strong">{row.value}</dd>
          </div>
        ))}
        <div className="flex min-h-12 items-center justify-between gap-4 bg-muted px-4 text-body-4 font-semibold text-strong tabular-nums">
          <dt>
            <span aria-hidden>{total.label}</span>
            <span className="sr-only">{total.spokenLabel}</span>
          </dt>
          <dd>{total.value}</dd>
        </div>
      </dl>
      <p className="mt-3 text-body-5 text-muted-foreground">{PAYOUT_DAY_WORDS}</p>
      <Button
        type="button"
        variant="outline"
        size="dock"
        className="mt-6 bg-card text-strong"
        onClick={() => onOpenChange(false)}
      >
        Close
      </Button>
    </PartnerSheet>
  );
}
