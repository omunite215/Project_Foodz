'use client';

import { Info, Minus, Pencil, Plus, Trash2, TrendingDown, TrendingUp, Undo2 } from 'lucide-react';
import Link from 'next/link';
import type { dishHref } from '@/server/modules/menu/urls';
import { type Ref, useEffect, useId, useRef, useState } from 'react';
import { DishPlate } from '@/components/dish/dish-plate';
import { FlavorToggles } from '@/components/dish/flavor-toggles';
import { KitchenNote } from '@/components/dish/kitchen-note';
import { Button } from '@/components/ui/button';
import { announce } from '@/lib/announce';
import { droppedFlavorText, priceChangeText, unitLabel, unitText } from '@/lib/cart-text';
import { MAX_LINE_QUANTITY } from '@/lib/data/cart';
import { formatPrice } from '@/lib/format';
import { useMotion } from '@/lib/motion';
import { cn } from '@/lib/utils';

/*
 * One line of the cart (F3 design 2.5 to 2.8; Figma Checkout "added item", adapted): the plate,
 * the dish name as a link, the line total, the unit price, extras and note, any flags, and a row
 * of 44 px controls. Presentational: the cart panel passes the figures and the handlers.
 */

const LIMIT_TEXT = '20 is the most for one dish';

export interface CartLineView {
  id: string;
  title: string | null;
  href: ReturnType<typeof dishHref> | null;
  image: string | null;
  quantity: number;
  flavors: readonly string[];
  note?: string;
  /** The last unit price the server gave (or the display cache's), null before any. */
  unitCents: number | null;
  soldOut: boolean;
  /** "Now $13.99 (was $12.99)" (S3.3). */
  priceChange: { nowCents: number; wasCents: number } | null;
  droppedFlavors: readonly string[];
  /** What the dish offers, for the editor; null until the server has said. */
  flavorsOffered: readonly string[] | null;
}

export interface QuantityStepperProps {
  title: string;
  suffix: string;
  quantity: number;
  /** The cart is full: every "+" is blocked, described by the notice. */
  cartFull: { id: string; text: string } | null;
  limitId: string;
  onChange: (quantity: number) => void;
  onRemove: () => void;
}

const stepButton =
  'flex size-11 items-center justify-center text-neutral-2 outline-none hover:bg-neutral-7 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid';

/** One joined 44 px group: minus (a bin at 1), the count, plus (S1.6, S7.2). */
export function QuantityStepper({
  title,
  suffix,
  quantity,
  cartFull,
  limitId,
  onChange,
  onRemove,
}: QuantityStepperProps) {
  const atMax = quantity >= MAX_LINE_QUANTITY;
  const blocked = atMax || cartFull !== null;
  const countRef = useRef<HTMLSpanElement>(null);

  useMotion(
    (motion) => {
      if (!countRef.current) return;
      motion.from(countRef.current, { opacity: 0.4, duration: 0.15, ease: 'power2.out' });
    },
    { scope: countRef, dependencies: [quantity] },
  );

  return (
    <div
      // One joined control row; a fieldset can't be laid out as one.
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
      role="group"
      aria-label={`Quantity, ${title}${suffix}`}
      className="inline-flex items-center rounded-lg border border-neutral-6 bg-white"
    >
      {quantity <= 1 ? (
        <button
          type="button"
          aria-label={`Remove ${title}${suffix}`}
          onClick={onRemove}
          className={cn(stepButton, 'rounded-l-lg text-destructive')}
        >
          <Trash2 className="size-[18px]" aria-hidden />
        </button>
      ) : (
        <button
          type="button"
          aria-label={`Decrease ${title}${suffix}`}
          onClick={() => onChange(quantity - 1)}
          className={cn(stepButton, 'rounded-l-lg')}
        >
          <Minus className="size-[18px]" aria-hidden />
        </button>
      )}
      <span
        ref={countRef}
        aria-hidden
        className="w-10 text-center text-body-4 font-medium text-neutral-1 tabular-nums"
      >
        {quantity}
      </span>
      <span className="sr-only">
        {title}
        {suffix}, quantity {quantity}
      </span>
      <button
        type="button"
        aria-label={`Increase ${title}${suffix}`}
        aria-disabled={blocked || undefined}
        aria-describedby={atMax ? limitId : (cartFull?.id ?? undefined)}
        onClick={() => {
          if (atMax) announce(LIMIT_TEXT);
          else if (cartFull) announce(cartFull.text);
          else onChange(quantity + 1);
        }}
        className={cn(
          stepButton,
          'rounded-r-lg',
          blocked && 'cursor-not-allowed text-neutral-5 hover:bg-transparent',
        )}
      >
        <Plus className="size-[18px]" aria-hidden />
      </button>
    </div>
  );
}

