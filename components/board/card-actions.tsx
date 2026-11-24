'use client';

import {
  ArrowLeftRight,
  CircleX,
  Clock,
  EllipsisVertical,
  House,
  type LucideIcon,
  OctagonX,
  PanelRightOpen,
  RotateCcw,
  Truck,
  Undo2,
  UserRoundPlus,
  UserRoundX,
} from 'lucide-react';
import { Fragment, useId, useRef } from 'react';
import type { OrderStatus } from '@/server/db/enums';
import type { CardActions as Actions, CardMenuItem } from '@/server/modules/board/state';
import { BLOCKED_BUTTON_CLASS, useSlowPending } from '@/components/forms/submit-button';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Spinner } from '@/components/ui/spinner';
import { announce } from '@/lib/announce';
import { msUntil } from '@/lib/board/clock';
import type { CourierMenuItem } from '@/lib/board/courier-text';
import {
  MENU_WORDS,
  OFFLINE_CAPTION,
  PRIMARY_WORDS,
  READ_ONLY_CAPTION,
  undoSpoken,
  WAITING_FOR_PICKUP,
} from '@/lib/board/text';
import { UNDO_WINDOW_MS } from '@/server/modules/board/schema';
import { useMotion } from '@/lib/motion';
import { cn } from '@/lib/utils';

/*
 * A card's buttons (F5 design 2.7, 2.8): one big primary step and "More actions", 8 px apart,
 * 48 px tall. A confirmed move turns the row into "Moved just now · Undo" for 10 seconds, timed
 * by the server's `undoUntil`.
 */

const MENU_ICONS: Record<CardMenuItem, LucideIcon> = {
  details: PanelRightOpen,
  moveBack: Undo2,
  pickUp: Truck,
  deliver: House,
  refuse: OctagonX,
  cancel: CircleX,
};

export type { CourierMenuItem };

const COURIER_ITEMS: Record<CourierMenuItem, { icon: LucideIcon; words: string }> = {
  assignCourier: { icon: UserRoundPlus, words: 'Assign courier' },
  takeOffCourier: { icon: UserRoundX, words: 'Take off courier' },
  chooseAnother: { icon: ArrowLeftRight, words: 'Choose another courier' },
  findCourier: { icon: RotateCcw, words: 'Find a courier' },
};

const NO_COURIER_ITEMS: readonly CourierMenuItem[] = [];

const DESTRUCTIVE: ReadonlySet<CardMenuItem> = new Set(['refuse', 'cancel']);
const OVERRIDES: ReadonlySet<CardMenuItem> = new Set(['moveBack', 'pickUp', 'deliver']);

const slowLabel = (slow: boolean, number: string, backTo: OrderStatus) =>
  slow ? 'Undoing…' : `Undo, ${undoSpoken(number, backTo)}`;

export type MoveProgress = 'moving' | 'undoing' | null;
export type Blocked = 'demo' | 'offline' | null;

/** The menu in the design's order: Details, then overrides, then destructive items last. */
function menuGroups(items: readonly CardMenuItem[]): CardMenuItem[][] {
  return [
    items.filter((item) => item === 'details'),
    items.filter((item) => OVERRIDES.has(item)),
    items.filter((item) => DESTRUCTIVE.has(item)),
  ].filter((group) => group.length > 0);
}

function UndoRow({
  number,
  backTo,
  until,
  offset,
  undoing,
  blocked,
  captionId,
  onUndo,
}: {
  number: string;
  backTo: OrderStatus;
  until: string;
  offset: number;
  undoing: boolean;
  blocked: Blocked;
  captionId: string;
  onUndo: () => void;
}) {
  const barRef = useRef<HTMLSpanElement>(null);
  const slow = useSlowPending(undoing);

  // The bar along the card's bottom edge shrinks over what is left of the 10 seconds; hidden
  // under reduced motion (design 2.8, motion table).
  useMotion(
    (motion) => {
      const bar = barRef.current;
      if (!bar || motion.reduced) return;
      const left = Math.max(0, msUntil(until, offset));
      motion.fromTo(
        bar,
        { scaleX: Math.min(1, left / UNDO_WINDOW_MS) },
        { scaleX: 0, duration: left / 1000, ease: 'none' },
      );
    },
    { scope: barRef, dependencies: [until, offset] },
  );

  return (
    <>
      <div className="relative z-10 mt-3 flex min-h-12 items-center gap-2">
        <span className="flex-1 text-body-5 text-neutral-1">Moved just now</span>
        <Button
          type="button"
          variant="outline"
          size="kitchen"
          aria-label={slowLabel(slow, number, backTo)}
          aria-disabled={undoing || blocked ? true : undefined}
          aria-describedby={blocked ? captionId : undefined}
          className={cn(blocked && !undoing && BLOCKED_BUTTON_CLASS)}
          onClick={() => {
            if (undoing) return;
            if (blocked) {
              announce(blocked === 'demo' ? READ_ONLY_CAPTION : OFFLINE_CAPTION);
              return;
            }
            onUndo();
          }}
        >
          {slow ? (
            <>
              <Spinner className="motion-reduce:animate-none" />
              Undoing…
            </>
          ) : (
            'Undo'
          )}
        </Button>
      </div>
      <span
        ref={barRef}
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-0.5 origin-left rounded-b-xl bg-brand-strong motion-reduce:hidden"
      />
    </>
  );
}

