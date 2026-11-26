'use client';

import { createColumnHelper, tableFeatures, useTable } from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { type ReactNode, useId, useMemo, useState } from 'react';
import type { LedgerRow, PartnerEarningsPage } from '@/server/modules/earnings/schema';
import { CsvButton, useCsvDownload } from '@/components/admin/csv-button';
import { FormAlert } from '@/components/forms/form-alert';
import { BLOCKED_BUTTON_CLASS } from '@/components/forms/submit-button';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  balanceText,
  entriesCsvSuffix,
  entriesFileName,
  ledgerCaption,
  ledgerDetails,
  ledgerEntryWords,
  ledgerRecordedBy,
  ledgerWhen,
  rangeProblems,
  showingEntries,
  signedPrice,
} from '@/lib/admin/earnings-text';
import { cn } from '@/lib/utils';
import { BusyBar } from './partners-list';

/*
 * A partner's ledger for staff (F9 design 3.5): every entry on its own, newest first, with the
 * balance after it and who recorded it. The range and page live in the address. Sorting is by
 * time only, on the server. From 1024 px a table; below, one card per entry.
 */

export interface LedgerParams {
  from: string;
  to: string;
  page: number;
  dir: 'asc' | 'desc';
}

const orderHref = (orderId: string) => `/admin/orders/${orderId}` as const;

function EntryWords({ row }: { row: LedgerRow }) {
  const details = ledgerDetails(row);
  return (
    <>
      <span className="font-medium">{ledgerEntryWords(row)}</span>
      {details.map((line) => (
        <span
          key={line}
          className="block text-body-5 whitespace-pre-wrap text-neutral-3 [overflow-wrap:anywhere]"
        >
          {line}
        </span>
      ))}
    </>
  );
}

function OrderCell({ row }: { row: LedgerRow }) {
  if (!row.orderId || !row.orderNumber) {
    return (
      <>
        <span aria-hidden>—</span>
        <span className="sr-only">No order</span>
      </>
    );
  }
  return (
    <Link
      href={orderHref(row.orderId)}
      className="inline-flex min-h-11 items-center underline underline-offset-4 tabular-nums hover:text-neutral-2 lg:min-h-0"
    >
      {row.orderNumber}
    </Link>
  );
}

const features = tableFeatures({});
const helper = createColumnHelper<typeof features, LedgerRow>();

interface Spec {
  id: string;
  header: string;
  className: string;
  numeric?: boolean;
  cell: (row: LedgerRow) => ReactNode;
}

function specsFor(timeZone: string): Spec[] {
  return [
    {
      id: 'when',
      header: 'When',
      className: 'w-[15%]',
      cell: (row) => <span className="tabular-nums">{ledgerWhen(row.at, timeZone)}</span>,
    },
    { id: 'entry', header: 'Entry', className: 'w-[31%]', cell: (row) => <EntryWords row={row} /> },
    { id: 'order', header: 'Order', className: 'w-[9%]', cell: (row) => <OrderCell row={row} /> },
    {
      id: 'amount',
      header: 'Amount',
      className: 'w-[11%]',
      numeric: true,
      cell: (row) => signedPrice(row.amountCents),
    },
    {
      id: 'balance',
      header: 'Balance',
      className: 'w-[12%]',
      numeric: true,
      cell: (row) => balanceText(row.balanceAfterCents),
    },
    {
      id: 'recorded',
      header: 'Recorded by',
      className: 'w-[22%]',
      cell: (row) => ledgerRecordedBy(row),
    },
  ];
}