export interface CartLineItemProps {
  line: CartLineView;
  /** What tells this line apart from another line of the same dish (S7.2). */
  suffix: string;
  cartFull: { id: string; text: string } | null;
  editing: boolean;
  editor?: React.ReactNode;
  editorId: string;
  onQuantity: (quantity: number) => void;
  onRemove: () => void;
  onEdit: () => void;
  /** A link inside the cart is about to replace its history entry. */
  onNavigate: () => void;
  editRef?: Ref<HTMLButtonElement>;
  removeRef?: Ref<HTMLButtonElement>;
  nameRef?: Ref<HTMLAnchorElement>;
}

const actionButton = 'h-11 px-2 text-button-2 font-medium hover:bg-neutral-7';

export function CartLineItem({
  line,
  suffix,
  cartFull,
  editing,
  editor,
  editorId,
  onQuantity,
  onRemove,
  onEdit,
  onNavigate,
  editRef,
  removeRef,
  nameRef,
}: CartLineItemProps) {
  const limitId = useId();
  const title = line.title ?? 'This dish';
  const atMax = line.quantity >= MAX_LINE_QUANTITY;
  const lineTotal = line.unitCents === null ? null : line.unitCents * line.quantity;
  const wentUp = line.priceChange && line.priceChange.nowCents > line.priceChange.wasCents;

  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 md:gap-x-4">
      {line.title === null ? (
        <span aria-hidden className="block size-18 rounded-full bg-neutral-7 md:size-20" />
      ) : (
        <DishPlate
          src={line.image}
          sizes="80px"
          soldOut={line.soldOut}
          className="size-18 md:size-20"
        />
      )}
      <div className="min-w-0">
        <div className="flex items-start justify-between gap-3">
          {line.title === null ? (
            <span aria-hidden className="mt-1 block h-6 w-2/3 rounded-sm bg-neutral-7" />
          ) : line.href ? (
            // Replaces the cart's history entry: Back from the dish returns to the page under it.
            <Link
              ref={nameRef}
              href={line.href}
              replace
              onNavigate={onNavigate}
              className="min-w-0 font-heading text-body-2 leading-tight text-neutral-2 underline-offset-4 [overflow-wrap:break-word] hover:underline"
            >
              {line.title}
            </Link>
          ) : (
            <span className="min-w-0 font-heading text-body-2 leading-tight text-neutral-2 [overflow-wrap:break-word]">
              {line.title}
            </span>
          )}
          {line.soldOut || lineTotal === null ? null : (
            <span className="font-heading text-body-2 whitespace-nowrap text-brand-strong tabular-nums">
              {formatPrice(lineTotal)}
            </span>
          )}
        </div>
        {line.unitCents === null ? null : (
          <p className="mt-1 text-body-5 text-neutral-3 tabular-nums">
            <span aria-hidden>{unitText(line.quantity, line.unitCents)}</span>
            <span className="sr-only">{unitLabel(line.quantity, line.unitCents)}</span>
          </p>
        )}
        {line.flavors.length > 0 ? (
          <p className="mt-1 text-body-5 text-neutral-3">Extra: {line.flavors.join(', ')}</p>
        ) : null}
        {line.note ? (
          <p className="mt-0.5 line-clamp-2 text-body-5 text-neutral-3 [overflow-wrap:anywhere]">
            Note: {line.note}
          </p>
        ) : null}
        {line.soldOut || line.priceChange || line.droppedFlavors.length > 0 ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {line.soldOut ? (
              <>
                <span className="inline-flex h-6 items-center rounded-md bg-neutral-1 px-2 text-caption font-medium text-neutral-8">
                  Sold out today
                </span>
                <span className="text-body-5 text-neutral-3">Not in your total</span>
              </>
            ) : null}
            {line.priceChange ? (
              <span className="inline-flex min-h-6 items-center gap-1 rounded-md bg-tag-6-bg px-2 text-caption font-medium text-neutral-1">
                {wentUp ? (
                  <TrendingUp className="size-3 text-tag-6" aria-hidden />
                ) : (
                  <TrendingDown className="size-3 text-neutral-3" aria-hidden />
                )}
                {priceChangeText(line.priceChange.nowCents, line.priceChange.wasCents)}
              </span>
            ) : null}
            {line.droppedFlavors.length > 0 ? (
              <p className="flex items-start gap-1.5 text-body-5 text-neutral-3">
                <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
                {droppedFlavorText(line.droppedFlavors, title)}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="col-span-2 mt-3 flex flex-wrap items-center justify-between gap-2">
        {line.soldOut ? (
          <span />
        ) : (
          <QuantityStepper
            title={title}
            suffix={suffix}
            quantity={line.quantity}
            cartFull={cartFull}
            limitId={limitId}
            onChange={onQuantity}
            onRemove={onRemove}
          />
        )}
        {/* gap-1: stepper, Edit and Remove stay on one row in a 262 px card at 320. */}
        <div className="flex gap-1">
          {line.soldOut || line.flavorsOffered === null ? null : (
            <Button
              ref={editRef}
              type="button"
              variant="ghost"
              aria-expanded={editing}
              aria-controls={editorId}
              onClick={onEdit}
              className={cn(actionButton, 'text-neutral-2')}
            >
              <Pencil className="hidden size-4 md:block" aria-hidden />
              Edit
              <span className="sr-only">
                {' '}
                {title}
                {suffix}
              </span>
            </Button>
          )}
          <Button
            ref={removeRef}
            type="button"
            variant="ghost"
            onClick={onRemove}
            className={cn(actionButton, 'text-destructive hover:text-destructive')}
          >
            <Trash2 className="hidden size-4 md:block" aria-hidden />
            Remove
            <span className="sr-only">
              {' '}
              {title}
              {suffix}
            </span>
          </Button>
        </div>
      </div>
      {atMax && !line.soldOut ? (
        <p id={limitId} className="col-span-2 mt-1 text-body-5 text-neutral-3">
          {LIMIT_TEXT}
        </p>
      ) : null}
      <div
        id={editorId}
        hidden={!editing}
        className="col-span-2 mt-4 border-t border-neutral-6 pt-4"
      >
        {editing ? editor : null}
      </div>
    </div>
  );
}

/** In place of a removed line, until her next action in the cart or the cart closes (S1.8). */
export function UndoRow({
  title,
  onUndo,
  undoRef,
}: {
  title: string;
  onUndo: () => void;
  undoRef?: Ref<HTMLButtonElement>;
}) {
  return (
    <div className="flex min-h-14 items-center justify-between gap-3 rounded-lg bg-neutral-7 px-4 py-2">
      <p className="min-w-0 text-body-5 text-neutral-1 [overflow-wrap:anywhere]">
        {title} removed.
      </p>
      <Button
        ref={undoRef}
        type="button"
        variant="outline"
        size="touch"
        onClick={onUndo}
        className="bg-white"
      >
        <Undo2 className="size-4" aria-hidden />
        Undo<span className="sr-only"> removing {title}</span>
      </Button>
    </div>
  );
}

/** Flavors and note for a line, inside its card (S1.7). */
export function CartLineEditor({
  flavorsOffered,
  flavors,
  note,
  onSave,
  onCancel,
}: {
  flavorsOffered: readonly string[];
  flavors: readonly string[];
  note: string;
  onSave: (change: { flavors: string[]; note: string }) => void;
  onCancel: () => void;
}) {
  const [picked, setPicked] = useState<string[]>(() =>
    flavors.filter((flavor) => flavorsOffered.includes(flavor)),
  );
  const [text, setText] = useState(note);
  const ref = useRef<HTMLDivElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  useMotion(
    (motion) => {
      if (!ref.current || motion.reduced) return;
      motion.from(ref.current, { opacity: 0, duration: 0.15, ease: 'power2.out' });
    },
    { scope: ref },
  );

  // On open: the first flavor, or the note when the dish has none.
  useEffect(() => {
    const first = ref.current?.querySelector<HTMLElement>('button[aria-pressed]:not([disabled])');
    (first ?? noteRef.current)?.focus();
  }, []);

  return (
    <div ref={ref}>
      <FlavorToggles flavors={flavorsOffered} value={picked} onChange={setPicked} titleAs="p" />
      <KitchenNote
        value={text}
        onChange={setText}
        textareaRef={noteRef}
        className={flavorsOffered.length > 0 ? 'mt-4' : undefined}
        textareaClassName="min-h-[88px]"
      />
      <div className="mt-4 flex gap-2">
        <Button type="button" size="touch" onClick={() => onSave({ flavors: picked, note: text })}>
          Save
        </Button>
        <Button type="button" variant="ghost" size="touch" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
