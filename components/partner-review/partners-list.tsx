'use client';

import { useDebouncer } from '@tanstack/react-pacer';
import { useQueryClient } from '@tanstack/react-query';
import { createColumnHelper, tableFeatures, useTable } from '@tanstack/react-table';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Banknote,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Flag,
  PencilLine,
  CircleCheck,
  Search,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  type ComponentProps,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { VehicleType } from '@/server/db/enums';
import type { PartnerListMoney } from '@/server/modules/earnings/schema';
import {
  listQueryFromSearch,
  PARTNER_TABS,
  type PartnerListQuery,
  type PartnerListResult,
  type PartnerListRow,
  type PartnerSort,
  type PartnerTab,
} from '@/server/modules/partners/review-schema';
import { VEHICLE_TYPES } from '@/server/modules/partners/rules';
import { AdminPage, useSessionPhase } from '@/components/admin/admin-page';
import { SignedOutOverlay } from '@/components/admin/signed-out-overlay';
import { useStaffShell } from '@/components/admin/staff-shell-context';
import { FormAlert } from '@/components/forms/form-alert';
import { BLOCKED_BUTTON_CLASS } from '@/components/forms/submit-button';
import { EmptyState } from '@/components/states/empty-state';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { NO_PARTNERS_OWE } from '@/lib/admin/earnings-text';
import { announce } from '@/lib/announce';
import { useMotion } from '@/lib/motion';
import {
  dateTime,
  decidedCell,
  documentsCell,
  longDateOf,
  pageText,
  reapplyCell,
  resultCountText,
  showingText,
  stateMenuName,
  stateMenuText,
  TAB_LABELS,
  tabName,
  VEHICLE_FILTER_LABELS,
  waitingForText,
} from '@/lib/partner-review/text';
import {
  applicationHref,
  hasFilters,
  listHref,
  MIN_SEARCH,
  ownsCash,
  withFilters,
  withPage,
  withSort,
  withTab,
} from '@/lib/partner-review/url';
import { useOnline } from '@/lib/use-online';
import { cn } from '@/lib/utils';
import { MoneyDialog } from './money-dialogs';
import { CashBlock, HiddenMoney, MoneyRowMenu, RatingCell, WeekCell } from './money-parts';
import { BannedChip, DemoChip, FlagChips, OnlineLine, StatusChip, WaitingBlock } from './parts';
import { partnerKeys, ReadError, usePartnerList } from './queries';

/*
 * The Partners list (F6 design 7, A19): server-rendered first page, then kept current in the
 * browser. Tab, search, filters, sort and page live in the address; a change keeps the rows on
 * screen while the next answer comes, and announces the new count once. The table appears from
 * 1024 px; below that each application is one card, one link.
 */

// ------------------------------------------------------------------ navigation in the address

type Navigate = (query: PartnerListQuery, mode?: 'push' | 'replace') => void;

const navigateTo: Navigate = (query, mode = 'push') => {
  const href = listHref(query);
  if (mode === 'push') window.history.pushState(null, '', href);
  else window.history.replaceState(null, '', href);
};

/** A real link to the list's next address that changes it in place for a plain click. */
function ListLink({
  query,
  navigate = navigateTo,
  children,
  ...props
}: Omit<ComponentProps<typeof Link>, 'href' | 'onNavigate'> & {
  query: PartnerListQuery;
  navigate?: Navigate;
}) {
  return (
    <Link
      {...props}
      href={listHref(query)}
      prefetch={false}
      onClick={(event) => {
        props.onClick?.(event);
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }
        event.preventDefault();
        navigate(query);
      }}
    >
      {children}
    </Link>
  );
}

// ------------------------------------------------------------------ tabs (7.3)

const TAB_LINK =
  'relative inline-flex h-12 shrink-0 items-center gap-2 px-3 text-body-5 font-medium text-neutral-3 hover:text-neutral-1 focus-visible:-outline-offset-2';

/** The number is drawn by CSS, so the tab's name says it once, in words ("To review, 2 applications"). */
function CountChip({ count }: { count: number }) {
  return (
    <span
      aria-hidden
      data-count={count}
      className="inline-flex h-6 min-w-6 items-center justify-center rounded-md bg-neutral-7 px-1.5 text-caption font-semibold text-neutral-1 tabular-nums after:content-[attr(data-count)]"
    />
  );
}

