'use client';

import {
  Ban,
  CircleX,
  ClipboardCheck,
  CookingPot,
  CreditCard,
  Check,
  HandCoins,
  House,
  type LucideIcon,
  OctagonX,
  PackageCheck,
  Truck,
  Undo2,
  CircleDot,
  CircleSlash,
  RotateCcw,
  Search,
  Send,
  TriangleAlert,
  UserRoundCheck,
  UserRoundX,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { StaffTimelineEntry, StaffTimelineType } from '@/server/modules/board/schema';
import { Toggle } from '@/components/ui/toggle';
import { readSwitch, writeSwitch } from '@/lib/board/preferences';
import { boardClock, clockWithSeconds, timelineText } from '@/lib/board/text';
import { useMotion } from '@/lib/motion';
import { eventTimeText, sameStoreDay } from '@/lib/order-text';
import { cn } from '@/lib/utils';

/*
 * The staff timeline (F5 design 5.3, story B17): every event oldest first, who did it and when,
 * details and staff notes. "Show seconds" switches every time at once (D12) instead of a hover
 * target per entry. A new event fades in at the end; focus never moves.
 */

const DISCS: Record<StaffTimelineType, { icon: LucideIcon; className: string }> = {
  created: { icon: CreditCard, className: 'bg-neutral-4' },
  placed: { icon: Check, className: 'bg-brand-strong' },
  paid: { icon: Check, className: 'bg-brand-strong' },
  'payment-failed': { icon: CircleX, className: 'bg-destructive' },
  accepted: { icon: ClipboardCheck, className: 'bg-brand-strong' },
  preparing: { icon: CookingPot, className: 'bg-brand-strong' },
  ready: { icon: PackageCheck, className: 'bg-brand-strong' },
  undone: { icon: Undo2, className: 'bg-neutral-3' },
  'moved-back': { icon: Undo2, className: 'bg-neutral-3' },
  refused: { icon: OctagonX, className: 'bg-destructive' },
  cancelled: { icon: CircleX, className: 'bg-destructive' },
  expired: { icon: CircleX, className: 'bg-neutral-3' },
  refunded: { icon: HandCoins, className: 'bg-neutral-3' },
  'picked-up': { icon: Truck, className: 'bg-brand-strong' },
  delivered: { icon: House, className: 'bg-brand-strong' },
  revived: { icon: CircleDot, className: 'bg-neutral-3' },
  'late-payment': { icon: CreditCard, className: 'bg-neutral-3' },
  mismatch: { icon: CircleX, className: 'bg-destructive' },
  'dispute-opened': { icon: CircleX, className: 'bg-destructive' },
  'dispute-closed': { icon: CircleDot, className: 'bg-neutral-3' },
  'sold-out': { icon: Ban, className: 'bg-neutral-3' },
  courier: { icon: Truck, className: 'bg-neutral-3' },
};

/** F7 design 2.5: the courier milestones' discs. */
const COURIER_DISCS: Record<
  Extract<StaffTimelineEntry, { type: 'courier' }>['event'],
  { icon: LucideIcon; className: string }
> = {
  'search-started': { icon: Search, className: 'bg-neutral-4' },
  assigned: { icon: UserRoundCheck, className: 'bg-brand-strong' },
  'offered-by-staff': { icon: Send, className: 'bg-neutral-3' },
  'gave-back': { icon: Undo2, className: 'bg-warning-strong' },
  unassigned: { icon: UserRoundX, className: 'bg-neutral-3' },
  escalated: { icon: TriangleAlert, className: 'bg-destructive' },
  'search-stopped': { icon: CircleSlash, className: 'bg-neutral-4' },
  'search-restarted': { icon: RotateCcw, className: 'bg-neutral-3' },
};

/** One timeline row as drawn: a disc, the sentence, any details and text blocks, the time. */
export interface TimelineRowData {
  id: string;
  icon: LucideIcon;
  /** The disc's fill, a white icon on it. */
  discClassName: string;
  sentence: string;
  details?: string | null;
  /** Labelled text under the sentence: "Staff note:", "Message to the applicant:". */
  blocks?: readonly { label: string; text: string }[];
  /** ISO instant for `<time dateTime>`. */
  at: string;
  /** The time as shown. */
  time: string;
}

/**
 * One entry of a staff timeline (F5 design 5.3), shared with the partner application's history
 * (F6 design 8.8). A new entry fades in at the end; focus never moves.
 */
export function TimelineRow({
  row,
  last,
  fresh,
}: {
  row: TimelineRowData;
  last: boolean;
  fresh: boolean;
}) {
  const ref = useRef<HTMLLIElement>(null);
  const Icon = row.icon;

  useMotion(
    (motion) => {
      if (!fresh || !ref.current) return;
      motion.from(ref.current, { y: 4, opacity: 0, duration: motion.reduced ? 0.12 : 0.2 });
    },
    { scope: ref },
  );

  return (
    <li
      ref={ref}
      className="relative grid grid-cols-[1.5rem_minmax(0,1fr)_auto] gap-x-3 pb-5 last:pb-0"
    >
      <span
        aria-hidden
        className={cn(
          'relative z-10 flex size-6 items-center justify-center rounded-full',
          row.discClassName,
        )}
      >
        <Icon className="size-3.5 text-white" strokeWidth={3} />
      </span>
      {last ? null : (
        <span aria-hidden className="absolute top-7 bottom-0 left-3 w-px bg-neutral-6" />
      )}
      <div className="min-w-0">
        <p className="text-body-5 font-medium text-neutral-1 [overflow-wrap:anywhere]">
          {row.sentence}
        </p>
        {row.details ? <p className="mt-0.5 text-body-5 text-neutral-3">{row.details}</p> : null}
        {row.blocks?.map((block) => (
          <p
            key={block.label}
            className="mt-1.5 rounded-md bg-neutral-7 px-2.5 py-1.5 text-body-5 whitespace-pre-wrap text-neutral-1 [overflow-wrap:anywhere]"
          >
            <span className="font-medium">{block.label}</span> {block.text}
          </p>
        ))}
      </div>
      <time dateTime={row.at} className="text-body-5 whitespace-nowrap text-neutral-3 tabular-nums">
        {row.time}
      </time>
    </li>
  );
}

function Entry({
  entry,
  seconds,
  now,
  timeZone,
  fresh,
  last,
}: {
  entry: StaffTimelineEntry;
  last: boolean;
  seconds: boolean;
  now: Date;
  timeZone: string;
  fresh: boolean;
}) {
  const disc = entry.type === 'courier' ? COURIER_DISCS[entry.event] : DISCS[entry.type];
  const text = timelineText(entry);
  // By the day itself: "6 pm" has no colon, so a colon test took it for another day (review S3).
  const sameDay = sameStoreDay(entry.at, now, timeZone);
  const clock = seconds ? clockWithSeconds(entry.at, timeZone) : boardClock(entry.at, timeZone);
  const time = sameDay ? clock : `${eventTimeText(entry.at, now, timeZone)}, ${clock}`;

  return (
    <TimelineRow
      last={last}
      fresh={fresh}
      row={{
        id: entry.id,
        icon: disc.icon,
        discClassName: disc.className,
        sentence: text.sentence,
        details: text.details,
        blocks: text.note ? [{ label: 'Staff note:', text: text.note }] : [],
        at: entry.at,
        time,
      }}
    />
  );
}

export function StaffTimeline({
  entries,
  now,
  timeZone,
  headingLevel = 'h3',
}: {
  entries: readonly StaffTimelineEntry[];
  now: Date;
  timeZone: string;
  headingLevel?: 'h2' | 'h3';
}) {
  const Heading = headingLevel;
  const [seconds, setSeconds] = useState(false);
  // Entries present when the timeline opens don't fade in; later ones do.
  const [firstIds] = useState(() => new Set(entries.map((entry) => entry.id)));

  useEffect(() => {
    const timer = setTimeout(() => setSeconds(readSwitch('showSeconds') ?? false), 0);
    return () => clearTimeout(timer);
  }, []);

  return (
    <section aria-labelledby="timeline-heading">
      <div className="flex items-center justify-between gap-3">
        <Heading id="timeline-heading" className="text-body-3 font-semibold text-neutral-1">
          Timeline
        </Heading>
        <Toggle
          pressed={seconds}
          onPressedChange={(next) => {
            setSeconds(next);
            writeSwitch('showSeconds', next);
          }}
          className="h-11 rounded-lg border border-input px-3 text-body-5 font-medium text-neutral-2 data-[state=on]:border-brand-strong data-[state=on]:bg-brand-soft data-[state=on]:text-neutral-1"
        >
          Show seconds
        </Toggle>
      </div>
      <ol aria-label="Order timeline" className="mt-4">
        {entries.map((entry, index) => (
          <Entry
            key={entry.id}
            entry={entry}
            last={index === entries.length - 1}
            seconds={seconds}
            now={now}
            timeZone={timeZone}
            fresh={!firstIds.has(entry.id)}
          />
        ))}
      </ol>
    </section>
  );
}