function LedgerTableView({
  page,
  rows,
  caption,
  timeZone,
  busy,
  onSort,
}: {
  page: PartnerEarningsPage;
  rows: readonly LedgerRow[];
  caption: string;
  timeZone: string;
  busy: boolean;
  onSort: () => void;
}) {
  const specs = useMemo(() => specsFor(timeZone), [timeZone]);
  const columns = useMemo(
    () =>
      helper.columns(
        specs.map((spec) =>
          helper.display({
            id: spec.id,
            header: spec.header,
            cell: (info) => spec.cell(info.row.original),
          }),
        ),
      ),
    [specs],
  );
  const table = useTable({ features, columns, data: [...rows], getRowId: (row) => row.id });
  const specOf = (id: string) => specs.find((spec) => spec.id === id);
  const dir = page.entries.dir;
  const SortIcon = dir === 'asc' ? ArrowUp : ArrowDown;

  return (
    <div className="relative overflow-hidden rounded-2xl border border-neutral-6 bg-white">
      {busy ? <BusyBar /> : null}
      <table className="w-full table-fixed" aria-busy={busy || undefined}>
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-neutral-7">
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => {
                const spec = specOf(header.column.id);
                if (!spec) return null;
                const sortable = spec.id === 'when';
                return (
                  <th
                    key={header.id}
                    scope="col"
                    aria-sort={sortable ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}
                    className={cn(
                      'h-11 px-3 text-body-5 font-medium text-neutral-3',
                      spec.numeric ? 'text-right' : 'text-left',
                      spec.className,
                    )}
                  >
                    {sortable ? (
                      <button
                        type="button"
                        onClick={onSort}
                        className="-mx-3 inline-flex h-11 items-center gap-1.5 px-3 hover:text-neutral-1 focus-visible:-outline-offset-2"
                      >
                        {spec.header}
                        <SortIcon className="size-3.5" aria-hidden />
                      </button>
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
          {rows.length === 0 ? (
            <tr className="border-t border-neutral-6">
              <td colSpan={specs.length} className="py-10 text-center text-body-5 text-neutral-3">
                No entries in this range.
              </td>
            </tr>
          ) : (
            table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="border-t border-neutral-6">
                {row.getAllCells().map((cell) => {
                  const spec = specOf(cell.column.id);
                  return (
                    // A table cell, not a control.
                    // oxlint-disable-next-line jsx-a11y/control-has-associated-label
                    <td
                      key={cell.id}
                      className={cn(
                        'px-3 py-3 align-top text-body-5 text-neutral-1 [overflow-wrap:anywhere]',
                        spec?.numeric && 'text-right tabular-nums',
                        spec?.className,
                      )}
                    >
                      <table.FlexRender cell={cell} />
                    </td>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function LedgerCards({ rows, timeZone }: { rows: readonly LedgerRow[]; timeZone: string }) {
  if (rows.length === 0) {
    return (
      <p className="rounded-2xl border border-neutral-6 bg-white py-10 text-center text-body-5 text-neutral-3">
        No entries in this range.
      </p>
    );
  }
  return (
    <ul className="space-y-3">
      {rows.map((row) => {
        const details = ledgerDetails(row);
        return (
          <li key={row.id} className="rounded-2xl border border-neutral-6 bg-white p-4">
            <div className="flex items-start justify-between gap-3 text-body-4 text-neutral-1">
              <span className="min-w-0 font-medium [overflow-wrap:anywhere]">
                {ledgerEntryWords(row)}
              </span>
              <span className="shrink-0 font-semibold tabular-nums">
                {signedPrice(row.amountCents)}
              </span>
            </div>
            <p className="mt-1 text-body-5 text-neutral-3 tabular-nums">
              {ledgerWhen(row.at, timeZone)}
              {row.orderId && row.orderNumber ? (
                <>
                  {' · '}
                  <Link
                    href={orderHref(row.orderId)}
                    className="inline-flex min-h-11 items-center underline underline-offset-4"
                  >
                    Order {row.orderNumber}
                  </Link>
                </>
              ) : null}
              {' · '}
              {ledgerRecordedBy(row)}
            </p>
            <p className="text-body-5 text-neutral-2 tabular-nums">
              Balance {balanceText(row.balanceAfterCents)}
            </p>
            {details.map((line) => (
              <p
                key={line}
                className="mt-1 text-body-5 whitespace-pre-wrap text-neutral-3 [overflow-wrap:anywhere]"
              >
                {line}
              </p>
            ))}
          </li>
        );
      })}
    </ul>
  );
}

function RangeForm({
  params,
  week,
  onShow,
}: {
  params: LedgerParams;
  week: { start: string; end: string };
  onShow: (range: { from: string; to: string }) => void;
}) {
  const id = useId();
  const [from, setFrom] = useState(params.from);
  const [to, setTo] = useState(params.to);
  const [problems, setProblems] = useState<{ from?: string; to?: string }>({});
  // The range changed elsewhere ("This week", a page from the report): the inputs follow.
  const [last, setLast] = useState(`${params.from}|${params.to}`);
  if (`${params.from}|${params.to}` !== last) {
    setLast(`${params.from}|${params.to}`);
    setFrom(params.from);
    setTo(params.to);
    setProblems({});
  }
  const isThisWeek = params.from === week.start && params.to === week.end;
  return (
    <form
      noValidate
      className="flex flex-wrap items-start gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const found = rangeProblems(from, to);
        setProblems(found);
        if (found.from || found.to) {
          requestAnimationFrame(() =>
            document.getElementById(found.from ? `${id}-from` : `${id}-to`)?.focus(),
          );
          return;
        }
        onShow({ from, to });
      }}
    >
      {(['from', 'to'] as const).map((key) => (
        <div key={key}>
          <label htmlFor={`${id}-${key}`} className="block text-body-5 font-medium text-neutral-2">
            {key === 'from' ? 'From' : 'To'}
          </label>
          <Input
            id={`${id}-${key}`}
            type="date"
            value={key === 'from' ? from : to}
            onChange={(event) => (key === 'from' ? setFrom : setTo)(event.target.value)}
            aria-invalid={problems[key] ? true : undefined}
            aria-describedby={problems[key] ? `${id}-${key}-error` : undefined}
            className="mt-1.5 h-11 w-auto min-w-40 px-3 tabular-nums"
          />
          <FieldError id={`${id}-${key}-error`}>{problems[key]}</FieldError>
        </div>
      ))}
      <div className="flex items-end gap-2 self-end pb-0">
        <Button type="submit" variant="outline" size="touch" className="bg-white">
          Show
        </Button>
        {isThisWeek ? null : (
          <Button
            type="button"
            variant="ghost"
            size="touch"
            className="text-neutral-1 underline underline-offset-4"
            onClick={() => onShow({ from: week.start, to: week.end })}
          >
            This week
          </Button>
        )}
      </div>
    </form>
  );
}

function Pager({
  page,
  onPage,
}: {
  page: PartnerEarningsPage['entries'];
  onPage: (page: number) => void;
}) {
  if (page.total === 0) return null;
  const button = (target: number, label: 'Previous' | 'Next', end: boolean) => (
    <Button
      type="button"
      variant="outline"
      size="touch"
      aria-disabled={end || undefined}
      className={end ? BLOCKED_BUTTON_CLASS : 'bg-white'}
      onClick={() => {
        if (!end) onPage(target);
      }}
    >
      {label === 'Previous' ? <ChevronLeft className="size-4" aria-hidden /> : null}
      {label}
      {label === 'Next' ? <ChevronRight className="size-4" aria-hidden /> : null}
    </Button>
  );
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <p className="text-body-5 text-neutral-3 tabular-nums">
        {showingEntries(page.page, page.pageSize, page.total)}
      </p>
      {page.pageCount > 1 ? (
        <div className="flex items-center gap-2">
          {button(page.page - 1, 'Previous', page.page <= 1)}
          <span className="text-body-5 text-neutral-2 tabular-nums">
            Page {page.page} of {page.pageCount}
          </span>
          {button(page.page + 1, 'Next', page.page >= page.pageCount)}
        </div>
      ) : null}
    </div>
  );
}

/** The Entries block: range, CSV for ADMIN, the table or cards, the pager. */
export function LedgerSection({
  page,
  params,
  timeZone,
  busy,
  onParams,
}: {
  page: PartnerEarningsPage;
  params: LedgerParams;
  timeZone: string;
  busy: boolean;
  onParams: (next: LedgerParams) => void;
}) {
  const titleId = useId();
  const range = page.range;
  const csv = useCsvDownload({
    endpoint: `/admin/partners/${page.partnerId}/earnings/export`,
    body: () => ({ from: range.from, to: range.to }),
    fallbackFileName: entriesFileName(range.from, range.to),
  });
  const caption = ledgerCaption(page.name, range, page.entries.dir, page.entries.total);
  return (
    <section aria-labelledby={titleId}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h3 id={titleId} className="w-full text-body-4 font-semibold text-neutral-1">
          Entries
        </h3>
        <RangeForm
          params={params}
          week={{ start: page.week.start, end: page.week.end }}
          onShow={(next) => onParams({ ...params, ...next, page: 1 })}
        />
        {page.actions.csv ? (
          <CsvButton
            label="Download entries (CSV)"
            srSuffix={entriesCsvSuffix(page.name, range.from, range.to)}
            pending={csv.pending}
            onPress={() => void csv.download()}
          />
        ) : null}
      </div>
      {csv.error ? (
        <FormAlert variant="error" className="mt-3">
          {csv.error}
        </FormAlert>
      ) : null}
      <div className="mt-4 hidden lg:block">
        <LedgerTableView
          page={page}
          rows={page.entries.rows}
          caption={caption}
          timeZone={timeZone}
          busy={busy}
          onSort={() =>
            onParams({ ...params, dir: params.dir === 'desc' ? 'asc' : 'desc', page: 1 })
          }
        />
      </div>
      <div className="mt-4 lg:hidden" aria-busy={busy || undefined}>
        <p className="sr-only">{caption}</p>
        <LedgerCards rows={page.entries.rows} timeZone={timeZone} />
      </div>
      <Pager page={page.entries} onPage={(next) => onParams({ ...params, page: next })} />
    </section>
  );
}