function StateTabs({
  query,
  counts,
}: {
  query: PartnerListQuery;
  counts: PartnerListResult['counts'];
}) {
  return (
    <>
      <nav
        aria-label="Application states"
        className="hidden gap-1 overflow-x-auto border-b border-neutral-6 md:flex"
      >
        {PARTNER_TABS.map((tab) => {
          const current = tab === query.tab;
          return (
            <ListLink
              key={tab}
              query={withTab(query, tab)}
              aria-current={current ? 'page' : undefined}
              aria-label={tabName(tab, counts[tab])}
              className={cn(
                TAB_LINK,
                current &&
                  'text-neutral-1 after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-brand-strong',
              )}
            >
              {TAB_LABELS[tab]}
              <CountChip count={counts[tab]} />
            </ListLink>
          );
        })}
      </nav>
      <div className="md:hidden">
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="touch"
              aria-label={stateMenuName(query.tab, counts[query.tab])}
              className="w-full justify-between border-input bg-white text-neutral-1"
            >
              {stateMenuText(query.tab, counts[query.tab])}
              <ChevronDown className="size-4" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-(--radix-dropdown-menu-trigger-width)">
            {PARTNER_TABS.map((tab) => {
              const current = tab === query.tab;
              return (
                <DropdownMenuItem key={tab} asChild className="h-12">
                  <ListLink query={withTab(query, tab)} aria-current={current ? 'page' : undefined}>
                    {current ? (
                      <Check className="size-4 text-brand-strong" aria-hidden />
                    ) : (
                      <span aria-hidden className="size-4" />
                    )}
                    {TAB_LABELS[tab]} ({counts[tab]})
                  </ListLink>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ toolbar (7.4)

function Toolbar({ query }: { query: PartnerListQuery }) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(query.q);
  const debouncer = useDebouncer(
    (value: string) => {
      const q = value.trim();
      navigateTo(withFilters(query, { q: q.length >= MIN_SEARCH ? q : '' }), 'replace');
    },
    { wait: 300 },
  );
  // The address changed elsewhere (Back, Clear filters): the box follows it.
  const [lastQ, setLastQ] = useState(query.q);
  if (query.q !== lastQ) {
    setLastQ(query.q);
    if (text.trim() !== query.q) setText(query.q);
  }
  const tooShort = text.trim().length > 0 && text.trim().length < MIN_SEARCH;

  return (
    <div className="mt-4 flex flex-wrap items-end gap-3">
      <search className="w-full md:w-80">
        <form
          className="w-full"
          onSubmit={(event) => {
            event.preventDefault();
            debouncer.cancel();
            const q = text.trim();
            navigateTo(withFilters(query, { q: q.length >= MIN_SEARCH ? q : '' }), 'replace');
          }}
        >
          <label htmlFor={`${id}-q`} className="block text-body-5 font-medium text-neutral-2">
            Search name, email or plate
          </label>
          <div className="relative mt-1.5">
            <Search
              className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-neutral-3"
              aria-hidden
            />
            <input
              ref={inputRef}
              id={`${id}-q`}
              type="search"
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="search"
              value={text}
              aria-describedby={tooShort ? `${id}-hint` : undefined}
              onChange={(event) => {
                setText(event.target.value);
                debouncer.maybeExecute(event.target.value);
              }}
              className="h-11 w-full rounded-xl border border-input bg-white pr-11 pl-10 text-body-4 text-neutral-2 outline-none placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid [&::-webkit-search-cancel-button]:hidden"
            />
            {text ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-touch"
                aria-label="Clear search"
                className="absolute top-0 right-0 text-neutral-3"
                onClick={() => {
                  debouncer.cancel();
                  setText('');
                  navigateTo(withFilters(query, { q: '' }), 'replace');
                  inputRef.current?.focus();
                }}
              >
                <X className="size-4" aria-hidden />
              </Button>
            ) : null}
          </div>
          {tooShort ? (
            <p id={`${id}-hint`} className="mt-1 text-caption text-neutral-3">
              Type at least 2 characters.
            </p>
          ) : null}
        </form>
      </search>
      <div>
        <label htmlFor={`${id}-vehicle`} className="block text-body-5 font-medium text-neutral-2">
          Vehicle
        </label>
        <div className="relative mt-1.5">
          <select
            id={`${id}-vehicle`}
            value={query.vehicle ?? ''}
            onChange={(event) => {
              const value = event.target.value;
              const vehicle: VehicleType | null =
                VEHICLE_TYPES.find((type) => type === value) ?? null;
              navigateTo(withFilters(query, { vehicle }));
            }}
            className="h-11 appearance-none rounded-xl border border-input bg-white pr-10 pl-4 text-body-4 text-neutral-2 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid"
          >
            <option value="">Any</option>
            {VEHICLE_TYPES.map((type) => (
              <option key={type} value={type}>
                {VEHICLE_FILTER_LABELS[type]}
              </option>
            ))}
          </select>
          <ChevronDown
            className="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-neutral-3"
            aria-hidden
          />
        </div>
      </div>
      <button
        type="button"
        aria-pressed={query.flags}
        onClick={() => navigateTo(withFilters(query, { flags: !query.flags }))}
        className={cn(
          'inline-flex h-11 items-center gap-1.5 rounded-lg border border-input bg-white px-3 text-body-5 font-medium text-neutral-2 outline-none hover:bg-neutral-7 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid',
          query.flags && 'border-2 border-brand-strong bg-brand-soft px-[11px] text-neutral-1',
        )}
      >
        {query.flags ? <Check className="size-4 text-brand-strong" aria-hidden /> : null}
        <Flag className="size-4" aria-hidden />
        Has flags
      </button>
      {ownsCash(query.tab) ? (
        // F9 A57.2: partners who owe Foodz cash.
        <button
          type="button"
          aria-pressed={query.owes}
          onClick={() => navigateTo(withFilters(query, { owes: !query.owes }))}
          className={cn(
            'inline-flex h-11 items-center gap-1.5 rounded-lg border border-input bg-white px-3 text-body-5 font-medium text-neutral-2 outline-none hover:bg-neutral-7 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid',
            query.owes && 'border-2 border-brand-strong bg-brand-soft px-[11px] text-neutral-1',
          )}
        >
          {query.owes ? <Check className="size-4 text-brand-strong" aria-hidden /> : null}
          <Banknote className="size-4" aria-hidden />
          Owes cash
        </button>
      ) : null}
      {hasFilters(query) || text ? (
        <Button
          type="button"
          variant="ghost"
          size="touch"
          className="text-neutral-1 underline underline-offset-4"
          onClick={() => {
            debouncer.cancel();
            setText('');
            navigateTo(withFilters(query, { q: '', vehicle: null, flags: false, owes: false }));
          }}
        >
          Clear filters
        </Button>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ cells (7.5)

const firstNameOf = (name: string) => name.split(/\s+/)[0] ?? name;

function VehicleWords({ words }: { words: string }) {
  const [vehicle, plate] = words.split(' · ');
  return (
    <>
      {vehicle}
      {plate ? (
        <>
          {' · '}
          <span className="whitespace-nowrap tabular-nums">{plate}</span>
        </>
      ) : null}
    </>
  );
}

function NameLink({
  row,
  query,
  className,
}: {
  row: PartnerListRow;
  query: PartnerListQuery;
  className?: string;
}) {
  return (
    <Link
      href={applicationHref(row.partnerId, query)}
      data-row-link={row.partnerId}
      className={cn(
        'text-body-4 font-medium text-neutral-1 underline-offset-4 [overflow-wrap:anywhere] hover:underline',
        className,
      )}
    >
      {row.name}
    </Link>
  );
}

function PersonCell({
  row,
  query,
  timeZone,
}: {
  row: PartnerListRow;
  query: PartnerListQuery;
  timeZone: string;
}) {
  const tab = query.tab;
  return (
    <div className="min-w-0">
      <NameLink row={row} query={query} />
      <p className="truncate text-body-5 text-neutral-3" title={row.email}>
        {row.email}
      </p>
      {tab === 'approved' ? (
        // F9 3.2: at 1024 the vehicle is the partner's second line; its column comes back at xl.
        <p className="text-body-5 text-neutral-2 xl:hidden">
          <VehicleWords words={row.vehicleWords} />
        </p>
      ) : null}
      {row.fixedAfterSendBack ? (
        <p className="mt-1 inline-flex items-center gap-1 text-caption text-neutral-3">
          <CircleCheck className="size-3" aria-hidden />
          Fixed after sending back
        </p>
      ) : row.updatedAt && (tab === 'review' || tab === 'waiting') ? (
        <p className="mt-1 inline-flex items-center gap-1 text-caption text-neutral-3">
          <PencilLine className="size-3" aria-hidden />
          Updated {dateTime(row.updatedAt, timeZone)}
        </p>
      ) : null}
      {row.banned || row.isDemoPartner ? (
        <p className="mt-1 flex flex-wrap gap-1">
          {row.banned ? <BannedChip /> : null}
          {row.isDemoPartner ? <DemoChip /> : null}
        </p>
      ) : null}
      {tab === 'review' && row.document ? (
        <p className="mt-1 text-body-5 text-neutral-2 xl:hidden">
          {row.document.words} · {row.document.expiresWords.replace(/^Expires/, 'expires')}
        </p>
      ) : null}
      {row.masked ? (
        <p className="mt-1 text-caption text-neutral-3">Hidden for demo staff</p>
      ) : null}
    </div>
  );
}

function SentBackCell({ row, timeZone }: { row: PartnerListRow; timeZone: string }) {
  if (!row.sentBack) return null;
  const by = decidedCell(row.sentBack.at, row.sentBack.byName, timeZone);
  return (
    <div className="flex flex-col items-start gap-1.5">
      <span>
        <span className="sr-only">Sent back </span>
        {by}
      </span>
      <WaitingBlock
        waiting={row.sentBack.waiting}
        words={waitingForText(firstNameOf(row.name), row.sentBack.waiting.words)}
      />
    </div>
  );
}

function onlineState(row: PartnerListRow) {
  if (!row.online) return null;
  const state = row.online.state === 'takenOffline' ? 'offline' : row.online.state;
  return <OnlineLine state={state} words={row.online.words} />;
}

// ------------------------------------------------------------------ the table (lg+)

const features = tableFeatures({});
const helper = createColumnHelper<typeof features, PartnerListRow>();

interface ColumnSpec {
  id: string;
  header: string;
  /** Widths at `xl`; the ID column only exists from `xl`. */
  className: string;
  sort?: PartnerSort;
  /** F9: a money column, merged into one "Hidden for demo staff" cell on a masked row. */
  money?: boolean;
  /** The header is read by screen readers only ("Actions"). */
  srHeader?: boolean;
  cell: (row: PartnerListRow, timeZone: string) => ReactNode;
}

/** What the money columns need besides the row (F9 design 3.2). */
interface MoneyContext {
  now: Date;
  isDemo: boolean;
  onRecordCash: (row: PartnerListRow, opener: HTMLElement | null) => void;
}

type MoneyRow = PartnerListRow & { money: PartnerListMoney };
const hasMoney = (row: PartnerListRow): row is MoneyRow => Boolean(row.money);

function moneyColumns(query: PartnerListQuery, context: MoneyContext) {
  const cash: ColumnSpec = {
    id: 'cash',
    header: 'Cash',
    className: '',
    sort: 'cash',
    money: true,
    cell: (row, timeZone) =>
      hasMoney(row) ? (
        <CashBlock cash={row.money.cash} now={context.now} timeZone={timeZone} />
      ) : null,
  };
  const actions: ColumnSpec = {
    id: 'actions',
    header: 'Actions',
    srHeader: true,
    className: 'w-14',
    cell: (row) =>
      hasMoney(row) ? (
        <MoneyRowMenu
          row={row}
          query={query}
          isDemo={context.isDemo}
          onRecordCash={(opener) => context.onRecordCash(row, opener)}
          className="-my-2"
        />
      ) : null,
  };
  const rating: ColumnSpec = {
    id: 'rating',
    header: 'Rating',
    className: '',
    sort: 'rating',
    money: true,
    cell: (row) => (hasMoney(row) ? <RatingCell rating={row.money.rating} /> : null),
  };
  const week: ColumnSpec = {
    id: 'week',
    header: 'This week',
    className: '',
    sort: 'week',
    money: true,
    cell: (row) => (hasMoney(row) ? <WeekCell week={row.money.week} /> : null),
  };
  return { cash, actions, rating, week };
}

const personHeader: Record<PartnerTab, string> = {
  review: 'Applicant',
  waiting: 'Applicant',
  approved: 'Partner',
  suspended: 'Partner',
  rejected: 'Applicant',
  all: 'Name',
};

const decided = (header: string): ColumnSpec => ({
  id: 'decided',
  header,
  className: '',
  sort: 'decided',
  cell: (row, timeZone) =>
    row.decided ? decidedCell(row.decided.at, row.decided.byName, timeZone) : null,
});

function columnsFor(query: PartnerListQuery, context: MoneyContext): ColumnSpec[] {
  const tab = query.tab;
  const money = moneyColumns(query, context);
  const person: ColumnSpec = {
    id: 'person',
    header: personHeader[tab],
    className: '',
    sort: 'name',
    cell: (row, timeZone) => <PersonCell row={row} query={query} timeZone={timeZone} />,
  };
  const vehicle: ColumnSpec = {
    id: 'vehicle',
    header: 'Vehicle',
    className: '',
    cell: (row) => <VehicleWords words={row.vehicleWords} />,
  };
  const flags: ColumnSpec = {
    id: 'flags',
    header: 'Flags',
    className: '',
    cell: (row) => <FlagChips flags={row.flags} compact="belowXl" />,
  };
  const sent: ColumnSpec = {
    id: 'sent',
    header: 'Sent',
    className: '',
    sort: 'sent',
    cell: (row, timeZone) => dateTime(row.submittedAt, timeZone),
  };
  switch (tab) {
    case 'review':
      return [
        { ...person, className: 'w-[30%] xl:w-[23%]' },
        { ...vehicle, className: 'w-[17%] xl:w-[13%]' },
        {
          id: 'id',
          header: 'ID',
          className: 'hidden xl:table-cell xl:w-[19%]',
          cell: (row) =>
            row.document ? (
              <>
                {row.document.words}
                <span className="block text-neutral-3">{row.document.expiresWords}</span>
              </>
            ) : null,
        },
        { ...sent, className: 'w-[17%] xl:w-[13%]' },
        {
          id: 'waiting',
          header: 'Waiting',
          className: 'w-[20%] xl:w-[17%]',
          cell: (row) => (row.waiting ? <WaitingBlock waiting={row.waiting} /> : null),
        },
        { ...flags, className: 'w-[16%] xl:w-[15%]' },
      ];
    case 'waiting':
      return [
        { ...person, className: 'w-[26%]' },
        { ...vehicle, className: 'w-[14%]' },
        { ...sent, className: 'w-[15%]' },
        {
          id: 'sentBack',
          header: 'Sent back',
          className: 'w-[30%]',
          cell: (row, timeZone) => <SentBackCell row={row} timeZone={timeZone} />,
        },
        { ...flags, className: 'w-[15%]' },
      ];
    case 'approved':
      // F9 3.2: at 1024 the vehicle joins the partner cell and "Partner since" goes.
      return [
        { ...person, className: 'w-[26%] xl:w-[20%]' },
        { ...vehicle, className: 'hidden xl:table-cell xl:w-[11%]' },
        {
          id: 'status',
          header: 'Status',
          className: 'w-[20%] xl:w-[17%]',
          cell: (row) => onlineState(row),
        },
        { ...money.rating, className: 'w-[17%] xl:w-[13%]' },
        { ...money.week, className: 'w-[18%] xl:w-[14%]' },
        { ...money.cash, className: 'w-[19%] xl:w-[13%]' },
        {
          id: 'since',
          header: 'Partner since',
          className: 'hidden xl:table-cell xl:w-[8%]',
          sort: 'decided',
          cell: (row, timeZone) =>
            row.partnerSince ? longDateOf(row.partnerSince, timeZone) : null,
        },
        money.actions,
      ];
    case 'suspended':
      return [
        { ...person, className: 'w-[28%]' },
        { ...vehicle, className: 'w-[14%]' },
        { ...decided('Suspended'), className: 'w-[26%]' },
        { ...flags, className: 'w-[14%]' },
        { ...money.cash, className: 'w-[18%]' },
        money.actions,
      ];
    case 'rejected':
      return [
        { ...person, className: 'w-[26%]' },
        { ...vehicle, className: 'w-[14%]' },
        { ...decided('Rejected'), className: 'w-[24%]' },
        {
          id: 'reapply',
          header: 'Can apply again',
          className: 'w-[18%]',
          cell: (row) => {
            if (!row.rejected) return null;
            const words = reapplyCell(row.rejected);
            return (
              <>
                <span aria-hidden>{words.text}</span>
                <span className="sr-only">{words.sr}</span>
              </>
            );
          },
        },
        {
          id: 'documents',
          header: 'Documents',
          className: 'w-[18%]',
          cell: (row) => {
            if (!row.rejected) return null;
            const words = documentsCell(row.rejected);
            return (
              <>
                <span aria-hidden>{words.text}</span>
                <span className="sr-only">{words.sr}</span>
              </>
            );
          },
        },
      ];
    default:
      return [
        { ...person, className: 'w-[24%]' },
        { ...vehicle, className: 'w-[12%]' },
        {
          id: 'status',
          header: 'Status',
          className: 'w-[17%]',
          cell: (row) => <StatusChip tab={row.tab} />,
        },
        {
          id: 'changed',
          header: 'Last change',
          className: 'w-[17%]',
          sort: 'changed',
          cell: (row, timeZone) => dateTime(row.lastChangeAt, timeZone),
        },
        { ...flags, className: 'w-[12%]' },
        { ...money.cash, className: 'w-[18%]' },
        money.actions,
      ];
  }
}

function SortButton({
  spec,
  query,
}: {
  spec: ColumnSpec & { sort: PartnerSort };
  query: PartnerListQuery;
}) {
  const active = query.sort === spec.sort;
  const Icon = !active ? ArrowUpDown : query.dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={() => navigateTo(withSort(query, spec.sort))}
      className="-mx-3 inline-flex h-11 items-center gap-1.5 px-3 hover:text-neutral-1 focus-visible:-outline-offset-2"
    >
      {spec.header}
      <Icon className="size-3.5" aria-hidden />
    </button>
  );
}

function ResultsTable({
  result,
  query,
  timeZone,
  busy,
  skeleton,
  context,
}: {
  result: PartnerListResult;
  query: PartnerListQuery;
  timeZone: string;
  busy: boolean;
  skeleton: boolean;
  context: MoneyContext;
}) {
  const router = useRouter();
  const specs = useMemo(() => columnsFor(result.query, context), [result.query, context]);
  const moneyIds = specs.filter((spec) => spec.money).map((spec) => spec.id);
  const columns = useMemo(
    () =>
      helper.columns(
        specs.map((spec) =>
          helper.display({
            id: spec.id,
            header: spec.header,
            cell: (info) => spec.cell(info.row.original, timeZone),
          }),
        ),
      ),
    [specs, timeZone],
  );
  const table = useTable({
    features,
    columns,
    data: result.rows,
    getRowId: (row) => row.partnerId,
  });
  const specOf = (id: string) => specs.find((spec) => spec.id === id);
  const emptyTab = result.total === 0;

  return (
    <div className="relative overflow-hidden rounded-2xl border border-neutral-6 bg-white">
      {busy ? <BusyBar /> : null}
      <table className="w-full table-fixed" aria-busy={busy || skeleton || undefined}>
        <caption className="sr-only">{result.caption}</caption>
        <thead className="bg-neutral-7">
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => {
                const spec = specOf(header.column.id);
                if (!spec) return null;
                const sortable = spec.sort !== undefined;
                const ariaSort =
                  sortable && query.sort === spec.sort
                    ? query.dir === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : sortable
                      ? 'none'
                      : undefined;
                return (
                  <th
                    key={header.id}
                    scope="col"
                    aria-sort={ariaSort}
                    className={cn(
                      'h-11 px-3 text-left text-body-5 font-medium text-neutral-3',
                      spec.className,
                    )}
                  >
                    {spec.sort ? (
                      <SortButton spec={{ ...spec, sort: spec.sort }} query={query} />
                    ) : spec.srHeader ? (
                      <span className="sr-only">{spec.header}</span>
                    ) : (
                      spec.header
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {skeleton
            ? Array.from({ length: 10 }, (_, index) => (
                <tr key={index} aria-hidden className="border-t border-neutral-6">
                  {/* A table cell, not a control. */}
                  {/* oxlint-disable-next-line jsx-a11y/control-has-associated-label */}
                  <td colSpan={specs.length} className="px-3 py-2">
                    <div className="h-12 rounded-lg bg-neutral-7 motion-safe:animate-skeleton" />
                  </td>
                </tr>
              ))
            : null}
          {!skeleton && emptyTab ? (
            <tr className="border-t border-neutral-6">
              <td colSpan={specs.length} className="py-10 text-center text-body-5 text-neutral-3">
                Nothing in this tab yet.
              </td>
            </tr>
          ) : null}
          {skeleton
            ? null
            : table.getRowModel().rows.map((row) => (
                // The row's name link is its control (A32.4); the click is a mouse shortcut only.
                // oxlint-disable-next-line jsx-a11y/control-has-associated-label
                <tr
                  key={row.id}
                  className="cursor-pointer border-t border-neutral-6 hover:bg-neutral-8"
                  onClick={(event) => {
                    // A click anywhere on the row follows its name link (mouse only, 7.5).
                    const target = event.target;
                    if (target instanceof Element && target.closest('a, button')) return;
                    if (window.getSelection()?.toString()) return;
                    router.push(applicationHref(row.original.partnerId, result.query));
                  }}
                >
                  {row.getAllCells().map((cell) => {
                    const spec = specOf(cell.column.id);
                    // A real partner for the demo admin: one cell over the money columns (D29).
                    if (spec?.money && row.original.money?.hidden) {
                      if (cell.column.id !== moneyIds[0]) return null;
                      return (
                        <td
                          key={cell.id}
                          colSpan={moneyIds.length}
                          className="px-3 py-3 align-top text-body-5"
                        >
                          <HiddenMoney />
                        </td>
                      );
                    }
                    return (
                      // A table cell, not a control: the row's name link is the control.
                      // oxlint-disable-next-line jsx-a11y/control-has-associated-label
                      <td
                        key={cell.id}
                        className={cn(
                          'px-3 py-3 align-top text-body-5 text-neutral-1 [overflow-wrap:anywhere]',
                          spec?.className,
                        )}
                      >
                        <table.FlexRender cell={cell} />
                      </td>
                    );
                  })}
                </tr>
              ))}
        </tbody>
      </table>
    </div>
  );
}

/** A 2 px bar sweeping the table's top edge while a sort or filter loads (static, reduced). */
export function BusyBar() {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setShown(true), 150);
    return () => clearTimeout(timer);
  }, []);
  useMotion(
    (motion) => {
      if (!ref.current || !shown) return;
      motion.fromTo(
        ref.current,
        { xPercent: -100 },
        { xPercent: 100, duration: 0.9, ease: 'none', repeat: -1 },
      );
    },
    { scope: ref, dependencies: [shown] },
  );
  if (!shown) return null;
  return (
    <div aria-hidden className="absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden">
      <div ref={ref} className="h-full w-1/2 bg-brand-strong motion-reduce:w-full" />
    </div>
  );
}

// ------------------------------------------------------------------ cards (below lg, 7.9)

function CardKey({ row, timeZone }: { row: PartnerListRow; timeZone: string }) {
  switch (row.tab) {
    case 'review':
      return row.waiting ? <WaitingBlock waiting={row.waiting} /> : null;
    case 'waiting':
      return <SentBackCell row={row} timeZone={timeZone} />;
    case 'approved':
      return onlineState(row);
    case 'suspended':
      return row.decided ? (
        <span>Suspended {decidedCell(row.decided.at, row.decided.byName, timeZone)}</span>
      ) : null;
    default:
      return row.decided ? (
        <span>Rejected {decidedCell(row.decided.at, row.decided.byName, timeZone)}</span>
      ) : null;
  }
}

/** F9 3.2: the card's money, in the key line's order: rating, this week, cash. */
function CardMoney({
  row,
  tab,
  timeZone,
  now,
}: {
  row: MoneyRow;
  tab: PartnerTab;
  timeZone: string;
  now: Date;
}) {
  const money = row.money;
  // A masked card already says it once, under the name.
  if (money.hidden) return row.masked ? null : <HiddenMoney />;
  return (
    <>
      {tab === 'approved' && money.rating ? <RatingCell rating={money.rating} /> : null}
      {tab === 'approved' && money.week ? (
        <span>
          This week · <WeekCell week={money.week} />
        </span>
      ) : null}
      {money.cash ? <CashBlock cash={money.cash} now={now} timeZone={timeZone} /> : null}
    </>
  );
}

function ResultCards({
  result,
  timeZone,
  skeleton,
  context,
}: {
  result: PartnerListResult;
  timeZone: string;
  skeleton: boolean;
  context: MoneyContext;
}) {
  if (skeleton) {
    return (
      <ul aria-busy className="space-y-3">
        {Array.from({ length: 6 }, (_, index) => (
          <li key={index} className="h-28 rounded-2xl bg-neutral-7 motion-safe:animate-skeleton" />
        ))}
      </ul>
    );
  }
  if (result.total === 0) {
    return (
      <p className="rounded-2xl border border-neutral-6 bg-white py-10 text-center text-body-5 text-neutral-3">
        Nothing in this tab yet.
      </p>
    );
  }
  return (
    <ul className="space-y-3">
      {result.rows.map((row) => (
        <li
          key={row.partnerId}
          className="relative rounded-2xl border border-neutral-6 bg-white p-4"
        >
          <div className="flex items-start justify-between gap-3">
            <Link
              href={applicationHref(row.partnerId, result.query)}
              data-row-link={row.partnerId}
              className="inline-flex min-h-11 min-w-0 items-center text-body-3 font-medium text-neutral-1 [overflow-wrap:anywhere] after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-ring focus-visible:after:outline-solid"
            >
              {row.name}
            </Link>
            {hasMoney(row) ? (
              // Above the stretched name link: the card keeps one link plus one menu.
              <MoneyRowMenu
                row={row}
                query={result.query}
                isDemo={context.isDemo}
                onRecordCash={(opener) => context.onRecordCash(row, opener)}
                className="relative z-10 -mt-1 -mr-2 shrink-0"
              />
            ) : (
              <ChevronRight className="size-5 shrink-0 text-neutral-3" aria-hidden />
            )}
          </div>
          <p className="truncate text-body-5 text-neutral-3">{row.email}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-body-5 text-neutral-1">
            <span>
              <VehicleWords words={row.vehicleWords} />
            </span>
            {result.query.tab === 'all' ? <StatusChip tab={row.tab} /> : null}
            <CardKey row={row} timeZone={timeZone} />
            {hasMoney(row) ? (
              <CardMoney row={row} tab={result.query.tab} timeZone={timeZone} now={context.now} />
            ) : null}
            <FlagChips flags={row.flags} compact="always" />
            {row.banned ? <BannedChip /> : null}
            {row.isDemoPartner ? <DemoChip /> : null}
          </div>
          {row.masked ? (
            <p className="mt-2 text-caption text-neutral-3">Hidden for demo staff</p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------------ pager (7.8)

function Pager({
  result,
  query,
  showingRef,
}: {
  result: PartnerListResult;
  query: PartnerListQuery;
  showingRef: React.Ref<HTMLParagraphElement>;
}) {
  if (result.total === 0) return null;
  const pageLink = (page: number, label: string, icon: ReactNode, end: boolean) =>
    end ? (
      <Button
        type="button"
        variant="outline"
        size="touch"
        aria-disabled
        className={BLOCKED_BUTTON_CLASS}
      >
        {label === 'Previous' ? icon : null}
        {label}
        {label === 'Next' ? icon : null}
      </Button>
    ) : (
      <Button asChild variant="outline" size="touch" className="bg-white">
        <ListLink query={withPage(query, page)}>
          {label === 'Previous' ? icon : null}
          {label}
          {label === 'Next' ? icon : null}
        </ListLink>
      </Button>
    );
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <p
        ref={showingRef}
        tabIndex={-1}
        className="text-body-5 text-neutral-3 tabular-nums outline-none"
      >
        {showingText(result.page, result.pageSize, result.total)}
      </p>
      {result.pageCount > 1 ? (
        <div className="flex items-center gap-2">
          {pageLink(
            result.page - 1,
            'Previous',
            <ChevronLeft className="size-4" aria-hidden />,
            result.page <= 1,
          )}
          <span className="text-body-5 text-neutral-2 tabular-nums">
            {pageText(result.page, result.pageCount)}
          </span>
          {pageLink(
            result.page + 1,
            'Next',
            <ChevronRight className="size-4" aria-hidden />,
            result.page >= result.pageCount,
          )}
        </div>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ the page

/** True after `flag` has held for 150 ms, then for at least 300 ms (F1 skeleton rule). */
function useSkeletonFlag(flag: boolean) {
  const [shown, setShown] = useState(false);
  const since = useRef(0);
  useEffect(() => {
    if (flag) {
      const timer = setTimeout(() => {
        since.current = Date.now();
        setShown(true);
      }, 150);
      return () => clearTimeout(timer);
    }
    const hold = Math.max(0, 300 - (Date.now() - since.current));
    const timer = setTimeout(() => setShown(false), shown ? hold : 0);
    return () => clearTimeout(timer);
  }, [flag, shown]);
  return shown;
}

const filterKeyOf = (query: PartnerListQuery) =>
  JSON.stringify({
    tab: query.tab,
    q: query.q,
    vehicle: query.vehicle,
    flags: query.flags,
    owes: query.owes,
  });

interface CashDialog {
  partnerId: string;
  name: string;
  opener: HTMLElement | null;
}

export function PartnersList({ initial }: { initial: PartnerListResult }) {
  const shell = useStaffShell();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const [signedOut, setSignedOut] = useState(false);
  const sessionEnded = useSessionPhase(shell.sessionExpiresAt) === 'ended';
  const query = useMemo(() => listQueryFromSearch(Object.fromEntries(params.entries())), [params]);
  const list = usePartnerList(query, initial, !signedOut && !sessionEnded);
  const result = list.data ?? initial;
  const resultsRef = useRef<HTMLDivElement>(null);
  const showingRef = useRef<HTMLParagraphElement>(null);
  const focused = useRef<{ id: string; index: number } | null>(null);
  const online = useOnline();
  const [cashDialog, setCashDialog] = useState<CashDialog | null>(null);
  // The cash block's "since Tue" reads the list's own server time.
  const asOf = result.asOf;
  const context = useMemo<MoneyContext>(
    () => ({
      now: new Date(asOf),
      isDemo: shell.user.isDemo,
      onRecordCash: (row, opener) =>
        setCashDialog({ partnerId: row.partnerId, name: row.name, opener }),
    }),
    [asOf, shell.user.isDemo],
  );

  const pending = list.isPlaceholderData && list.isFetching;
  const pageChanging = pending && result.page !== query.page;
  const skeleton = useSkeletonFlag(pageChanging);
  const failed = list.isError && (list.isPlaceholderData || !list.data);

  // The session ended under the list: it stops asking and shows the sign-in cover.
  const signedOutNow =
    list.error instanceof ReadError && list.error.failure.code === 'UNAUTHENTICATED';
  if (signedOutNow && !signedOut) setSignedOut(true);

  // The sidebar badge follows the list's own count of applications to review.
  useEffect(() => {
    if (list.isPlaceholderData) return;
    queryClient.setQueryData(partnerKeys.badge, { toReview: result.counts.review });
  }, [result, list.isPlaceholderData, queryClient]);

  // A changed search or filter reads the new count once (7.4); refreshes don't.
  const announced = useRef(filterKeyOf(query));
  useEffect(() => {
    if (list.isPlaceholderData || !list.data) return;
    const key = filterKeyOf(list.data.query);
    if (key === announced.current) return;
    announced.current = key;
    announce(resultCountText(list.data.total));
  }, [list.data, list.isPlaceholderData]);

  // A refresh that took away the focused row moves focus to the next one (7.10).
  useEffect(() => {
    const was = focused.current;
    if (!was || document.activeElement !== document.body) return;
    if (result.rows.some((row) => row.partnerId === was.id)) return;
    const visible = [
      ...(resultsRef.current?.querySelectorAll<HTMLElement>('[data-row-link]') ?? []),
    ].filter((link) => link.offsetParent !== null);
    const next = visible[Math.min(was.index, visible.length - 1)];
    if (next) next.focus();
    else showingRef.current?.focus();
    focused.current = null;
  }, [result.rows]);

  const reviewEmpty =
    result.query.tab === 'review' && result.total === 0 && !hasFilters(result.query);
  const noMatch = result.total === 0 && hasFilters(result.query);

  let results: ReactNode;
  if (failed) {
    results = (
      <FormAlert
        variant="error"
        action={
          <Button
            type="button"
            variant="outline"
            size="touch"
            className="bg-white"
            onClick={() => void list.refetch()}
          >
            Try again
          </Button>
        }
      >
        We couldn&apos;t load applications. Try again.
      </FormAlert>
    );
  } else if (reviewEmpty && !skeleton) {
    results = (
      <div className="rounded-2xl border border-neutral-6 bg-white px-4 py-10">
        <EmptyState
          illustration="noData"
          illustrationSize="compact"
          title="No applications to review"
          description="New applications appear here. Applicants are told we usually decide within 2 working days."
          action={
            <Button asChild variant="outline" size="touch">
              <ListLink query={withTab(query, 'all')}>See all applications</ListLink>
            </Button>
          }
        />
      </div>
    );
  } else if (noMatch && !skeleton) {
    results = (
      <div className="rounded-2xl border border-neutral-6 bg-white px-4 py-10">
        <EmptyState
          title={result.query.owes ? 'No matching partners' : 'No matching applications'}
          description={result.query.owes ? NO_PARTNERS_OWE : 'No applications match these filters.'}
          action={
            <Button asChild variant="outline" size="touch">
              <ListLink
                query={withFilters(query, { q: '', vehicle: null, flags: false, owes: false })}
              >
                Clear filters
              </ListLink>
            </Button>
          }
        />
      </div>
    );
  } else {
    results = (
      <>
        <div className="hidden lg:block">
          <ResultsTable
            result={result}
            query={query}
            timeZone={shell.timeZone}
            busy={pending && !pageChanging}
            skeleton={skeleton}
            context={context}
          />
        </div>
        <div className="lg:hidden" aria-busy={pending || undefined}>
          <ResultCards
            result={result}
            timeZone={shell.timeZone}
            skeleton={skeleton}
            context={context}
          />
        </div>
      </>
    );
  }

  return (
    <AdminPage title="Partners">
      <div className="px-4 pb-10 lg:px-6" inert={signedOut || undefined}>
        <div className="pt-4">
          <StateTabs query={query} counts={result.counts} />
        </div>
        <Toolbar key={query.tab} query={query} />
        <div
          ref={resultsRef}
          className="mt-4"
          onFocus={(event) => {
            const target = event.target;
            if (!(target instanceof HTMLElement) || !target.dataset.rowLink) {
              focused.current = null;
              return;
            }
            const links = [
              ...(resultsRef.current?.querySelectorAll<HTMLElement>('[data-row-link]') ?? []),
            ].filter((link) => link.offsetParent !== null);
            focused.current = { id: target.dataset.rowLink, index: links.indexOf(target) };
          }}
        >
          {results}
        </div>
        {failed ? null : <Pager result={result} query={query} showingRef={showingRef} />}
      </div>
      {cashDialog ? (
        <MoneyDialog
          key={cashDialog.partnerId}
          kind="cash"
          partnerId={cashDialog.partnerId}
          partnerName={cashDialog.name}
          timeZone={shell.timeZone}
          offline={!online}
          onClose={() => setCashDialog(null)}
          onCloseFocus={() => {
            const opener = cashDialog.opener;
            if (opener?.isConnected) {
              opener.focus();
              return true;
            }
            return false;
          }}
          onDone={() => {
            setCashDialog(null);
            void queryClient.invalidateQueries({ queryKey: partnerKeys.all });
          }}
          onSignedOut={() => setSignedOut(true)}
        />
      ) : null}
      {signedOut || sessionEnded ? <SignedOutOverlay /> : null}
    </AdminPage>
  );
}
