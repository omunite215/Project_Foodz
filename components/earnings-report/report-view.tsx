'use client';

import { useDebouncer } from '@tanstack/react-pacer';
import { createColumnHelper, tableFeatures, useTable } from '@tanstack/react-table';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CalendarRange,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Search,
  X,
} from 'lucide-react';
import Link from 'next/link';
import {
  type ComponentProps,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  type EarningsReport,
  type EarningsReportQuery,
  type IsoDate,
  REPORT_FILTERS,
  REPORT_PRESETS,
  type ReportFigures,
  type ReportFilter,
  type ReportPreset,
  type ReportRow,
  type ReportSort,
  type ReportTotals,
} from '@/server/modules/earnings/schema';
import { CsvButton } from '@/components/admin/csv-button';
import { FormAlert } from '@/components/forms/form-alert';
import { BLOCKED_BUTTON_CLASS } from '@/components/forms/submit-button';
import { EmptyState } from '@/components/states/empty-state';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/field';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import {
  customRangeErrors,
  type CustomRangeErrors,
  hasReportFilters,
  MIN_REPORT_SEARCH,
  partnerEarningsHref,
  presetOf,
  reportHref,
  withFilter,
  withoutFilters,
  withPreset,
  withRange,
  withReportPage,
  withSearch,
  withSort,
} from '@/lib/admin/report-query';
import {
  adjustmentText,
  balanceParts,
  balanceText,
  COLUMN_LABELS,
  csvNameSuffix,
  customLinkText,
  emptyRangeText,
  FILTER_LABELS,
  partnerCount,
  PRESET_LABELS,
  rangeButtonText,
  rangeCaption,
  REPORT_COPY,
  tableCaption,
  totalsBalanceLines,
  totalsLabel,
} from '@/lib/admin/report-text';
import { formatPrice } from '@/lib/format';
import { useMotion } from '@/lib/motion';
import { pageText, showingText } from '@/lib/partner-review/text';
import { useMediaQuery } from '@/lib/use-media-query';
import { cn } from '@/lib/utils';

/*
 * The payouts report (F9 design 3.12 to 3.15): the range, the two figures Daniel acts on, the
 * toolbar and the table, all from the server; the browser only formats cents. From 1024 px a
 * table (scrolling inside its own region up to 1279 px, the Partner column pinned); below, one
 * card per partner with the closing balance first.
 */

export type Navigate = (query: EarningsReportQuery, mode?: 'push' | 'replace') => void;

const FIELD_INPUT =
  'h-11 w-full rounded-xl border border-input bg-white px-3 text-body-4 text-neutral-2 tabular-nums outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid aria-invalid:border-destructive';

const CHOICE_LINK =
  'inline-flex h-11 shrink-0 items-center gap-1.5 rounded-lg border border-neutral-6 bg-white px-4 text-button-2 font-medium text-neutral-1 outline-none hover:bg-neutral-7 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid';
const CHOICE_CURRENT = 'border-2 border-brand-strong bg-brand-soft px-[15px] hover:bg-brand-soft';

const count = new Intl.NumberFormat('en-US');

/** A real link to the report's next address that changes it in place for a plain click. */
function ReportLink({
  query,
  navigate,
  children,
  ...props
}: Omit<ComponentProps<typeof Link>, 'href' | 'onNavigate'> & {
  query: EarningsReportQuery;
  navigate: Navigate;
}) {
  return (
    <Link
      {...props}
      href={reportHref(query)}
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

// ------------------------------------------------------------------ the custom dates

function DateField({
  id,
  label,
  value,
  error,
  max,
  inputRef,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  error: string | undefined;
  max: IsoDate;
  inputRef?: React.Ref<HTMLInputElement>;
  onChange: (value: string) => void;
}) {
  const errorId = `${id}-error`;
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="block text-body-5 font-medium text-neutral-2">
        {label}
      </label>
      <input
        ref={inputRef}
        id={id}
        type="date"
        value={value}
        max={max}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => onChange(event.target.value)}
        className={cn(FIELD_INPUT, 'mt-1.5 md:w-44')}
      />
      <FieldError id={error ? errorId : undefined}>{error}</FieldError>
    </div>
  );
}

