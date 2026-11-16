'use client';

import { revalidateLogic, useForm } from '@tanstack/react-form';
import { Check, CircleExclamationPoint, Plus, Trash } from 'lucide-react';
import Link from 'next/link';
import { useId, useRef, useState } from 'react';
import type { DishCard, StoreMoment } from '@/server/modules/menu/schema';
import { CUISINES } from '@/server/modules/menu/urls';
import { checkDishes } from '@/components/dish/check-dishes';
import { DishPlate, PlaceholderPlate } from '@/components/dish/dish-plate';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  NativeSelect,
  NativeSelectOptGroup,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { announce } from '@/lib/announce';
import { useCartActions } from '@/lib/data/cart';
import { CUISINE_LABELS, dishesAddedText, formatPrice, momentText } from '@/lib/format';
import { useMotion } from '@/lib/motion';
import {
  MAX_TASTE_QUANTITY,
  newTasteRow,
  soldOutText,
  tasteLines,
  tastePickerSchema,
  type TasteRow,
  tasteSubtotalCents,
} from '@/lib/taste-picker';
import { cn } from '@/lib/utils';

const QUANTITIES = Array.from({ length: MAX_TASTE_QUANTITY }, (_, index) => index + 1);
/** After adding, the button stays off this long, so a double click adds once. */
const COOL_DOWN_MS = 1000;

interface Status {
  tone: 'success' | 'error';
  text: string;
}

function errorText(errors: readonly unknown[]): string | null {
  for (const error of errors) {
    if (typeof error === 'string') return error;
    if (error && typeof error === 'object' && 'message' in error) {
      const { message } = error;
      if (typeof message === 'string') return message;
    }
  }
  return null;
}

