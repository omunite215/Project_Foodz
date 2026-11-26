'use client';

import { CircleCheck, Undo2 } from 'lucide-react';
import { Fragment } from 'react';
import type { EarningsDeliveryDetail, EarningsRow } from '@/server/modules/earnings/schema';
import { Button } from '@/components/ui/button';
import {
  DELIVERY_NOT_FOUND,
  deliveryPayRows,
  deliverySubtitle,
  endedWords,
  STEPS_OFFLINE,
  stepWords,
} from '@/lib/partner/earnings-text';
import { useOnline } from '@/lib/use-online';
import { DetailRows } from '../shell';
import { EarningsReadError, useDeliveryDetail } from './earnings-data';
import { PartnerSheet } from './partner-sheet';
import { useSkeleton } from './earnings-list';

/*
 * A delivery's sheet (F9 design 1.8): opens at once with the row's own figures; the steps, the
 * distance and how it ended fill in from the detail read. Never the customer's name, address,
 * phone, instructions or route (P55.2).
 */

/** The demo partner's fixed practice steps, from the row's time (P62.1). */
function practiceDetail(row: EarningsRow, date: string): EarningsDeliveryDetail {
  const at = Date.parse(row.at);
  const minutes = (value: number) => new Date(at - value * 60_000).toISOString();
  return {
    deliveryId: row.id,
    orderNumber: row.orderNumber ?? '',
    date,
    areaWords: row.areaWords,
    distanceKm: 1.4,
    steps: [
      { kind: 'accepted', at: minutes(14) },
      { kind: 'pickedUp', at: minutes(9) },
      { kind: 'delivered', at: row.at },
    ],
    feeCents: row.amountCents - (row.tipCents ?? 0),
    tipCents: row.tipCents ?? 0,
    tipPaid: (row.tipCents ?? 0) > 0,
    totalCents: row.amountCents,
    cashCents: null,
    how: 'demo',
    orderTipCents: row.tipCents ?? 0,
  };
}

export function DeliverySheet({
  open,
  onOpenChange,
  row,
  date,
  partnerId,
  timeZone,
  practice,
  returnFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: EarningsRow | null;
  /** The row's store date. */
  date: string;
  partnerId: string;
  timeZone: string;
  practice: boolean;
  returnFocus: () => void;
}) {
  const online = useOnline();
  const fetchable = open && row !== null && !practice && row.deliveryId !== null;
  const query = useDeliveryDetail(partnerId, fetchable ? row.deliveryId : null);
  const skeleton = useSkeleton(query.isPending && fetchable);
  if (!row) return null;

  const cancelled = row.kind === 'cancelledAfterPickup';
  const detail = practice ? practiceDetail(row, date) : query.data;
  const notFound = query.error instanceof EarningsReadError && query.error.status === 404;
  const payRows = deliveryPayRows(row, detail ?? null);

  let steps;
  if (detail) {
    steps = (
      <>
        <h3 className="mt-4 text-body-5 font-medium text-foreground">Steps</h3>
        <ol className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-body-4 text-strong tabular-nums">
          {detail.steps.map((step, index) => (
            <Fragment key={step.kind}>
              {index > 0 ? (
                <li aria-hidden className="text-muted-foreground">
                  ·
                </li>
              ) : null}
              <li>{stepWords(step, timeZone)}</li>
            </Fragment>
          ))}
        </ol>
      </>
    );
  } else if (notFound) {
    steps = <p className="mt-4 text-body-4 text-strong">{DELIVERY_NOT_FOUND}</p>;
  } else if (!online || query.isError) {
    steps = <p className="mt-4 text-body-5 text-muted-foreground">{STEPS_OFFLINE}</p>;
  } else {
    steps = (
      <div
        aria-hidden
        className={skeleton.show ? 'mt-4 space-y-2 motion-safe:animate-pulse' : 'invisible mt-4'}
      >
        <span className="block h-4 w-16 rounded bg-muted" />
        <span className="block h-5 w-full rounded bg-muted" />
      </div>
    );
  }

  const how = detail?.how ?? (cancelled ? 'cancelled-after-pickup' : null);
  return (
    <PartnerSheet
      open={open}
      onOpenChange={onOpenChange}
      title={`Order ${row.orderNumber ?? ''}`.trim()}
      returnFocus={returnFocus}
    >
      <p className="mt-1 text-body-5 text-muted-foreground tabular-nums">
        {deliverySubtitle({
          date,
          areaWords: detail?.areaWords ?? row.areaWords,
          distanceKm: detail?.distanceKm ?? null,
        })}
      </p>
      {steps}
      {notFound ? null : (
        <div className="mt-4">
          <DetailRows
            wideLabels
            rows={payRows.map((pay) => ({
              label: pay.label,
              value: pay.total ? (
                <b className="font-semibold tabular-nums">{pay.value}</b>
              ) : (
                <span className="tabular-nums">{pay.value}</span>
              ),
            }))}
          />
        </div>
      )}
      {how && !notFound ? (
        <p className="mt-4 flex gap-3 text-body-4 text-strong">
          {how === 'cancelled-after-pickup' ? (
            <Undo2 className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
          ) : (
            <CircleCheck className="mt-0.5 size-5 shrink-0 text-success-mark" aria-hidden />
          )}
          {endedWords(how, (detail?.orderTipCents ?? 0) > 0)}
        </p>
      ) : null}
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