/** "From", "To" and "Apply"; checked on "Apply", the first wrong date focused (design 3.12). */
function useCustomDates(query: EarningsReportQuery, today: IsoDate) {
  const [from, setFrom] = useState<string>(query.from);
  const [to, setTo] = useState<string>(query.to);
  const [errors, setErrors] = useState<CustomRangeErrors>({});
  const fromRef = useRef<HTMLInputElement>(null);
  const toRef = useRef<HTMLInputElement>(null);
  const check = () => {
    const found = customRangeErrors(from, to, today);
    setErrors(found);
    if (found.from) fromRef.current?.focus();
    else if (found.to) toRef.current?.focus();
    return found.from || found.to ? null : { from, to };
  };
  return {
    from,
    to,
    errors,
    fromRef,
    toRef,
    setFrom: (value: string) => {
      setFrom(value);
      setErrors((current) => ({ ...current, from: undefined }));
    },
    setTo: (value: string) => {
      setTo(value);
      setErrors((current) => ({ ...current, to: undefined }));
    },
    check,
  };
}

function CustomRangeForm({
  id,
  query,
  today,
  navigate,
  onApplied,
}: {
  id: string;
  query: EarningsReportQuery;
  today: IsoDate;
  navigate: Navigate;
  onApplied: () => void;
}) {
  const dates = useCustomDates(query, today);
  useEffect(() => {
    dates.fromRef.current?.focus();
    // Focus moves to "From" once, when the dates open.
    // oxlint-disable-next-line react/exhaustive-deps
  }, []);
  return (
    <form
      id={id}
      noValidate
      className="flex w-full flex-wrap items-start gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const range = dates.check();
        if (!range) return;
        navigate(withRange(query, range));
        onApplied();
      }}
    >
      <DateField
        id={`${id}-from`}
        label={REPORT_COPY.from}
        value={dates.from}
        error={dates.errors.from}
        max={today}
        inputRef={dates.fromRef}
        onChange={dates.setFrom}
      />
      <DateField
        id={`${id}-to`}
        label={REPORT_COPY.to}
        value={dates.to}
        error={dates.errors.to}
        max={today}
        inputRef={dates.toRef}
        onChange={dates.setTo}
      />
      {/* Lines up with the inputs under their labels. */}
      <Button type="submit" variant="outline" size="touch" className="mt-[1.625rem] bg-white">
        {REPORT_COPY.apply}
      </Button>
    </form>
  );
}

// ------------------------------------------------------------------ range (3.12, 3.14)

function RangeLinks({
  query,
  today,
  navigate,
  initialCustomOpen,
}: {
  query: EarningsReportQuery;
  today: IsoDate;
  navigate: Navigate;
  initialCustomOpen: boolean;
}) {
  const id = useId();
  const current = presetOf(query, today);
  const [customOpen, setCustomOpen] = useState(initialCustomOpen);
  const customRef = useRef<HTMLButtonElement>(null);
  return (
    <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
      <fieldset className="flex min-w-0 flex-wrap gap-2">
        <legend className="sr-only">{REPORT_COPY.range}</legend>
        {REPORT_PRESETS.filter((preset) => preset !== 'custom').map((preset) => {
          const isCurrent = preset === current;
          return (
            <ReportLink
              key={preset}
              query={withPreset(query, preset, today)}
              navigate={navigate}
              aria-current={isCurrent ? 'true' : undefined}
              onClick={() => setCustomOpen(false)}
              className={cn(CHOICE_LINK, isCurrent && CHOICE_CURRENT)}
            >
              {isCurrent ? <Check className="size-4 text-brand-strong" aria-hidden /> : null}
              {PRESET_LABELS[preset]}
            </ReportLink>
          );
        })}
        <button
          ref={customRef}
          type="button"
          aria-expanded={customOpen}
          aria-controls={customOpen ? `${id}-custom` : undefined}
          aria-current={current === 'custom' ? 'true' : undefined}
          onClick={() => setCustomOpen((open) => !open)}
          className={cn(CHOICE_LINK, current === 'custom' && CHOICE_CURRENT)}
        >
          {current === 'custom' ? <Check className="size-4 text-brand-strong" aria-hidden /> : null}
          <span className="tabular-nums">
            {customLinkText(current === 'custom', query.from, query.to)}
          </span>
          <ChevronDown
            className={cn('size-4 text-neutral-3', customOpen && 'rotate-180')}
            aria-hidden
          />
        </button>
      </fieldset>
      {customOpen ? (
        <CustomRangeForm
          key={`${query.from}-${query.to}`}
          id={`${id}-custom`}
          query={query}
          today={today}
          navigate={navigate}
          onApplied={() => {
            setCustomOpen(false);
            customRef.current?.focus();
          }}
        />
      ) : null}
    </div>
  );
}

const RADIO_ROW =
  'flex min-h-12 cursor-pointer items-center gap-3 rounded-lg px-3 text-body-4 text-neutral-1 has-[:checked]:bg-brand-soft has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring has-[:focus-visible]:outline-solid';

