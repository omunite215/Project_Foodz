'use client';

import { Check } from 'lucide-react';
import { type ReactNode, useId } from 'react';
import { TIP_PERCENTS, type Quote } from '@/server/modules/cart/schema';
import { FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { type TipTile, tipTileName } from '@/lib/checkout-text';
import { formatPrice } from '@/lib/format';
import { cn } from '@/lib/utils';

/*
 * "Tip your courier" (F4 design 2.11, D11): five tiles in one row (three columns under 360 px).
 * Every amount is the server's (tipOptions), never worked out here. "Other" reveals the amount
 * field without moving focus, so the arrow keys keep moving in the group.
 */

export const TIP_AMOUNT_ID = 'tip-amount';

export interface TipPickerProps {
  tile: TipTile;
  onTile: (tile: TipTile) => void;
  otherText: string;
  onOtherText: (text: string) => void;
  onOtherBlur: () => void;
  /** The amount field's error, once shown. */
  otherError: string | null;
  /** The valid typed amount, for the Other tile. */
  otherCents: number | null;
  quote: Quote | null;
  /** The quote failed: amounts read "—". */
  failed: boolean;
  dim: boolean;
}

const TILES: TipTile[] = [
  { kind: 'none' },
  ...TIP_PERCENTS.map((percent) => ({ kind: 'percent', percent }) as const),
  { kind: 'other' },
];

const sameTile = (a: TipTile, b: TipTile) =>
  a.kind === b.kind && (a.kind !== 'percent' || (b.kind === 'percent' && a.percent === b.percent));

const tileKey = (tile: TipTile) => (tile.kind === 'percent' ? `p${tile.percent}` : tile.kind);

export function TipPicker({
  tile,
  onTile,
  otherText,
  onOtherText,
  onOtherBlur,
  otherError,
  otherCents,
  quote,
  failed,
  dim,
}: TipPickerProps) {
  const id = useId();
  const hintId = `${id}-tip-hint`;
  const errorId = `${TIP_AMOUNT_ID}-error`;

  const amountOf = (choice: TipTile): number | null => {
    if (choice.kind === 'percent') {
      return quote?.tipOptions.find((option) => option.percent === choice.percent)?.cents ?? null;
    }
    if (choice.kind === 'other') return otherCents;
    return null;
  };

  return (
    <fieldset aria-describedby={hintId} className="min-w-0">
      <legend className="mb-1 w-full p-0">
        <h2 className="text-body-2 font-semibold text-neutral-1">Tip your courier</h2>
      </legend>
      <p id={hintId} className="text-body-5 text-neutral-3">
        Optional. All of it goes to your courier.
      </p>
      <div className="mt-4 grid grid-cols-3 gap-2 min-[360px]:grid-cols-5">
        {TILES.map((choice) => {
          const cents = amountOf(choice);
          const checked = sameTile(choice, tile);
          let second: ReactNode = null;
          if (choice.kind === 'percent') {
            second = failed ? (
              '—'
            ) : cents === null ? (
              <span
                aria-hidden
                className="inline-block h-4 w-10 rounded-sm bg-neutral-7 align-middle animate-skeleton motion-reduce:animate-none"
              />
            ) : (
              formatPrice(cents)
            );
          } else if (choice.kind === 'other' && cents !== null) {
            second = formatPrice(cents);
          }
          return (
            <label
              key={tileKey(choice)}
              className={cn(
                'group relative flex min-h-16 cursor-pointer flex-col items-center justify-center rounded-xl border border-neutral-6 bg-white px-1 py-2 text-center hover:border-neutral-5',
                'has-[:checked]:border-2 has-[:checked]:border-brand-strong has-[:checked]:bg-brand-soft',
                'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring has-[:focus-visible]:outline-solid',
              )}
            >
              <input
                type="radio"
                name="tip"
                value={tileKey(choice)}
                checked={checked}
                aria-label={tipTileName(choice, failed ? null : cents)}
                onChange={() => onTile(choice)}
                className="sr-only"
              />
              <span
                aria-hidden
                className="text-body-5 font-semibold whitespace-nowrap text-neutral-1 md:text-body-4"
              >
                {choice.kind === 'none'
                  ? 'No tip'
                  : choice.kind === 'other'
                    ? 'Other'
                    : `${choice.percent} %`}
              </span>
              {second !== null ? (
                <span
                  aria-hidden
                  className={cn(
                    'mt-0.5 whitespace-nowrap text-neutral-3 tabular-nums transition-opacity duration-150 group-has-[:checked]:text-neutral-1',
                    choice.kind === 'other' ? 'text-caption md:text-body-5' : 'text-body-5',
                    dim && 'opacity-75',
                  )}
                >
                  {second}
                </span>
              ) : null}
              <span
                aria-hidden
                className="absolute -top-1.5 -right-1.5 hidden size-5 items-center justify-center rounded-full bg-brand-strong group-has-[:checked]:flex"
              >
                <Check className="size-3 text-white" strokeWidth={3} />
              </span>
            </label>
          );
        })}
      </div>
      {tile.kind === 'other' ? (
        <div className="mt-4 max-w-[200px]">
          <FieldLabel htmlFor={TIP_AMOUNT_ID}>Tip amount</FieldLabel>
          <div className="relative mt-2">
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 left-5 flex items-center text-body-4 text-neutral-3"
            >
              $
            </span>
            <Input
              id={TIP_AMOUNT_ID}
              value={otherText}
              inputMode="decimal"
              autoComplete="off"
              enterKeyHint="done"
              maxLength={10}
              aria-invalid={otherError ? true : undefined}
              aria-describedby={otherError ? errorId : undefined}
              onChange={(event) => onOtherText(event.target.value)}
              onBlur={onOtherBlur}
              className="h-11 rounded-xl bg-white pl-9 text-body-4 tabular-nums md:text-body-4"
            />
          </div>
          <FieldError id={otherError ? errorId : undefined}>{otherError}</FieldError>
        </div>
      ) : null}
    </fieldset>
  );
}