function TastePreview({
  rows,
  dishes,
}: {
  rows: readonly TasteRow[];
  dishes: ReadonlyMap<string, DishCard>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chosen = tasteLines(rows)
    .map((line) => dishes.get(line.dishId))
    .filter((dish): dish is DishCard => Boolean(dish))
    .slice(0, 3);
  const key = chosen.map((dish) => dish.id).join(',');

  useMotion(
    (motion) => {
      if (!key) return;
      motion.from('[data-plate]:last-child', {
        scale: 0.8,
        opacity: 0,
        duration: motion.reduced ? 0.15 : 0.25,
        ease: 'back.out(1.4)',
      });
    },
    { scope: ref, dependencies: [key] },
  );

  return (
    <div
      ref={ref}
      aria-hidden
      className="relative hidden aspect-[540/431] flex-col items-center justify-center gap-4 rounded-3xl bg-neutral-7 lg:flex"
    >
      {chosen.length > 0 ? (
        <div className="flex items-center pl-6">
          {chosen.map((dish) => (
            <div key={dish.id} data-plate className="-ml-6">
              <DishPlate src={dish.image} sizes="160px" className="w-30 xl:w-40" />
            </div>
          ))}
        </div>
      ) : (
        <>
          <PlaceholderPlate className="w-30 xl:w-40" />
          <p className="text-body-5 text-neutral-3">Your picks show up here</p>
        </>
      )}
    </div>
  );
}

/**
 * "What's your taste?": pick dishes and quantities, see the subtotal, add them all to the cart.
 * Nothing else is asked for here. Availability is checked again on submit; a dish that sold out
 * in the meantime is left out and named.
 */
export function TastePicker({
  dishes,
  closedUntil,
}: {
  /** Orderable dishes, by cuisine. */
  dishes: DishCard[];
  /** Set when the store is closed: when it opens next. */
  closedUntil?: StoreMoment | null;
}) {
  const idPrefix = useId();
  const cart = useCartActions();
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const byId = new Map(dishes.map((dish) => [dish.id, dish]));
  const priceById = new Map(dishes.map((dish) => [dish.id, dish.priceCents]));
  const dishFieldId = (index: number) => `${idPrefix}-dish-${index}`;
  const hasDishes = dishes.length > 0;

  const form = useForm({
    defaultValues: { rows: [newTasteRow()] },
    validationLogic: revalidateLogic(),
    validators: { onDynamic: tastePickerSchema },
    onSubmitInvalid: () => {
      document.getElementById(dishFieldId(0))?.focus();
    },
    onSubmit: async ({ value, formApi }) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      setStatus(null);

      const lines = tasteLines(value.rows);
      const checked = await checkDishes(lines.map((line) => line.dishId));
      const added: { name: string; quantity: number }[] = [];
      const soldOut: string[] = [];
      for (const line of lines) {
        const name = byId.get(line.dishId)?.title ?? 'A dish';
        // Without an answer (offline, slow), add anyway: checkout checks again.
        const current = checked?.get(line.dishId);
        if (checked && !current?.isAvailable) {
          soldOut.push(name);
          continue;
        }
        cart.add({ menuItemId: line.dishId, quantity: line.quantity });
        added.push({ name, quantity: line.quantity });
      }

      const count = added.reduce((total, line) => total + line.quantity, 0);
      const parts = [
        count > 0 ? dishesAddedText(count) : null,
        soldOutText(soldOut),
        count > 0 && closedUntil
          ? `We're closed now. Your cart will keep these until we open at ${momentText(closedUntil)}.`
          : null,
      ].filter((part): part is string => Boolean(part));
      const text = parts.map((part) => (part.endsWith('.') ? part : `${part}.`)).join(' ');
      setStatus({ tone: count > 0 ? 'success' : 'error', text });
      announce(text);
      if (count > 0) formApi.reset();

      setTimeout(() => {
        busyRef.current = false;
        setBusy(false);
      }, COOL_DOWN_MS);
    },
  });

  // "Add another dish" and "Remove" move focus to the row that needs it next, once it is drawn.
  const focusDishField = (index: number) =>
    requestAnimationFrame(() => document.getElementById(dishFieldId(index))?.focus());

  const grouped = CUISINES.map((cuisine) => ({
    cuisine,
    dishes: dishes.filter((dish) => dish.cuisine === cuisine),
  })).filter((group) => group.dishes.length > 0);

  const errorId = `${idPrefix}-error`;

  return (
    <div className="lg:grid lg:grid-cols-[477fr_430fr] lg:items-center lg:gap-12 xl:grid-cols-[524fr_540fr] xl:gap-x-[105px] xl:px-24">
      <form
        noValidate
        aria-labelledby={`${idPrefix}-title`}
        className="mx-auto w-full max-w-[524px] lg:mx-0 lg:max-w-none"
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <h3 id={`${idPrefix}-title`} className="font-sans text-title-2 text-neutral-1">
          What&apos;s your taste?
        </h3>
        <p className="mt-1 text-body-4 text-neutral-3">
          Choose a few dishes. You can change them in your cart.
        </p>
        {hasDishes ? null : (
          <p className="mt-3 text-body-4 text-neutral-3">
            Nothing to choose from right now.{' '}
            <Link href="/menu" className="text-brand-strong underline underline-offset-4">
              See the menu
            </Link>
          </p>
        )}

        <form.Field name="rows" mode="array">
          {(rowsField) => (
            <>
              <ul className="mt-6 space-y-4">
                {rowsField.state.value.map((row, index) => (
                  <li
                    key={row.key}
                    className="flex flex-col gap-3 md:grid md:grid-cols-[1fr_7rem_2.75rem] md:items-end"
                  >
                    <form.Field name={`rows[${index}].dishId`}>
                      {(field) => {
                        const error = index === 0 ? errorText(field.state.meta.errors) : null;
                        return (
                          <div className="flex flex-col gap-1.5">
                            <Label
                              htmlFor={dishFieldId(index)}
                              className="text-body-4 font-normal text-neutral-2"
                            >
                              Dish {index + 1}
                              {index === 0 ? (
                                <span className="text-muted-foreground">(required)</span>
                              ) : null}
                            </Label>
                            <NativeSelect
                              id={dishFieldId(index)}
                              size="touch"
                              className="w-full"
                              value={field.state.value}
                              disabled={!hasDishes}
                              aria-invalid={error ? true : undefined}
                              aria-describedby={error ? errorId : undefined}
                              onChange={(event) => field.handleChange(event.target.value)}
                              onBlur={field.handleBlur}
                            >
                              <NativeSelectOption value="" disabled>
                                Choose a dish
                              </NativeSelectOption>
                              {grouped.map((group) => (
                                <NativeSelectOptGroup
                                  key={group.cuisine}
                                  label={CUISINE_LABELS[group.cuisine]}
                                >
                                  {group.dishes.map((dish) => (
                                    <NativeSelectOption key={dish.id} value={dish.id}>
                                      {dish.title} · {formatPrice(dish.priceCents)}
                                    </NativeSelectOption>
                                  ))}
                                </NativeSelectOptGroup>
                              ))}
                            </NativeSelect>
                            {error ? (
                              <p
                                id={errorId}
                                className="flex items-center gap-1.5 text-body-5 text-destructive"
                              >
                                <CircleExclamationPoint className="size-4 shrink-0" aria-hidden />
                                {error}
                              </p>
                            ) : null}
                          </div>
                        );
                      }}
                    </form.Field>
                    <div className="flex items-end gap-3 md:contents">
                      <form.Field name={`rows[${index}].quantity`}>
                        {(field) => (
                          <div className="flex w-28 flex-col gap-1.5">
                            <Label
                              htmlFor={`${idPrefix}-quantity-${index}`}
                              className="text-body-4 font-normal text-neutral-2"
                            >
                              How many<span className="sr-only">, dish {index + 1}</span>
                            </Label>
                            <NativeSelect
                              id={`${idPrefix}-quantity-${index}`}
                              size="touch"
                              className="w-full"
                              value={String(field.state.value)}
                              disabled={!hasDishes}
                              onChange={(event) => field.handleChange(Number(event.target.value))}
                              onBlur={field.handleBlur}
                            >
                              {QUANTITIES.map((quantity) => (
                                <NativeSelectOption key={quantity} value={quantity}>
                                  {quantity}
                                </NativeSelectOption>
                              ))}
                            </NativeSelect>
                          </div>
                        )}
                      </form.Field>
                      {rowsField.state.value.length > 1 ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-touch"
                          aria-label={`Remove dish ${index + 1}`}
                          onClick={() => {
                            rowsField.removeValue(index);
                            focusDishField(Math.max(0, index - 1));
                          }}
                          className="text-neutral-3 hover:bg-neutral-7"
                        >
                          <Trash className="size-5" aria-hidden />
                        </Button>
                      ) : (
                        <span aria-hidden className="hidden md:block" />
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              <Button
                type="button"
                variant="ghost"
                size="touch"
                disabled={!hasDishes}
                onClick={() => {
                  const next = rowsField.state.value.length;
                  rowsField.pushValue(newTasteRow());
                  focusDishField(next);
                }}
                className="mt-2 -ml-4 text-brand-strong hover:bg-brand-soft hover:text-brand-strong"
              >
                <Plus className="size-4" aria-hidden />
                Add another dish
              </Button>
            </>
          )}
        </form.Field>

        <form.Subscribe selector={(state) => state.values.rows}>
          {(rows) => (
            <p className="mt-6 flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="text-body-4 text-neutral-3">Subtotal</span>
              <output
                htmlFor={rows
                  .map((_, index) => `${dishFieldId(index)} ${idPrefix}-quantity-${index}`)
                  .join(' ')}
                className="font-heading text-title-2 text-brand-strong tabular-nums"
              >
                {formatPrice(tasteSubtotalCents(rows, priceById))}
              </output>
              <span className="text-caption text-muted-foreground">Before delivery and tax</span>
            </p>
          )}
        </form.Subscribe>

        <Button
          type="submit"
          size="touch"
          disabled={!hasDishes}
          aria-disabled={busy || undefined}
          className="mt-8 w-full uppercase md:w-auto md:min-w-[220px]"
        >
          Add to cart
        </Button>
        <p
          className={cn(
            'mt-3 flex min-h-6 items-start gap-1.5 text-body-5',
            status?.tone === 'error' ? 'text-destructive' : 'text-brand-strong',
          )}
        >
          {status?.tone === 'success' ? (
            <Check className="mt-0.5 size-4 shrink-0" aria-hidden />
          ) : null}
          {status?.text}
        </p>
      </form>

      <form.Subscribe selector={(state) => state.values.rows}>
        {(rows) => <TastePreview rows={rows} dishes={byId} />}
      </form.Subscribe>
    </div>
  );
}