/** At 375 the range is one button and a bottom sheet (design 3.14). */
function RangeSheet({
  query,
  today,
  navigate,
  initialOpen,
}: {
  query: EarningsReportQuery;
  today: IsoDate;
  navigate: Navigate;
  initialOpen: boolean;
}) {
  const id = useId();
  const current = presetOf(query, today);
  const [open, setOpen] = useState(initialOpen);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="touch"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="w-full justify-between border-input bg-white text-neutral-1"
      >
        <span className="inline-flex min-w-0 items-center gap-2">
          <CalendarRange className="size-4 shrink-0" aria-hidden />
          <span className="truncate tabular-nums">
            {rangeButtonText(current, query.from, query.to)}
          </span>
        </span>
        <ChevronDown className="size-4 shrink-0" aria-hidden />
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        {open ? (
          <RangeSheetBody
            key={`${query.from}-${query.to}`}
            id={id}
            query={query}
            today={today}
            current={current}
            onDone={(next) => {
              setOpen(false);
              if (next) navigate(next);
            }}
          />
        ) : null}
      </Sheet>
    </>
  );
}

function RangeSheetBody({
  id,
  query,
  today,
  current,
  onDone,
}: {
  id: string;
  query: EarningsReportQuery;
  today: IsoDate;
  current: ReportPreset;
  onDone: (next: EarningsReportQuery | null) => void;
}) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [choice, setChoice] = useState<ReportPreset>(current);
  const dates = useCustomDates(query, today);
  return (
    <SheetContent
      aria-describedby={undefined}
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        titleRef.current?.focus();
      }}
      className="inset-x-0 bottom-0 max-h-[90dvh] overflow-y-auto rounded-t-2xl bg-white px-4 pt-6 pb-[max(1rem,env(safe-area-inset-bottom))] motion-safe:data-[state=closed]:slide-out-to-bottom motion-safe:data-[state=open]:slide-in-from-bottom"
    >
      <SheetTitle
        ref={titleRef}
        tabIndex={-1}
        className="font-heading text-title-1 text-neutral-1 outline-none"
      >
        {REPORT_COPY.dateRange}
      </SheetTitle>
      <form
        noValidate
        className="mt-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (choice !== 'custom') {
            onDone(withPreset(query, choice, today));
            return;
          }
          const range = dates.check();
          if (range) onDone(withRange(query, range));
        }}
      >
        <fieldset className="min-w-0">
          <legend className="sr-only">{REPORT_COPY.range}</legend>
          <div className="space-y-1">
            {REPORT_PRESETS.map((preset) => (
              <label key={preset} className={RADIO_ROW}>
                <input
                  type="radio"
                  name={`${id}-range`}
                  value={preset}
                  checked={choice === preset}
                  onChange={() => setChoice(preset)}
                  className="size-5 shrink-0 accent-brand-strong outline-none"
                />
                {PRESET_LABELS[preset]}
              </label>
            ))}
          </div>
        </fieldset>
        {choice === 'custom' ? (
          <div className="mt-3 grid grid-cols-1 gap-3 px-3 min-[22rem]:grid-cols-2">
            <DateField
              id={`${id}-from`}
              label={REPORT_COPY.from}
              value={dates.from}
              error={dates.errors.from}
              max={today}
              inputRef={dates.fromRef}
              onChange={dates.setFrom}
            />
            <DateField
              id={`${id}-to`}
              label={REPORT_COPY.to}
              value={dates.to}
              error={dates.errors.to}
              max={today}
              inputRef={dates.toRef}
              onChange={dates.setTo}
            />
          </div>
        ) : null}
        <div className="mt-6 flex flex-col gap-2">
          <Button type="submit" size="touch" className="w-full">
            {REPORT_COPY.apply}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="touch"
            className="w-full"
            onClick={() => onDone(null)}
          >
            {REPORT_COPY.cancel}
          </Button>
        </div>
      </form>
    </SheetContent>
  );
}

// ------------------------------------------------------------------ summary (3.12)

function SummaryTiles({ summary }: { summary: EarningsReport['summary'] }) {
  const tiles = [
    {
      label: REPORT_COPY.owedToPartners,
      cents: summary.owedToPartnersCents,
      partners: summary.owedToPartnersCount,
    },
    {
      label: REPORT_COPY.owedByPartners,
      cents: summary.owedByPartnersCents,
      partners: summary.owedByPartnersCount,
    },
  ];
  return (
    <dl className="grid grid-cols-2 gap-3 md:flex md:flex-wrap">
      {tiles.map((tile) => (
        <div
          key={tile.label}
          className="min-w-0 rounded-xl border border-neutral-6 bg-white px-4 py-3 md:min-w-56"
        >
          <dt className="text-body-5 text-neutral-3">{tile.label}</dt>
          <dd className="mt-1 text-body-2 font-semibold text-neutral-1 tabular-nums">
            {formatPrice(tile.cents)}
          </dd>
          <dd className="text-body-5 text-neutral-3 tabular-nums">{partnerCount(tile.partners)}</dd>
        </div>
      ))}
    </dl>
  );
}

