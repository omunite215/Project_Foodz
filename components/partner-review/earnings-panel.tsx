'use client';

import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlarmClock,
  Banknote,
  CircleCheck,
  Info,
  Landmark,
  type LucideIcon,
  SquarePen,
  Wallet,
} from 'lucide-react';
import { type Ref, useEffect, useId, useRef, useState } from 'react';
import { partnerEarningsAction } from '@/server/modules/earnings/actions';
import type {
  MoneyActionResult,
  MoneyDialogKind,
  PartnerEarningsPage,
} from '@/server/modules/earnings/schema';
import { FormAlert } from '@/components/forms/form-alert';
import { BLOCKED_BUTTON_CLASS } from '@/components/forms/submit-button';
import { Button } from '@/components/ui/button';
import { callAction } from '@/lib/action-result';
import {
  balanceHeading,
  holdingLine,
  lastPayoutLine,
  READ_ONLY_DEMO,
  weekHeading,
} from '@/lib/admin/earnings-text';
import { announce } from '@/lib/announce';
import { formatPrice } from '@/lib/format';
import { cn } from '@/lib/utils';
import { type LedgerParams, LedgerSection } from './ledger-table';
import { MoneyDialog } from './money-dialogs';
import { ReadError } from './queries';

/*
 * The partner page's Earnings section (F9 design 3.4): the balance and what staff can do about
 * it, this week's tiles, the last payout and the ledger. Every figure is the same server read
 * as the partner's app and the report. Refreshed quietly every 60 s and when the tab comes back;
 * a change made elsewhere is caught by the dialogs' version check.
 */

export const EARNINGS_REFRESH_MS = 60_000;

export const earningsKey = (partnerId: string, params?: LedgerParams | null) =>
  params === undefined
    ? (['partners', 'earnings', partnerId] as const)
    : (['partners', 'earnings', partnerId, params] as const);

const paramsOf = (page: PartnerEarningsPage): LedgerParams => ({
  from: page.range.from,
  to: page.range.to,
  page: page.entries.page,
  dir: page.entries.dir,
});

const sameParams = (a: LedgerParams | null, b: LedgerParams | null) =>
  JSON.stringify(a) === JSON.stringify(b);

async function readEarnings(partnerId: string, params: LedgerParams | null) {
  const outcome = await callAction(() =>
    partnerEarningsAction({
      partnerId,
      from: params?.from ?? null,
      to: params?.to ?? null,
      page: params?.page ?? 1,
      dir: params?.dir ?? 'desc',
    }),
  );
  if (!outcome.ok) throw new ReadError(outcome.error);
  if (!outcome.data) throw new ReadError({ code: 'NOT_FOUND', message: 'Not found' });
  return outcome.data;
}

/** The address keeps the range and page (reload and Back show the same entries). */
function mirrorParams(params: LedgerParams, week: { start: string; end: string }) {
  const url = new URL(window.location.href);
  const thisWeek = params.from === week.start && params.to === week.end;
  if (thisWeek) {
    url.searchParams.delete('from');
    url.searchParams.delete('to');
  } else {
    url.searchParams.set('from', params.from);
    url.searchParams.set('to', params.to);
  }
  // The list's own page and sort ride in the same address ("Back to partners"), so the
  // ledger's have their own names.
  if (params.page > 1) url.searchParams.set('entriesPage', String(params.page));
  else url.searchParams.delete('entriesPage');
  if (params.dir === 'asc') url.searchParams.set('entriesDir', 'asc');
  else url.searchParams.delete('entriesDir');
  window.history.replaceState(null, '', `${url.pathname}${url.search}`);
}

const TONES: Record<
  'owes' | 'owed' | 'owedAmber' | 'square',
  { card: string; disc: string; icon: LucideIcon; mark: string }
