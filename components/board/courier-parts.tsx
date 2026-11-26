'use client';

import {
  Bike,
  Car,
  Check,
  CircleSlash,
  Clock,
  DoorClosed,
  Hourglass,
  LockKeyhole,
  type LucideIcon,
  MapPinOff,
  MessageCircleWarning,
  Motorbike,
  Phone,
  Scooter,
  Search,
  Send,
  TriangleAlert,
  WifiOff,
} from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useRef } from 'react';
import type { DeliveryLine } from '@/server/modules/tracking/schema';
import type {
  BoardCourier,
  CourierState,
  CourierTone,
  CouriersCount,
  OfferRow,
  StaffCourierSection,
} from '@/server/modules/delivery/schema';
import {
  acceptedAt,
  couriersChipText,
  courierLineText,
  type OutcomeLook,
  offerRowDetails,
  offersListLabel,
  outcomeLook,
  outcomeText,
} from '@/lib/board/courier-text';
import { boardClock, clockWithSeconds, HIDDEN_FOR_DEMO } from '@/lib/board/text';
import { deliveryLineSpoken } from '@/lib/board/tracking-text';
import { useMotion } from '@/lib/motion';
import { isSitePath } from '@/lib/navigation';
import { cn } from '@/lib/utils';

/*
 * The courier on the staff side (F7 design 2.1 to 2.4): the line on Ready and Out for delivery
 * cards (16 px at every width, its own tone border, never a live region), the couriers chip,
 * and the detail's courier section with the offers list. KITCHEN gets the line and the short
 * name only; the demo admin sees masked names and no phones.
 */

const TONES: Record<CourierTone, { box: string; icon: string }> = {
  neutral: { box: 'border-l-neutral-5 bg-neutral-7', icon: 'text-neutral-3' },
  positive: { box: 'border-l-brand-strong bg-brand-soft', icon: 'text-brand-strong' },
  amber: { box: 'border-l-warning-strong bg-tag-6-bg', icon: 'text-warning-strong' },
  red: { box: 'border-l-destructive bg-tag-4-bg', icon: 'text-destructive' },
};

/** The vehicle's icon for an assigned courier (D19), by the first word of its words. */
const VEHICLE_ICONS: Record<string, LucideIcon> = {
  Bicycle: Bike,
  Scooter,
  Motorbike,
  Car,
};
const vehicleKey = (vehicleWords: string | null) => vehicleWords?.split(' ')[0] ?? 'Scooter';

const STATE_ICONS: Record<CourierState, LucideIcon> = {
  starting: Search,
  offered: Send,
  between: Search,
  staffOffered: Send,
  assigned: Scooter,
  assignedStale: MapPinOff,
  escalated: TriangleAlert,
  nobodyOnline: TriangleAlert,
  notLooking: CircleSlash,
};

export function CourierLine({
  courier,
  now,
  orderStatus = 'READY',
  className,
}: {
  courier: BoardCourier;
  /** The board's server time. */
  now: Date;
  orderStatus?: string;
  className?: string;
}) {
  const ref = useRef<HTMLParagraphElement>(null);
  const line = courierLineText(courier, now, orderStatus);
  const tone = TONES[line.tone];
  const Icon =
    line.state === 'assigned'
      ? (VEHICLE_ICONS[vehicleKey(courier.vehicleWords)] ?? Scooter)
      : STATE_ICONS[line.state];

  // A new state crossfades its tone (150 ms); the seconds swap without motion.
  useMotion(
    (motion) => {
      if (!ref.current || motion.reduced) return;
      motion.from(ref.current, { opacity: 0.4, duration: 0.15, ease: 'power2.out' });
    },
    { scope: ref, dependencies: [line.state, line.tone] },
  );

  if (!line.words) return null;
  return (
    <p
      ref={ref}
      data-tone={line.tone}
      data-courier-state={line.state}
      className={cn(
        'mt-2 flex items-start gap-2 rounded-lg border-l-4 px-2.5 py-2 text-body-4 text-neutral-1 [overflow-wrap:anywhere]',
        tone.box,
        className,
      )}
    >
      <Icon className={cn('mt-1 size-4 shrink-0', tone.icon)} aria-hidden />
      <span aria-hidden>
        {line.words}
        {line.seconds ? (
          <>
            {' · '}
            <span className="tabular-nums">{line.seconds}</span>
          </>
        ) : null}
      </span>
      <span className="sr-only">{line.spoken}</span>
    </p>
  );
}

const LINE_ICONS: Record<DeliveryLine['icon'], LucideIcon | null> = {
  truck: null,
  pin: null,
  'signal-off': MapPinOff,
  door: DoorClosed,
  hourglass: Hourglass,
  lock: LockKeyhole,
  alert: MessageCircleWarning,
};

/**
 * F8 (design 3.8): the Out-for-delivery line, resolved on the server (state, words, tone),
 * with F7's anatomy. Never a live region; the spoken form is built from parts.
 */
