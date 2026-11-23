import {
  AlarmClock,
  Banknote,
  CircleExclamationPoint,
  Clock,
  CreditCard,
  Info,
  MessageSquareText,
  TriangleAlert,
} from 'lucide-react';
import type { BoardCard, BoardCardLine } from '@/server/modules/board/schema';
import type { Tone } from '@/server/modules/board/timing';
import {
  HIDDEN_FOR_DEMO,
  MONEY_FLAG_LABELS,
  paymentChipText,
  type TimeBlockText,
} from '@/lib/board/text';
import { cn } from '@/lib/utils';

/*
 * The pieces of an order card (F5 design 2.4 to 2.6). Customer text (extras, notes, the kitchen
 * note) is rendered as plain text, never as HTML (A2.9): "<b>extra rice</b>" shows its
 * brackets.
 */

export const TONE_BORDER: Record<Tone, string> = {
  ok: 'border-l-neutral-6',
  soon: 'border-l-warning-strong',
  late: 'border-l-destructive',
};

const TONE_BLOCK: Record<Tone, { bg: string; icon: typeof Clock; iconClass: string }> = {
  ok: { bg: 'bg-neutral-7', icon: Clock, iconClass: 'text-neutral-3' },
  soon: { bg: 'bg-tag-6-bg', icon: AlarmClock, iconClass: 'text-warning-strong' },
  late: { bg: 'bg-tag-4-bg', icon: TriangleAlert, iconClass: 'text-destructive' },
};

/**
 * "Late 10 min" with its icon and tone, the minutes at 20 px (A2.4). The words and the second
 * line are read together ("Ready by 7:53 pm, 23 min left"); never a live region (A16.5).
 */
export function TimeBlock({ text, className }: { text: TimeBlockText; className?: string }) {
  const tone = TONE_BLOCK[text.tone];
  const Icon = tone.icon;
  return (
    <p
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-md px-2 py-1 text-neutral-1',
        tone.bg,
        className,
      )}
    >
      <Icon className={cn('size-4 shrink-0', tone.iconClass)} aria-hidden />
      <span aria-hidden className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
        {text.before ? <span className="text-body-5 font-medium">{text.before}</span> : null}
        {text.figure ? (
          <span className="text-body-2 leading-none font-semibold whitespace-nowrap tabular-nums">
            {text.figure}
          </span>
        ) : null}
        {text.after ? <span className="text-body-5 font-medium">{text.after}</span> : null}
      </span>
      <span className="sr-only">{text.spoken}</span>
    </p>
  );
}

/** The second line under the number ("Ready by 7:53 pm"); already read with the time block. */
export function TimeLine({ text }: { text: TimeBlockText }) {
  if (!text.line) return null;
  return (
    <p aria-hidden className="mt-1 text-body-5 text-neutral-3 tabular-nums">
      {text.line}
    </p>
  );
}

/* Wraps rather than clips: "to collect" drops to a second line on a narrow card (2.5). */
const CHIP =
  'inline-flex h-auto min-h-7 max-w-full items-center gap-1.5 rounded-md px-2 py-0.5 text-body-5 font-medium text-neutral-1';

/** Cash gets the blue tint so the bagger spots it; card stays neutral (design 2.6, D32). */
export function PaymentChip({ payment }: { payment: BoardCard['payment'] }) {
  const cash = payment.method === 'cash';
  return (
    <span className={cn(CHIP, cash ? 'bg-tag-3-bg' : 'bg-neutral-7')}>
      {cash ? (
        <Banknote className="size-3.5 shrink-0 text-tag-3" aria-hidden />
      ) : (
        <CreditCard className="size-3.5 shrink-0 text-neutral-3" aria-hidden />
      )}
      {paymentChipText(payment)}
    </span>
  );
}

/** "Refunded", "Partly refunded", "Disputed", "Paid late": support and admin only. */
export function FlagChips({ card }: { card: BoardCard }) {
  if (card.view !== 'full' || card.payment.flags.length === 0) return null;
  return (
    <>
      {card.payment.flags.map((flag) => (
        <span
          key={flag}
          className={cn(
            'inline-flex h-6 items-center rounded-md px-2 text-caption font-medium whitespace-nowrap text-neutral-1',
            flag === 'disputed' ? 'bg-tag-4-bg' : 'bg-neutral-7',
          )}
        >
          {MONEY_FLAG_LABELS[flag]}
        </span>
      ))}
    </>
  );
}

export function HiddenForDemo() {
  return <span className="text-caption text-neutral-3">{HIDDEN_FOR_DEMO}</span>;
}

/** Every line, however many: no "+3 more", long names wrap (A2.4). */
export function DishList({
  lines,
  showSoldOut,
  className,
}: {
  lines: readonly BoardCardLine[];
  /** New cards only: the cook knows before accepting (design 4.4). */
  showSoldOut: boolean;
  className?: string;
}) {
  return (
    <ul className={cn('space-y-2', className)}>
      {lines.map((line) => (
        <li key={line.id} className="text-body-3 text-neutral-1 [overflow-wrap:anywhere]">
          <span className="font-semibold tabular-nums">{line.quantity} ×</span> {line.title}
          {showSoldOut && line.soldOut ? (
            <span className="ml-2 inline-flex h-6 items-center rounded-md bg-tag-4-bg px-2 align-middle text-caption font-medium text-neutral-1">
              Sold out
            </span>
          ) : null}
          {line.flavors.length > 0 ? (
            <span className="block text-body-4 text-neutral-3">{line.flavors.join(', ')}</span>
          ) : null}
          {line.note ? (
            <span className="block text-body-4 text-neutral-1">
              <span className="font-semibold">Note:</span> {line.note}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** The whole order's kitchen note, in full, on a highlighted strip (A2.3, D34). */
export function KitchenNote({
  note,
  masked,
  className,
}: {
  note: string | null;
  masked: boolean;
  className?: string;
}) {
  if (!note) return null;
  return (
    <div
      className={cn(
        'flex gap-2 rounded-lg bg-tag-2-bg px-3 py-2 text-body-3 text-neutral-1 [overflow-wrap:anywhere]',
        className,
      )}
    >
      <MessageSquareText className="mt-1 size-4.5 shrink-0" aria-hidden />
      <p>
        <span className="font-semibold">Note:</span> {note}
        {masked ? (
          <span className="block">
            <HiddenForDemo />
          </span>
        ) : null}
      </p>
    </div>
  );
}

export interface CardReason {
  tone: 'calm' | 'error';
  text: string;
}

/** Why a move didn't happen, under the card's buttons (design 2.8). */
export function CardReasonBlock({ reason }: { reason: CardReason }) {
  const calm = reason.tone === 'calm';
  const Icon = calm ? Info : CircleExclamationPoint;
  return (
    <p
      className={cn(
        'relative z-10 mt-2 flex gap-2 rounded-lg px-3 py-2 text-body-5 text-neutral-1',
        calm ? 'bg-neutral-7' : 'bg-tag-4-bg',
      )}
    >
      <Icon
        className={cn('mt-0.5 size-4 shrink-0', calm ? 'text-neutral-3' : 'text-destructive')}
        aria-hidden
      />
      <span>{reason.text}</span>
    </p>
  );
}
