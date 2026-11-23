'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { type MouseEvent, type Ref, useEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { type BoardAbilities, type BoardCard, LATENESS } from '@/server/modules/board/schema';
import { type CardMenuItem, cardActions, PREVIOUS_STEP } from '@/server/modules/board/state';
import { cardTiming } from '@/server/modules/board/timing';
import { msUntil } from '@/lib/board/clock';
import { timeBlockText } from '@/lib/board/text';
import { prefersReducedMotion, useMotion } from '@/lib/motion';
import { isSitePath } from '@/lib/navigation';
import { cn } from '@/lib/utils';
import { type Blocked, CardActions, type MoveProgress } from './card-actions';
import {
  type CardReason,
  CardReasonBlock,
  DishList,
  FlagChips,
  HiddenForDemo,
  KitchenNote,
  PaymentChip,
  TimeBlock,
  TimeLine,
  TONE_BORDER,
} from './card-parts';

/*
 * One order on the board (F5 design 2.4): the number large, the time block, the first name,
 * payment and flags, every dish, the kitchen note, then the buttons. The heading link is
 * stretched over the whole card (A10.1); the buttons sit above it.
 */

export interface CardHighlight {
  /** Changes each time the card should be highlighted again. */
  key: number;
  /** A new order rises 8 px as it appears; a found or changed card only flashes. */
  kind: 'arrival' | 'flash';
}

export const orderHeadingId = (id: string) => `o-${id}`;
/** The order's staff address, by its UUID (never its number, A10.1). */
export function orderHref(id: string): Route {
  const href = `/admin/orders/${id}`;
  return isSitePath(href) ? href : '/admin/orders';
}

/** True while the card's own Undo can still be pressed (until the server's `undoUntil`). */
function useUndoOpen(undo: BoardCard['undo'], offset: number): boolean {
  const [, setTick] = useState(0);
  const left = undo ? msUntil(undo.until, offset) : 0;
  useEffect(() => {
    if (!undo || left <= 0) return undefined;
    const timer = setTimeout(() => setTick((tick) => tick + 1), left + 20);
    return () => clearTimeout(timer);
  }, [undo, left]);
  return Boolean(undo) && left > 0;
}

/**
 * The 2 s highlight (D19): a soft green wash that holds 1.4 s and fades in 600 ms, a new card
 * rising 8 px as it appears. Under reduced motion: a 2 px outline for 2 s, nothing moves.
 */
function useHighlight(
  highlight: CardHighlight | null,
  cardRef: React.RefObject<HTMLElement | null>,
  washRef: React.RefObject<HTMLElement | null>,
) {
  const [outlined, setOutlined] = useState(false);

  useMotion(
    (motion) => {
      if (!highlight || motion.reduced || !cardRef.current || !washRef.current) return;
      const timeline = gsap.timeline();
      if (highlight.kind === 'arrival') {
        timeline.from(cardRef.current, { y: 8, opacity: 0, duration: 0.24, ease: 'power2.out' }, 0);
      }
      timeline
        .set(washRef.current, { opacity: 1 }, 0)
        .to(washRef.current, { opacity: 0, duration: 0.6, ease: 'power1.out' }, 1.4);
    },
    { scope: cardRef, dependencies: [highlight?.key] },
  );

  useEffect(() => {
    if (!highlight || !prefersReducedMotion()) return undefined;
    const show = setTimeout(() => setOutlined(true), 0);
    const hide = setTimeout(() => setOutlined(false), 2_000);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
      setOutlined(false);
    };
  }, [highlight]);

  return outlined;
}

export function OrderCard({
  card,
  now,
  offset,
  timeZone,
  thresholds = LATENESS,
  can,
  progress,
  reason,
  blocked,
  highlight,
  headingRef,
  onPrimary,
  onMenu,
  onUndo,
  onOpen,
}: {
  card: BoardCard;
  /** The server's time now (B14), refreshed every 15 seconds. */
  now: Date;
  /** Server clock minus the device's, for the Undo window. */
  offset: number;
  timeZone: string;
  thresholds?: typeof LATENESS;
  can: BoardAbilities;
  progress: MoveProgress;
  reason: CardReason | null;
  blocked: Blocked;
  highlight: CardHighlight | null;
  headingRef?: Ref<HTMLAnchorElement>;
  onPrimary: (card: BoardCard) => void;
  onMenu: (card: BoardCard, item: CardMenuItem) => void;
  onUndo: (card: BoardCard) => void;
  /** Opening the detail from the heading (the panel), instead of a full page. */
  onOpen?: (card: BoardCard, event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  const cardRef = useRef<HTMLElement>(null);
  const washRef = useRef<HTMLSpanElement>(null);
  const timing = cardTiming(card, now, thresholds);
  const time = timeBlockText(timing, card, timeZone);
  const actions = cardActions(can, card.status);
  const undoOpen = useUndoOpen(card.undo, offset);
  const backTo = PREVIOUS_STEP[card.status];
  const outlined = useHighlight(highlight, cardRef, washRef);

  return (
    <article
      ref={cardRef}
      aria-labelledby={orderHeadingId(card.id)}
      data-tone={time.tone}
      data-order={card.number}
      className={cn(
        'relative rounded-xl border border-l-4 border-neutral-6 bg-white p-3 shadow-card hover:border-y-neutral-5 hover:border-r-neutral-5',
        TONE_BORDER[time.tone],
        outlined && 'outline-2 outline-offset-2 outline-brand-strong outline-solid',
      )}
    >
      <span
        ref={washRef}
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[inherit] bg-brand-soft opacity-0"
      />
      <div className="relative flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
        <h3 id={orderHeadingId(card.id)}>
          <Link
            ref={headingRef}
            href={orderHref(card.id)}
            scroll={false}
            onClick={onOpen ? (event) => onOpen(card, event) : undefined}
            className="rounded-md text-title-2 font-semibold whitespace-nowrap text-neutral-1 tabular-nums after:absolute after:inset-0 after:rounded-xl focus-visible:outline-offset-4"
          >
            <span className="sr-only">Order </span>
            {card.number}
          </Link>
        </h3>
        <TimeBlock text={time} />
      </div>
      <div className="relative">
        <TimeLine text={time} />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-body-4 font-medium text-neutral-1 [overflow-wrap:anywhere]">
            {card.firstName}
          </span>
          <PaymentChip payment={card.payment} />
          <FlagChips card={card} />
          {card.masked.firstName ? <HiddenForDemo /> : null}
        </div>
        <DishList lines={card.lines} showSoldOut={card.status === 'PLACED'} className="mt-3" />
        <KitchenNote note={card.kitchenNote} masked={card.masked.kitchenNote} className="mt-3" />
      </div>
      <CardActions
        number={card.number}
        actions={actions}
        waitingForPickup={card.status === 'READY' && actions.primary === null && can.move}
        progress={progress}
        undo={undoOpen && card.undo && backTo ? { until: card.undo.until, backTo } : null}
        offset={offset}
        blocked={blocked}
        onPrimary={() => onPrimary(card)}
        onMenu={(item) => onMenu(card, item)}
        onUndo={() => onUndo(card)}
      />
      {reason ? <CardReasonBlock reason={reason} /> : null}
    </article>
  );
}