export function DeliveryLineView({
  line,
  vehicleWords,
  className,
}: {
  line: DeliveryLine;
  vehicleWords: string | null;
  className?: string;
}) {
  const ref = useRef<HTMLParagraphElement>(null);
  const tone = TONES[line.tone];
  const Icon = LINE_ICONS[line.icon] ?? VEHICLE_ICONS[vehicleKey(vehicleWords)] ?? Scooter;
  useMotion(
    (motion) => {
      if (!ref.current || motion.reduced) return;
      motion.from(ref.current, { opacity: 0.4, duration: 0.15, ease: 'power2.out' });
    },
    { scope: ref, dependencies: [line.state, line.tone] },
  );
  return (
    <p
      ref={ref}
      data-tone={line.tone}
      data-delivery-state={line.state}
      className={cn(
        'mt-2 flex items-start gap-2 rounded-lg border-l-4 px-2.5 py-2 text-body-4 text-neutral-1 [overflow-wrap:anywhere]',
        tone.box,
        className,
      )}
    >
      <Icon className={cn('mt-1 size-4 shrink-0', tone.icon)} aria-hidden />
      <span aria-hidden>{line.words}</span>
      <span className="sr-only">{deliveryLineSpoken(line)}</span>
    </p>
  );
}

const CHIP =
  'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-body-5 font-medium whitespace-nowrap text-neutral-1';

/** "Couriers · 4 online · 2 free" (A35): never names anyone, never announced. */
export function CouriersChip({ count, className }: { count: CouriersCount; className?: string }) {
  const words = couriersChipText(count);
  const none = count.online === 0;
  return (
    <span
      data-couriers-chip=""
      className={cn(CHIP, none ? 'bg-tag-6-bg' : 'bg-neutral-7', className)}
    >
      {none ? (
        <TriangleAlert className="size-3.5 text-warning-strong" aria-hidden />
      ) : (
        <Bike className="size-3.5 text-neutral-3" aria-hidden />
      )}
      {words.text === words.spoken ? (
        words.text
      ) : (
        <>
          <span aria-hidden>{words.text}</span>
          <span className="sr-only">{words.spoken}</span>
        </>
      )}
    </span>
  );
}

// ------------------------------------------------------------------ the offers list (2.4.1)

const OUTCOME: Record<OutcomeLook, { box: string; icon: LucideIcon | null; iconClass: string }> = {
  accepted: { box: 'bg-brand-soft', icon: Check, iconClass: 'text-brand-strong' },
  plain: { box: 'bg-neutral-7', icon: null, iconClass: '' },
  missed: { box: 'bg-tag-6-bg', icon: Clock, iconClass: 'text-warning-strong' },
  unseen: { box: 'bg-neutral-7', icon: WifiOff, iconClass: 'text-neutral-3' },
  open: { box: 'bg-tag-3-bg', icon: Send, iconClass: 'text-tag-3' },
};