// ------------------------------------------------------------------ toolbar (3.12, 3.14)

function SearchField({ query, navigate }: { query: EarningsReportQuery; navigate: Navigate }) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(query.q);
  const debouncer = useDebouncer((value: string) => navigate(withSearch(query, value), 'replace'), {
    wait: 300,
  });
  // The address changed elsewhere (Back, "Clear filters"): the box follows it.
  const [lastQ, setLastQ] = useState(query.q);
  if (query.q !== lastQ) {
    setLastQ(query.q);
    if (text.trim() !== query.q) setText(query.q);
  }
  const tooShort = text.trim().length > 0 && text.trim().length < MIN_REPORT_SEARCH;
  return (
    <search className="w-full md:w-72">
      <form
        className="w-full"
        onSubmit={(event) => {
          event.preventDefault();
          debouncer.cancel();
          navigate(withSearch(query, text), 'replace');
        }}
      >
        <label htmlFor={`${id}-q`} className="block text-body-5 font-medium text-neutral-2">
          {REPORT_COPY.search}
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
            className="h-11 w-full rounded-xl border border-input bg-white pr-11 pl-10 text-body-4 text-neutral-2 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid [&::-webkit-search-cancel-button]:hidden"
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
                navigate(withSearch(query, ''), 'replace');
                inputRef.current?.focus();
              }}
            >
              <X className="size-4" aria-hidden />
            </Button>
          ) : null}
        </div>
        {tooShort ? (
          <p id={`${id}-hint`} className="mt-1 text-caption text-neutral-3">
            {REPORT_COPY.searchHint}
          </p>
        ) : null}
      </form>
    </search>
  );
}

function FilterLinks({ query, navigate }: { query: EarningsReportQuery; navigate: Navigate }) {
  return (
    <fieldset className="flex min-w-0 flex-wrap gap-2">
      <legend className="sr-only">{REPORT_COPY.show}</legend>
      {REPORT_FILTERS.map((filter) => {
        const isCurrent = query.filter === filter;
        return (
          <ReportLink
            key={filter}
            query={withFilter(query, filter)}
            navigate={navigate}
            aria-current={isCurrent ? 'true' : undefined}
            className={cn(CHOICE_LINK, isCurrent && CHOICE_CURRENT)}
          >
            {isCurrent ? <Check className="size-4 text-brand-strong" aria-hidden /> : null}
            {FILTER_LABELS[filter]}
          </ReportLink>
        );
      })}
    </fieldset>
  );
}

