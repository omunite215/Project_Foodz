import {
  AlarmClock,
  BadgeCheck,
  Ban,
  CircleX,
  Clock,
  Eye,
  Flag,
  Hourglass,
  Inbox,
  type LucideIcon,
  PencilLine,
  PowerOff,
  ShieldBan,
  TriangleAlert,
} from 'lucide-react';
import type { ReactNode } from 'react';
import type { FlagKind, PartnerTab, Waiting } from '@/server/modules/partners/review-schema';
import type { StaffOnlineState } from '@/server/modules/partners/text';
import { FLAG_CHIP_LABELS, flagsCount, flagsSrText, STATUS_WORDS } from '@/lib/partner-review/text';
import { cn } from '@/lib/utils';

/*
 * Small parts the Partners list and the application page share (F6 design 7.5 to 7.7, 8.2):
 * the staff status chip, the waiting block, flag chips and the online mark. Each says its state
 * in words; colour, icon and border only repeat it.
 */

const STATUS: Record<
  Exclude<PartnerTab, 'all'>,
  { box: string; icon: LucideIcon; mark: string }
> = {
  review: { box: 'bg-tag-3-bg', icon: Inbox, mark: 'text-tag-3' },
  waiting: { box: 'bg-tag-6-bg', icon: Hourglass, mark: 'text-warning-strong' },
  approved: { box: 'bg-brand-soft', icon: BadgeCheck, mark: 'text-brand-strong' },
  suspended: { box: 'bg-tag-4-bg', icon: Ban, mark: 'text-destructive' },
  rejected: { box: 'bg-neutral-7', icon: CircleX, mark: 'text-neutral-3' },
};

export function StatusChip({ tab }: { tab: Exclude<PartnerTab, 'all'> }) {
  const status = STATUS[tab];
  const Icon = status.icon;
  return (
    <span
      className={cn(
        'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-body-5 font-medium whitespace-nowrap text-neutral-1',
        status.box,
      )}
    >
      <Icon className={cn('size-3.5', status.mark)} aria-hidden />
      {STATUS_WORDS[tab]}
    </span>
  );
}

const TONES: Record<
  Waiting['tone'],
  { border: string; box: string; icon: LucideIcon; mark: string }
> = {
  normal: {
    border: 'border-l-neutral-5',
    box: 'bg-neutral-7',
    icon: Clock,
    mark: 'text-neutral-3',
  },
  amber: {
    border: 'border-l-warning-strong',
    box: 'bg-tag-6-bg',
    icon: AlarmClock,
    mark: 'text-warning-strong',
  },
  red: {
    border: 'border-l-destructive',
    box: 'bg-tag-4-bg',
    icon: TriangleAlert,
    mark: 'text-destructive',
  },
};

/** "Waiting 9 h", amber "Waiting 1 day", red "Over 2 working days" + "waiting 3 days" (7.6). */
export function WaitingBlock({ waiting, words }: { waiting: Waiting; words?: string }) {
  const tone = TONES[waiting.tone];
  const Icon = tone.icon;
  return (
    <span
      className={cn(
        'inline-flex items-start gap-1.5 rounded-md border-l-4 px-2 py-1 text-body-5 font-medium text-neutral-1',
        tone.border,
        tone.box,
      )}
    >
      <Icon className={cn('mt-[3px] size-3.5 shrink-0', tone.mark)} aria-hidden />
      <span>
        {words ?? waiting.words}
        {waiting.detail ? <span className="block font-normal">{waiting.detail}</span> : null}
      </span>
    </span>
  );
}

const CHIP =
  'inline-flex h-6 items-center gap-1 rounded-md px-2 text-caption font-medium whitespace-nowrap text-neutral-1';

/** Stacked chips at `xl`, one "3 flags" chip on narrower tables and on cards (7.7). */
export function FlagChips({
  flags,
  compact,
}: {
  flags: readonly FlagKind[];
  compact: 'always' | 'belowXl';
}) {
  if (flags.length === 0) return null;
  const one = (
    <span className={cn(CHIP, 'bg-tag-6-bg')}>
      <Flag className="size-3 text-warning-strong" aria-hidden />
      <span aria-hidden>{flagsCount(flags.length)}</span>
      <span className="sr-only">{flagsSrText(flags)}</span>
    </span>
  );
  if (compact === 'always') return one;
  return (
    <>
      <span className="xl:hidden">{one}</span>
      <span className="hidden flex-col items-start gap-1 xl:flex">
        {flags.map((flag) => (
          <span key={flag} className={cn(CHIP, 'bg-tag-6-bg')}>
            <Flag className="size-3 text-warning-strong" aria-hidden />
            {FLAG_CHIP_LABELS[flag]}
          </span>
        ))}
      </span>
    </>
  );
}

export function BannedChip() {
  return (
    <span className={cn(CHIP, 'bg-tag-4-bg')}>
      <ShieldBan className="size-3 text-destructive" aria-hidden />
      Account banned
    </span>
  );
}

export function DemoChip() {
  return (
    <span className={cn(CHIP, 'bg-neutral-7')}>
      <Eye className="size-3 text-neutral-3" aria-hidden />
      Demo
    </span>
  );
}

/** "Changed", beside a part the applicant edited since the last decision (8.9). */
export function ChangedChip() {
  return (
    <span className={cn(CHIP, 'bg-tag-3-bg')} data-changed-chip="" tabIndex={-1}>
      <PencilLine className="size-3 text-tag-3" aria-hidden />
      Changed
    </span>
  );
}

/** The 8 px dot or icon before an online line (7.5, 8.7). Never a place. */
export function OnlineLine({
  state,
  words,
  className,
}: {
  state: StaffOnlineState['kind'];
  words: string;
  className?: string;
}) {
  let mark: ReactNode;
  if (state === 'online') {
    mark = <span aria-hidden className="mt-[7px] size-2 shrink-0 rounded-full bg-brand-strong" />;
  } else if (state === 'stale') {
    mark = <AlarmClock className="mt-[3px] size-3.5 shrink-0 text-warning-strong" aria-hidden />;
  } else if (state === 'takenOffline') {
    mark = <PowerOff className="mt-[3px] size-3.5 shrink-0 text-neutral-3" aria-hidden />;
  } else {
    mark = <span aria-hidden className="mt-[7px] size-2 shrink-0 rounded-full bg-neutral-4" />;
  }
  return (
    <span className={cn('inline-flex items-start gap-2', className)}>
      {mark}
      <span>{words}</span>
    </span>
  );
}