export function OffersList({
  orderNumber,
  offers,
  openExpiresAt,
  now,
  timeZone,
  level,
}: {
  orderNumber: string;
  offers: readonly OfferRow[];
  /** The open offer's end, from the courier line, for "Open · 24 s left". */
  openExpiresAt: string | null;
  now: Date;
  timeZone: string;
  level: 'h3' | 'h4';
}) {
  const Heading = level;
  return (
    <div className="mt-5">
      <Heading className="flex items-center gap-2 text-body-4 font-semibold text-neutral-1">
        Offers
        <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-md bg-neutral-7 px-1.5 text-caption font-semibold tabular-nums">
          {offers.length}
        </span>
      </Heading>
      {offers.length === 0 ? (
        <p className="mt-2 text-body-5 text-neutral-3">No offers yet.</p>
      ) : (
        <ol aria-label={offersListLabel(orderNumber)} className="mt-2">
          {offers.map((row) => {
            const look = OUTCOME[outcomeLook(row.ending, row.outcomeWords)];
            const OutcomeIcon = look.icon;
            return (
              <li
                key={row.offerId}
                className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 border-t border-neutral-6 py-3 first:border-t-0 sm:grid-cols-[auto_minmax(0,1fr)_auto]"
              >
                <span className="text-body-5 text-neutral-3 tabular-nums">
                  {clockWithSeconds(row.at, timeZone)}
                </span>
                <div className="min-w-0">
                  <p className="text-body-4 font-medium text-neutral-1 [overflow-wrap:anywhere]">
                    {row.partner.name ?? 'A courier'}
                  </p>
                  <p className="text-body-5 text-neutral-3 [overflow-wrap:anywhere]">
                    {offerRowDetails(row, timeZone)}
                  </p>
                </div>
                <span
                  className={cn(
                    'col-start-2 mt-1.5 inline-flex h-7 items-center gap-1.5 justify-self-start rounded-md px-2 text-body-5 font-medium whitespace-nowrap text-neutral-1 sm:col-start-auto sm:mt-0',
                    look.box,
                  )}
                >
                  {OutcomeIcon ? (
                    <OutcomeIcon className={cn('size-3.5', look.iconClass)} aria-hidden />
                  ) : null}
                  <span className="tabular-nums">
                    {outcomeText(row.ending, row.outcomeWords, openExpiresAt, now)}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ the courier section (2.4)

function partnerHref(id: string): Route {
  const href = `/admin/partners/${id}`;
  return isSitePath(href) ? href : '/admin/partners';
}

export function CourierSection({
  section,
  orderNumber,
  orderStatus,
  now,
  timeZone,
  level,
  actions,
  tracking,
  deliveryLine = null,
}: {
  section: StaffCourierSection;
  orderNumber: string;
  orderStatus: string;
  now: Date;
  timeZone: string;
  /** h3 in the panel, h2 on the page (design 2.4). */
  level: 'h2' | 'h3';
  /** The action row (assign, take off, choose another, find a courier), SUPPORT and ADMIN. */
  actions?: React.ReactNode;
  /** F8 (A53): the small map, the estimate and the steps, after the line. */
  tracking?: React.ReactNode;
  /** F8 (design 3.12): on its way, the card's A48 line replaces F7's. */
  deliveryLine?: DeliveryLine | null;
}) {
  const Heading = level;
  const courier = section.courier;
  const showLine = courier.words !== '';
  return (
    <section aria-labelledby="courier-heading" data-courier-section="">
      <Heading id="courier-heading" className="text-body-3 font-semibold text-neutral-1">
        Courier
      </Heading>
      <div className="mt-3">
        {deliveryLine ? (
          <DeliveryLineView
            line={deliveryLine}
            vehicleWords={courier.vehicleWords}
            className="mt-0"
          />
        ) : showLine ? (
          <CourierLine courier={courier} now={now} orderStatus={orderStatus} className="mt-0" />
        ) : null}
        {tracking}
        {section.view === 'kitchen' ? (
          courier.shortName && courier.vehicleWords ? (
            <p className="mt-3 text-body-4 text-neutral-1">
              {courier.shortName} · {courier.vehicleWords.replace(' · ', ' ')}
            </p>
          ) : null
        ) : (
          <FullCourier
            section={section}
            orderNumber={orderNumber}
            now={now}
            timeZone={timeZone}
            level={level === 'h2' ? 'h3' : 'h4'}
            actions={actions}
          />
        )}
      </div>
    </section>
  );
}

function FullCourier({
  section,
  orderNumber,
  now,
  timeZone,
  level,
  actions,
}: {
  section: Extract<StaffCourierSection, { view: 'full' }>;
  orderNumber: string;
  now: Date;
  timeZone: string;
  level: 'h3' | 'h4';
  actions?: React.ReactNode;
}) {
  const assigned = section.assigned;
  const accepted = section.offers.findLast((row) => row.ending === 'accepted');
  return (
    <>
      {assigned ? (
        <dl className="mt-3 grid grid-cols-[7rem_minmax(0,1fr)] gap-x-4 gap-y-2 text-body-4">
          <dt className="text-neutral-3">Courier</dt>
          <dd className="min-w-0 text-neutral-1 [overflow-wrap:anywhere]">
            {assigned.partnerId ? (
              <Link href={partnerHref(assigned.partnerId)} className="underline underline-offset-4">
                {assigned.name}
              </Link>
            ) : (
              assigned.name
            )}
          </dd>
          <dt className="text-neutral-3">Vehicle</dt>
          <dd className="text-neutral-1">{assigned.vehicleWords}</dd>
          <dt className="text-neutral-3">Accepted</dt>
          <dd className="text-neutral-1 tabular-nums">
            {accepted
              ? `${boardClock(acceptedAt(accepted), timeZone)} · ${assigned.acceptedFromWords}`
              : assigned.acceptedFromWords}
          </dd>
          {assigned.phone ? (
            <>
              <dt className="text-neutral-3">Phone</dt>
              <dd>
                <a
                  href={`tel:${assigned.phone.e164}`}
                  aria-label={`Call ${assigned.name}, ${assigned.phone.display}`}
                  className="inline-flex h-11 items-center gap-2 text-neutral-1 underline underline-offset-4"
                >
                  <Phone className="size-4" aria-hidden />
                  {assigned.phone.display}
                </a>
              </dd>
            </>
          ) : null}
        </dl>
      ) : null}
      {section.masked ? (
        <p className="mt-2 text-caption text-neutral-3">{HIDDEN_FOR_DEMO}</p>
      ) : null}
      {actions}
      <OffersList
        orderNumber={orderNumber}
        offers={section.offers}
        openExpiresAt={section.courier.expiresAt}
        now={now}
        timeZone={timeZone}
        level={level}
      />
    </>
  );
}