function FilterSelect({ query, navigate }: { query: EarningsReportQuery; navigate: Navigate }) {
  const id = useId();
  return (
    <div className="w-full">
      <label htmlFor={id} className="block text-body-5 font-medium text-neutral-2">
        {REPORT_COPY.show}
      </label>
      <div className="relative mt-1.5">
        <select
          id={id}
          value={query.filter}
          onChange={(event) => {
            const filter: ReportFilter =
              REPORT_FILTERS.find((value) => value === event.target.value) ?? 'all';
            navigate(withFilter(query, filter));
          }}
          className="h-11 w-full appearance-none rounded-xl border border-input bg-white pr-10 pl-4 text-body-4 text-neutral-2 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid"
        >
          {REPORT_FILTERS.map((filter) => (
            <option key={filter} value={filter}>
              {FILTER_LABELS[filter]}
            </option>
          ))}
        </select>
        <ChevronDown
          className="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-neutral-3"
          aria-hidden
        />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ cells (3.13)

const MONEY_COLUMNS = [
  'deliveries',
  'deliveryPay',
  'tips',
  'adjustments',
  'earned',
  'cashCollected',
  'cashHandedIn',
  'paidOut',
  'opening',
  'closing',
] as const satisfies readonly ReportSort[];
type MoneyColumn = (typeof MONEY_COLUMNS)[number];

const WIDTHS: Record<ReportSort, string> = {
  partner: 'w-[14%]',
  deliveries: 'w-[6%]',
  deliveryPay: 'w-[8%]',
  tips: 'w-[7%]',
  adjustments: 'w-[9%]',
  earned: 'w-[8%]',
  cashCollected: 'w-[8%]',
  cashHandedIn: 'w-[8%]',
  paidOut: 'w-[7%]',
  opening: 'w-[12%]',
  closing: 'w-[13%]',
};

/** "Foodz owes" and the amount each kept whole, so it wraps before the amount. */
function BalanceWords({ cents }: { cents: number }) {
  const parts = balanceParts(cents);
  if (!parts.lead) return <span className="whitespace-nowrap">{parts.amount}</span>;
  return (
    <>
      <span className="whitespace-nowrap">{parts.lead}</span>{' '}
      <span className="whitespace-nowrap">{parts.amount}</span>
    </>
  );
}

function figureCell(column: MoneyColumn, figures: ReportFigures): ReactNode {
  switch (column) {
    case 'deliveries':
      return count.format(figures.deliveries);
    case 'deliveryPay':
      return formatPrice(figures.deliveryPayCents);
    case 'tips':
      return formatPrice(figures.tipsCents);
    case 'adjustments':
      return adjustmentText(figures.adjustmentsCents);
    case 'earned':
      return <span className="font-semibold">{formatPrice(figures.earnedCents)}</span>;
    case 'cashCollected':
      return formatPrice(figures.cashCollectedCents);
    case 'cashHandedIn':
      return formatPrice(figures.cashHandedInCents);
    case 'paidOut':
      return formatPrice(figures.paidOutCents);
    case 'opening':
      return <BalanceWords cents={figures.openingCents} />;
    case 'closing':
    default:
      return <BalanceWords cents={figures.closingCents} />;
  }
}

function TotalsBalance({ split }: { split: ReportTotals['closing'] }) {
  const [owed, owedTo] = totalsBalanceLines(split);
  return (
    <>
      <span className="block">{owed}</span>
      <span className="block">{owedTo}</span>
    </>
  );
}

function totalsCell(column: MoneyColumn, totals: ReportTotals): ReactNode {
  switch (column) {
    case 'deliveries':
      return count.format(totals.deliveries);
    case 'deliveryPay':
      return formatPrice(totals.deliveryPayCents);
    case 'tips':
      return formatPrice(totals.tipsCents);
    case 'adjustments':
      return adjustmentText(totals.adjustmentsCents);
    case 'earned':
      return formatPrice(totals.earnedCents);
    case 'cashCollected':
      return formatPrice(totals.cashCollectedCents);
    case 'cashHandedIn':
      return formatPrice(totals.cashHandedInCents);
    case 'paidOut':
      return formatPrice(totals.paidOutCents);
    case 'opening':
      return <TotalsBalance split={totals.opening} />;
    case 'closing':
    default:
      return <TotalsBalance split={totals.closing} />;
  }
}

function PartnerName({
  row,
  range,
  className,
}: {
  row: ReportRow;
  range: { from: IsoDate; to: IsoDate };
  className?: string;
}) {
  if (row.deleted) return <span className={cn('text-neutral-3', className)}>{row.name}</span>;
  return (
    <Link
      href={partnerEarningsHref(row.partnerId, range)}
      className={cn(
        'font-medium text-neutral-1 underline-offset-4 [overflow-wrap:anywhere] hover:underline',
        className,
      )}
    >
      {row.name}
    </Link>
  );
}

// ------------------------------------------------------------------ table (3.13)

const features = tableFeatures({});
const helper = createColumnHelper<typeof features, ReportRow>();

/** A 2 px bar sweeping the table's top edge while a range or filter loads (static, reduced). */
function BusyBar() {
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
    <div aria-hidden className="absolute inset-x-0 top-0 z-20 h-0.5 overflow-hidden">
      <div ref={ref} className="h-full w-1/2 bg-brand-strong motion-reduce:w-full" />
    </div>
  );
}

/** The Partner column stays put while the table scrolls sideways at 1024 to 1279 (D25). */
const STICKY =
  'sticky left-0 z-10 shadow-[1px_0_0_var(--color-neutral-6)] xl:static xl:shadow-none';

const SORT_IDS = ['partner', ...MONEY_COLUMNS] as const satisfies readonly ReportSort[];
const sortOf = (id: string): ReportSort => SORT_IDS.find((sort) => sort === id) ?? 'partner';

function SortHeader({
  sort,
  query,
  navigate,
}: {
  sort: ReportSort;
  query: EarningsReportQuery;
  navigate: Navigate;
}) {
  const active = query.sort === sort;
  const Icon = !active ? ArrowUpDown : query.dir === 'asc' ? ArrowUp : ArrowDown;
  const numeric = sort !== 'partner';
  return (
    <button
      type="button"
      onClick={() => navigate(withSort(query, sort))}
      // Exactly its cell's width (review S6): the label and its icon wrap inside it, never into
      // the next column; the inner padding is smaller than the cell's so long words fit.
      className={cn(
        '-mx-3 flex min-h-11 w-[calc(100%+1.5rem)] min-w-0 items-end px-1 py-1 whitespace-normal hover:text-neutral-1 focus-visible:-outline-offset-2',
        numeric ? 'justify-end text-right' : 'text-left',
      )}
    >
      <span className="min-w-0">
        {COLUMN_LABELS[sort]}
        <Icon className="ml-1 inline-block size-3.5 shrink-0 align-[-2px]" aria-hidden />
      </span>
    </button>
  );
}

function ReportTable({
  result,
  query,
  navigate,
  busy,
  skeleton,
}: {
  result: EarningsReport;
  query: EarningsReportQuery;
  navigate: Navigate;
  busy: boolean;
  skeleton: boolean;
}) {
  const captionId = useId();
  const wide = useMediaQuery('(min-width: 80rem)');
  const columns = useMemo(
    () =>
      helper.columns(
        SORT_IDS.map((sort) => helper.display({ id: sort, header: COLUMN_LABELS[sort] })),
      ),
    [],
  );
  const table = useTable({
    features,
    columns,
    data: result.rows,
    getRowId: (row) => row.partnerId,
  });
  const range = result.range;
  const ariaSort = (sort: ReportSort) =>
    result.query.sort === sort ? (result.query.dir === 'asc' ? 'ascending' : 'descending') : 'none';

  return (
    <div className="relative overflow-hidden rounded-2xl border border-neutral-6 bg-white">
      {busy ? <BusyBar /> : null}
      {/* A named section is a region: the caption names it. */}
      <section
        aria-labelledby={captionId}
        // Focusable where it scrolls (1024 to 1279), so the keyboard can move it too.
        tabIndex={wide ? undefined : 0}
        className="overflow-x-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid"
      >
        <table
          className="w-full min-w-[68.75rem] table-fixed xl:min-w-0"
          aria-busy={busy || skeleton || undefined}
        >
          <caption id={captionId} className="sr-only">
            {tableCaption(range, result.query.sort, result.query.dir, result.total)}
          </caption>
          <thead className="bg-neutral-7">
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => {
                  const sort = sortOf(header.column.id);
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      aria-sort={ariaSort(sort)}
                      className={cn(
                        'px-3 py-2 align-bottom text-body-5 font-medium whitespace-normal text-neutral-3',
                        WIDTHS[sort],
                        sort === 'partner' ? cn('text-left', STICKY, 'bg-neutral-7') : 'text-right',
                      )}
                    >
                      <SortHeader sort={sort} query={query} navigate={navigate} />
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
                    <td colSpan={11} className="px-3 py-2">
                      <div className="h-10 rounded-lg bg-neutral-7 motion-safe:animate-skeleton" />
                    </td>
                  </tr>
                ))
              : table.getRowModel().rows.map((row) => {
                  const original = row.original;
                  const figures = original.figures;
                  return (
                    <tr key={row.id} className="border-t border-neutral-6">
                      <th
                        scope="row"
                        className={cn(
                          'bg-white px-3 py-3 text-left align-top text-body-5 font-normal text-neutral-1',
                          STICKY,
                        )}
                      >
                        <PartnerName row={original} range={range} />
                      </th>
                      {figures ? (
                        MONEY_COLUMNS.map((column) => (
                          <td
                            key={column}
                            className="px-3 py-3 text-right align-top text-body-5 text-neutral-1 tabular-nums"
                          >
                            {figureCell(column, figures)}
                          </td>
                        ))
                      ) : (
                        // D29: one cell for the masked row's money, read once.
                        <td
                          colSpan={MONEY_COLUMNS.length}
                          className="px-3 py-3 align-top text-body-5 text-neutral-3"
                        >
                          {REPORT_COPY.hidden}
                        </td>
                      )}
                    </tr>
                  );
                })}
          </tbody>
          {skeleton || result.total === 0 ? null : (
            <tfoot className="border-t-2 border-neutral-5 bg-neutral-8 font-semibold">
              <tr>
                <th
                  scope="row"
                  className={cn(
                    'bg-neutral-8 px-3 py-3 text-left align-top text-body-5 text-neutral-1',
                    STICKY,
                  )}
                >
                  {totalsLabel(result.totals.partners)}
                </th>
                {MONEY_COLUMNS.map((column) => (
                  <td
                    key={column}
                    className="px-3 py-3 text-right align-top text-body-5 text-neutral-1 tabular-nums"
                  >
                    {totalsCell(column, result.totals)}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ cards (3.14)

function FigureRows({ figures }: { figures: ReportFigures }) {
  const rows = MONEY_COLUMNS.filter((column) => column !== 'closing');
  return (
    <dl className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 text-body-5 tabular-nums">
      {rows.map((column) => (
        <div key={column} className="contents">
          <dt
            className={cn('text-neutral-3', column === 'earned' && 'font-semibold text-neutral-1')}
          >
            {COLUMN_LABELS[column]}
          </dt>
          <dd className="text-right text-neutral-1">{figureCell(column, figures)}</dd>
        </div>
      ))}
    </dl>
  );
}

function ReportCards({ result, skeleton }: { result: EarningsReport; skeleton: boolean }) {
  if (skeleton) {
    return (
      <ul aria-busy className="space-y-3">
        {Array.from({ length: 6 }, (_, index) => (
          <li key={index} className="h-40 rounded-2xl bg-neutral-7 motion-safe:animate-skeleton" />
        ))}
      </ul>
    );
  }
  const totals = result.totals;
  return (
    <ul className="space-y-3">
      {result.rows.map((row) => (
        <li key={row.partnerId} className="rounded-2xl border border-neutral-6 bg-white p-4">
          {row.figures ? (
            <>
              <p className="text-body-5 text-neutral-3">{REPORT_COPY.closingBalance}</p>
              <p className="text-body-2 font-semibold text-neutral-1 tabular-nums">
                {balanceText(row.figures.closingCents)}
              </p>
              <p className="mt-2 text-body-3">
                <PartnerName
                  row={row}
                  range={result.range}
                  className="inline-flex min-h-11 items-center"
                />
              </p>
              <FigureRows figures={row.figures} />
            </>
          ) : (
            <>
              <p className="text-body-3">
                <PartnerName
                  row={row}
                  range={result.range}
                  className="inline-flex min-h-11 items-center"
                />
              </p>
              <p className="text-body-5 text-neutral-3">{REPORT_COPY.hidden}</p>
            </>
          )}
        </li>
      ))}
      <li className="rounded-2xl border border-neutral-6 bg-neutral-8 p-4">
        <p className="text-body-3 font-semibold text-neutral-1">{totalsLabel(totals.partners)}</p>
        <dl className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 text-body-5 tabular-nums">
          {MONEY_COLUMNS.map((column) => (
            <div key={column} className="contents">
              <dt className="text-neutral-3">{COLUMN_LABELS[column]}</dt>
              <dd className="text-right font-semibold text-neutral-1">
                {totalsCell(column, totals)}
              </dd>
            </div>
          ))}
        </dl>
      </li>
    </ul>
  );
}

// ------------------------------------------------------------------ pager (F6 7.8)

function Pager({
  result,
  query,
  navigate,
  showingRef,
}: {
  result: EarningsReport;
  query: EarningsReportQuery;
  navigate: Navigate;
  showingRef?: React.Ref<HTMLParagraphElement>;
}) {
  if (result.total === 0) return null;
  const pageLink = (page: number, label: 'Previous' | 'Next', end: boolean) => {
    const icon =
      label === 'Previous' ? (
        <ChevronLeft className="size-4" aria-hidden />
      ) : (
        <ChevronRight className="size-4" aria-hidden />
      );
    const content = (
      <>
        {label === 'Previous' ? icon : null}
        {label}
        {label === 'Next' ? icon : null}
      </>
    );
    return end ? (
      <Button
        type="button"
        variant="outline"
        size="touch"
        aria-disabled
        className={BLOCKED_BUTTON_CLASS}
      >
        {content}
      </Button>
    ) : (
      <Button asChild variant="outline" size="touch" className="bg-white">
        <ReportLink query={withReportPage(query, page)} navigate={navigate}>
          {content}
        </ReportLink>
      </Button>
    );
  };
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p
        ref={showingRef}
        tabIndex={-1}
        className="text-body-5 text-neutral-3 tabular-nums outline-none"
      >
        {showingText(result.page, result.pageSize, result.total)}
      </p>
      {result.pageCount > 1 ? (
        <div className="flex items-center gap-2">
          {pageLink(result.page - 1, 'Previous', result.page <= 1)}
          <span className="text-body-5 text-neutral-2 tabular-nums">
            {pageText(result.page, result.pageCount)}
          </span>
          {pageLink(result.page + 1, 'Next', result.page >= result.pageCount)}
        </div>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ the page

export interface ReportViewProps {
  /** What the address asks for; the result may still be the previous one while it loads. */
  query: EarningsReportQuery;
  result: EarningsReport | null;
  today: IsoDate;
  navigate: Navigate;
  /** A range, filter or sort is loading over the rows shown. */
  busy: boolean;
  /** A page change is loading: skeleton rows. */
  skeleton: boolean;
  failed: boolean;
  onRetry: () => void;
  csv: { pending: boolean; error: string | null; onPress: () => void };
  showingRef?: React.Ref<HTMLParagraphElement>;
  /** Stories: the custom dates or the phone's range sheet open at once. */
  initialCustomOpen?: boolean;
  initialSheetOpen?: boolean;
}

export function ReportView({
  query,
  result,
  today,
  navigate,
  busy,
  skeleton,
  failed,
  onRetry,
  csv,
  showingRef,
  initialCustomOpen = false,
  initialSheetOpen = false,
}: ReportViewProps) {
  const csvReasonId = useId();
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
            onClick={onRetry}
          >
            {REPORT_COPY.tryAgain}
          </Button>
        }
      >
        {REPORT_COPY.failed}
      </FormAlert>
    );
  } else if (result && result.total === 0 && !skeleton) {
    results = hasReportFilters(result.query) ? (
      <div className="rounded-2xl border border-neutral-6 bg-white px-4 py-10">
        <EmptyState
          title={REPORT_COPY.noMatchTitle}
          description={REPORT_COPY.noMatch}
          action={
            <Button asChild variant="outline" size="touch">
              <ReportLink query={withoutFilters(query)} navigate={navigate}>
                {REPORT_COPY.clearFilters}
              </ReportLink>
            </Button>
          }
        />
      </div>
    ) : (
      <div className="rounded-2xl border border-neutral-6 bg-white px-4 py-10">
        <EmptyState
          illustration="noData"
          illustrationSize="compact"
          title={REPORT_COPY.emptyTitle}
          description={emptyRangeText(result.range.from, result.range.to)}
          action={
            <Button asChild variant="outline" size="touch">
              <ReportLink query={withPreset(query, 'last-month', today)} navigate={navigate}>
                {REPORT_COPY.showLastMonth}
              </ReportLink>
            </Button>
          }
        />
      </div>
    );
  } else if (result) {
    results = (
      <>
        <div className="hidden lg:block">
          <ReportTable
            result={result}
            query={query}
            navigate={navigate}
            busy={busy}
            skeleton={skeleton}
          />
        </div>
        <div className="lg:hidden" aria-busy={busy || undefined}>
          <ReportCards result={result} skeleton={skeleton} />
        </div>
      </>
    );
  } else {
    // The first read for an address the server couldn't answer: skeleton rows (after 150 ms)
    // until it lands.
    results = (
      <ul aria-busy className="space-y-3">
        {Array.from({ length: skeleton ? 6 : 0 }, (_, index) => (
          <li key={index} className="h-16 rounded-2xl bg-neutral-7 motion-safe:animate-skeleton" />
        ))}
      </ul>
    );
  }

  return (
    <div className="space-y-4 px-4 pt-4 pb-10 lg:px-6">
      <div className="hidden md:block">
        <RangeLinks
          query={query}
          today={today}
          navigate={navigate}
          initialCustomOpen={initialCustomOpen}
        />
      </div>
      <div className="md:hidden">
        <RangeSheet
          query={query}
          today={today}
          navigate={navigate}
          initialOpen={initialSheetOpen}
        />
      </div>
      <div>
        <p className="text-body-5 text-neutral-3 tabular-nums">
          {rangeCaption(query.from, query.to)}
        </p>
        {result?.totalsCoverDemoOnly ? (
          <p className="text-body-5 text-neutral-3">{REPORT_COPY.demoTotals}</p>
        ) : null}
      </div>
      {result ? <SummaryTiles summary={result.summary} /> : null}
      <div className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <SearchField query={query} navigate={navigate} />
          <div className="hidden md:block">
            <FilterLinks query={query} navigate={navigate} />
          </div>
          <div className="w-full md:hidden">
            <FilterSelect query={query} navigate={navigate} />
          </div>
          <div className="w-full md:ml-auto md:w-auto">
            <CsvButton
              label={REPORT_COPY.csv}
              srSuffix={csvNameSuffix(query.from, query.to)}
              pending={csv.pending}
              onPress={csv.onPress}
              reasonId={csvReasonId}
              className="w-full md:w-auto"
            />
          </div>
        </div>
        {csv.error ? (
          <FormAlert id={csvReasonId} variant="error">
            {csv.error}
          </FormAlert>
        ) : null}
      </div>
      <div>{results}</div>
      {failed || !result ? null : (
        <Pager result={result} query={query} navigate={navigate} showingRef={showingRef} />
      )}
    </div>
  );
}