> = {
  owes: { card: '', disc: 'bg-brand-soft', icon: Wallet, mark: 'text-brand-strong' },
  owed: {
    card: 'border-l-4 border-l-neutral-5',
    disc: 'bg-neutral-7',
    icon: Banknote,
    mark: 'text-neutral-3',
  },
  owedAmber: {
    card: 'border-l-4 border-l-warning-strong bg-tag-6-bg',
    disc: 'bg-white',
    icon: AlarmClock,
    mark: 'text-warning-strong',
  },
  square: { card: '', disc: 'bg-neutral-7', icon: CircleCheck, mark: 'text-neutral-3' },
};

function toneOf(balance: PartnerEarningsPage['balance']) {
  if (balance.state === 'foodzOwes') return TONES.owes;
  if (balance.state === 'partnerOwes') return balance.amber ? TONES.owedAmber : TONES.owed;
  return TONES.square;
}

function WhyLine({ children }: { children: string }) {
  return (
    <p className="flex items-center gap-2 text-body-5 text-neutral-3">
      <Info className="size-4 shrink-0" aria-hidden />
      {children}
    </p>
  );
}

function BalanceCard({
  page,
  timeZone,
  headingRef,
  openerRefs,
  onOpen,
}: {
  page: PartnerEarningsPage;
  timeZone: string;
  headingRef: Ref<HTMLParagraphElement>;
  openerRefs: React.RefObject<Partial<Record<MoneyDialogKind, HTMLButtonElement | null>>>;
  onOpen: (kind: MoneyDialogKind) => void;
}) {
  const captionId = useId();
  const tone = toneOf(page.balance);
  const Icon = tone.icon;
  const actions = page.actions;
  const isAdmin = actions.adjust;
  const demo = actions.readOnlyDemo;
  const holding = holdingLine(page.balance.holdingCents);

  const button = (
    kind: MoneyDialogKind,
    label: string,
    ButtonIcon: LucideIcon,
    variant: 'default' | 'outline',
  ) => (
    <Button
      key={kind}
      ref={(element) => {
        openerRefs.current[kind] = element;
      }}
      type="button"
      size="kitchen"
      variant={variant}
      aria-disabled={demo || undefined}
      aria-describedby={demo ? captionId : undefined}
      className={cn(
        'w-full md:w-auto',
        variant === 'outline' && 'bg-white',
        demo && BLOCKED_BUTTON_CLASS,
      )}
      onClick={() => {
        if (demo) announce(READ_ONLY_DEMO);
        else onOpen(kind);
      }}
    >
      <ButtonIcon className="size-5" aria-hidden />
      {label}
    </Button>
  );

  const buttons = [];
  const lines: string[] = [];
  if (demo) {
    buttons.push(
      button('payout', 'Record payout', Landmark, 'default'),
      button('cash', 'Record cash handed in', Banknote, 'outline'),
      button('adjust', 'Adjust earnings', SquarePen, 'outline'),
    );
  } else {
    if (isAdmin) {
      if (actions.payout) buttons.push(button('payout', 'Record payout', Landmark, 'default'));
      else if (actions.whyNot.payout) lines.push(actions.whyNot.payout);
    }
    if (actions.recordCash) {
      buttons.push(button('cash', 'Record cash handed in', Banknote, 'outline'));
    } else if (actions.whyNot.recordCash) lines.push(actions.whyNot.recordCash);
    if (isAdmin) buttons.push(button('adjust', 'Adjust earnings', SquarePen, 'outline'));
  }

  return (
    <div
      className={cn(
        'rounded-2xl border border-neutral-6 bg-white p-5 xl:flex xl:items-center xl:gap-6',
        tone.card,
      )}
    >
      <div className="flex items-start gap-4">
        <span
          aria-hidden
          className={cn(
            'flex size-12 shrink-0 items-center justify-center rounded-full',
            tone.disc,
          )}
        >
          <Icon className={cn('size-6', tone.mark)} />
        </span>
        <div className="min-w-0">
          <p className="text-body-5 text-neutral-3">Balance</p>
          <p
            ref={headingRef}
            tabIndex={-1}
            data-balance-heading=""
            className="mt-1 text-title-2 leading-tight font-semibold text-neutral-1 tabular-nums outline-none [overflow-wrap:anywhere]"
          >
            {balanceHeading(page.balance, page.name, timeZone)}
          </p>
          {holding ? (
            <p className="mt-1 text-body-5 text-neutral-2 tabular-nums">{holding}</p>
          ) : null}
        </div>
      </div>
      {buttons.length || lines.length ? (
        <div className="mt-4 space-y-2 xl:mt-0 xl:ml-auto">
          {buttons.length ? (
            <div className="flex flex-col gap-2 md:flex-row md:flex-wrap">{buttons}</div>
          ) : null}
          {demo ? (
            <p id={captionId} className="text-body-5 text-neutral-3">
              {READ_ONLY_DEMO}
            </p>
          ) : null}
          {lines.map((line) => (
            <WhyLine key={line}>{line}</WhyLine>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function WeekTiles({ page }: { page: PartnerEarningsPage }) {
  const id = useId();
  const week = page.week;
  const tiles = [
    { label: 'Deliveries', value: String(week.deliveries) },
    { label: 'Earned', value: formatPrice(week.earnedCents) },
    { label: 'Tips', value: formatPrice(week.tipsCents) },
    { label: 'Cash collected', value: formatPrice(week.cashCollectedCents) },
    { label: 'Cash handed in', value: formatPrice(week.cashHandedInCents) },
  ];
  return (
    <section aria-labelledby={id}>
      <h3 id={id} className="text-body-4 font-semibold text-neutral-1 tabular-nums">
        {weekHeading(week.start, week.end)}
      </h3>
      <dl className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {tiles.map((tile) => (
          <div key={tile.label} className="rounded-xl border border-neutral-6 bg-neutral-8 p-4">
            <dt className="text-body-5 text-neutral-3">{tile.label}</dt>
            <dd className="mt-1 text-body-2 font-semibold text-neutral-1 tabular-nums">
              {tile.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function PartnerEarningsPanel({
  initial,
  partnerId,
  partnerName,
  timeZone,
  offline,
  enabled,
  headingRef,
  onSignedOut,
}: {
  /** The server's first read; null when it failed. */
  initial: PartnerEarningsPage | null;
  partnerId: string;
  partnerName: string;
  timeZone: string;
  offline: boolean;
  /** False once the session has ended: the section stops asking. */
  enabled: boolean;
  /** The section's h2, focused after switching sections. */
  headingRef: Ref<HTMLHeadingElement>;
  onSignedOut: () => void;
}) {
  const titleId = useId();
  const queryClient = useQueryClient();
  const [params, setParams] = useState<LedgerParams | null>(() =>
    initial ? paramsOf(initial) : null,
  );
  const seeded = initial && sameParams(paramsOf(initial), params) ? initial : undefined;
  const query = useQuery<PartnerEarningsPage>({
    queryKey: earningsKey(partnerId, params),
    queryFn: () => readEarnings(partnerId, params),
    initialData: seeded,
    initialDataUpdatedAt: seeded ? Date.parse(seeded.asOf) : undefined,
    staleTime: 5_000,
    placeholderData: keepPreviousData,
    refetchInterval: enabled ? EARNINGS_REFRESH_MS : false,
    refetchOnWindowFocus: enabled,
    enabled,
    retry: false,
  });
  const page = query.data;
  const failure = query.error instanceof ReadError ? query.error.failure : null;
  useEffect(() => {
    if (failure?.code === 'UNAUTHENTICATED') onSignedOut();
  }, [failure, onSignedOut]);

  const [dialog, setDialog] = useState<MoneyDialogKind | null>(null);
  const openers = useRef<Partial<Record<MoneyDialogKind, HTMLButtonElement | null>>>({});
  const balanceRef = useRef<HTMLParagraphElement>(null);
  const focusBalance = useRef(false);

  const changeParams = (next: LedgerParams) => {
    setParams(next);
    if (page) mirrorParams(next, page.week);
  };

  /** The balance, tiles and ledger read again (A67.2, 3.6 to 3.8). */
  const refetchPage = () => queryClient.invalidateQueries({ queryKey: earningsKey(partnerId) });

  const done = async (kind: MoneyDialogKind, result: MoneyActionResult) => {
    // The opener goes when its action no longer applies (a payout to $0.00, all cash in).
    focusBalance.current =
      (kind === 'payout' && result.balanceCents <= 0) ||
      (kind === 'cash' && result.holdingCents <= 0);
    // The new figures land before the dialog closes, so focus reads them (review S3).
    await refetchPage().catch(() => undefined);
    setDialog(null);
    void queryClient.invalidateQueries({ queryKey: ['partners', 'list'] });
  };

  const heading = (
    <h2
      id={titleId}
      ref={headingRef}
      tabIndex={-1}
      className="text-body-3 font-semibold text-neutral-1 outline-none"
    >
      Earnings
    </h2>
  );

  if (!page) {
    return (
      <section aria-labelledby={titleId} className="space-y-6">
        {heading}
        {query.isError ? (
          <FormAlert
            variant="error"
            action={
              <Button
                type="button"
                variant="outline"
                size="touch"
                className="bg-white"
                onClick={() => void query.refetch()}
              >
                Try again
              </Button>
            }
          >
            We couldn&apos;t load earnings. Try again.
          </FormAlert>
        ) : (
          <div aria-busy className="h-32 rounded-2xl bg-neutral-7 motion-safe:animate-skeleton" />
        )}
      </section>
    );
  }

  if (page.hiddenForDemo) {
    return (
      <section aria-labelledby={titleId} className="space-y-6">
        {heading}
        <p className="text-body-5 text-neutral-3">Earnings are hidden for demo staff.</p>
      </section>
    );
  }

  const shownParams = params ?? paramsOf(page);
  return (
    <section aria-labelledby={titleId} className="space-y-6">
      {heading}
      {query.isError && failure?.code !== 'UNAUTHENTICATED' ? (
        <FormAlert
          variant="error"
          action={
            <Button
              type="button"
              variant="outline"
              size="touch"
              className="bg-white"
              onClick={() => void query.refetch()}
            >
              Try again
            </Button>
          }
        >
          We couldn&apos;t load earnings. Try again.
        </FormAlert>
      ) : null}
      <BalanceCard
        page={page}
        timeZone={timeZone}
        headingRef={balanceRef}
        openerRefs={openers}
        onOpen={setDialog}
      />
      <WeekTiles page={page} />
      <p className="flex items-center gap-2 text-body-5 text-neutral-2 tabular-nums">
        <Landmark className="size-4 shrink-0 text-neutral-3" aria-hidden />
        {lastPayoutLine(page.lastPayout)}
      </p>
      <LedgerSection
        page={page}
        params={shownParams}
        timeZone={timeZone}
        busy={query.isPlaceholderData && query.isFetching}
        onParams={changeParams}
      />
      {dialog ? (
        <MoneyDialog
          key={dialog}
          kind={dialog}
          partnerId={partnerId}
          partnerName={partnerName}
          timeZone={timeZone}
          offline={offline}
          onClose={() => setDialog(null)}
          onCloseFocus={() => {
            const opener = openers.current[dialog];
            if (!focusBalance.current && opener?.isConnected) {
              opener.focus();
              return true;
            }
            focusBalance.current = false;
            balanceRef.current?.focus();
            return true;
          }}
          onDone={(result) => done(dialog, result)}
          onChanged={refetchPage}
          onSignedOut={onSignedOut}
        />
      ) : null}
    </section>
  );
}