export function CardActions({
  number,
  actions,
  waitingForPickup,
  progress,
  undo,
  offset,
  blocked,
  onPrimary,
  onMenu,
  onUndo,
  courierItems = NO_COURIER_ITEMS,
  onCourier,
}: {
  number: string;
  actions: Actions;
  /** F7: "Assign courier", "Take off courier", "Choose another courier", "Find a courier". */
  courierItems?: readonly CourierMenuItem[];
  onCourier?: (item: CourierMenuItem) => void;
  /** KITCHEN on a Ready card: no button, "Waiting for pickup" (design 2.7). */
  waitingForPickup: boolean;
  progress: MoveProgress;
  /** The caller's own move, while it can still be undone. */
  undo: { until: string; backTo: OrderStatus } | null;
  offset: number;
  blocked: Blocked;
  onPrimary: () => void;
  onMenu: (item: CardMenuItem) => void;
  onUndo: () => void;
}) {
  const captionId = useId();
  const slow = useSlowPending(progress === 'moving');
  const demo = blocked === 'demo';
  // Offline blocks moves only: the caption sits under a blocked button, never under "Waiting
  // for pickup" or support's menu, which still opens.
  const caption = demo
    ? READ_ONLY_CAPTION
    : blocked === 'offline' && (undo || actions.primary)
      ? OFFLINE_CAPTION
      : null;

  if (undo) {
    return (
      <>
        <UndoRow
          number={number}
          backTo={undo.backTo}
          until={undo.until}
          offset={offset}
          undoing={progress === 'undoing'}
          blocked={blocked}
          captionId={captionId}
          onUndo={onUndo}
        />
        {caption ? (
          <p id={captionId} className="relative z-10 mt-1.5 text-caption text-neutral-3">
            {caption}
          </p>
        ) : null}
      </>
    );
  }

  // SUPPORT has no primary: "Actions" stretches so the row isn't empty (A4.9).
  const support = actions.primary === null && !waitingForPickup;
  const primaryBlocked = Boolean(blocked);

  return (
    <>
      <div className="relative z-10 mt-3 flex items-stretch gap-2">
        {actions.primary ? (
          <Button
            type="button"
            size="kitchen"
            aria-disabled={progress || primaryBlocked ? true : undefined}
            aria-describedby={caption ? captionId : undefined}
            className={cn(
              'min-w-0 flex-1 font-semibold',
              primaryBlocked && !progress && BLOCKED_BUTTON_CLASS,
              progress && 'cursor-progress',
            )}
            onClick={() => {
              if (progress) return;
              if (blocked) {
                announce(caption ?? '');
                return;
              }
              onPrimary();
            }}
          >
            {slow ? (
              <>
                <Spinner className="motion-reduce:animate-none" />
                Moving…
              </>
            ) : (
              <>
                {PRIMARY_WORDS[actions.primary]}
                <span className="sr-only"> order {number}</span>
              </>
            )}
          </Button>
        ) : waitingForPickup ? (
          <p className="flex min-h-12 flex-1 items-center gap-1.5 text-body-5 text-neutral-3">
            <Clock className="size-4" aria-hidden />
            {WAITING_FOR_PICKUP}
          </p>
        ) : null}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size={support ? 'kitchen' : 'icon-kitchen'}
              data-card-menu=""
              className={cn(support && 'flex-1', demo && BLOCKED_BUTTON_CLASS)}
              aria-describedby={demo ? captionId : undefined}
            >
              <EllipsisVertical className="size-5" aria-hidden />
              {support ? (
                <>
                  <span aria-hidden>Actions</span>
                  <span className="sr-only">Actions for order {number}</span>
                </>
              ) : (
                <span className="sr-only">More actions for order {number}</span>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={6} className="w-64">
            {demo ? (
              <>
                <DropdownMenuLabel className="text-body-5 text-neutral-3">
                  {READ_ONLY_CAPTION}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
              </>
            ) : null}
            {menuGroups(actions.menu).map((group, index) => (
              <Fragment key={group.join()}>
                {index > 0 ? <DropdownMenuSeparator /> : null}
                {group.map((item) => {
                  const Icon = MENU_ICONS[item];
                  const destructive = DESTRUCTIVE.has(item);
                  // Details only reads; everything else changes the order.
                  const disabled = demo && item !== 'details';
                  return (
                    <DropdownMenuItem
                      key={item}
                      disabled={disabled}
                      onSelect={() => onMenu(item)}
                      className={cn(
                        'h-12',
                        disabled
                          ? 'text-neutral-3'
                          : destructive && 'text-destructive data-[highlighted]:text-destructive',
                      )}
                    >
                      <Icon
                        className={
                          disabled
                            ? 'text-neutral-4'
                            : destructive
                              ? 'text-destructive'
                              : 'text-neutral-3'
                        }
                        aria-hidden
                      />
                      {MENU_WORDS[item]}
                    </DropdownMenuItem>
                  );
                })}
                {/* The courier items close the overrides group (after Details). */}
                {group.includes('details') && courierItems.length ? (
                  <>
                    <DropdownMenuSeparator />
                    {courierItems.map((item) => {
                      const Icon = COURIER_ITEMS[item].icon;
                      return (
                        <DropdownMenuItem
                          key={item}
                          disabled={demo}
                          onSelect={() => onCourier?.(item)}
                          className={cn('h-12', demo && 'text-neutral-3')}
                        >
                          <Icon
                            className={demo ? 'text-neutral-4' : 'text-neutral-3'}
                            aria-hidden
                          />
                          {COURIER_ITEMS[item].words}
                        </DropdownMenuItem>
                      );
                    })}
                  </>
                ) : null}
              </Fragment>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {caption ? (
        <p id={captionId} className="relative z-10 mt-1.5 text-caption text-neutral-3">
          {caption}
        </p>
      ) : null}
    </>
  );
}
