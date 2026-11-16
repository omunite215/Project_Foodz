'use client';

import { Check, CircleExclamationPoint } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import type { StoreMoment } from '@/server/modules/menu/schema';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { announce } from '@/lib/announce';
import { MAX_NOTE_LENGTH, useCartActions } from '@/lib/data/cart';
import { formatPrice, momentText } from '@/lib/format';
import { cn } from '@/lib/utils';
import { checkDishes } from './check-dishes';

const MAX_FLAVORS = 5;
/** The availability check gets this long before the button says "Adding…". */
const PENDING_AFTER_MS = 300;
/** A second press this soon after adding is ignored. */
const REPEAT_GUARD_MS = 1000;
const ADDED_FOR_MS = 2000;

type Phase = 'ready' | 'pending' | 'added';

interface Message {
  tone: 'success' | 'error';
  text: string;
  /** Errors interrupt (role="alert"); the rest stay quiet (the live region speaks for them). */
  alert?: boolean;
}

export interface DishOrderPanelProps {
  dish: {
    id: string;
    title: string;
    priceCents: number;
    flavors: string[];
    isAvailable: boolean;
  };
  /** Set when the store is closed: when it opens next. Adding stays allowed. */
  closedUntil?: StoreMoment | null;
  /** Sold out: are other dishes suggested below? */
  hasSuggestions?: boolean;
}

/**
 * Extra flavors, a note for the kitchen and "Add to cart". The dish is checked again just
 * before it is added; if it has just sold out nothing is added and the page switches to its
 * sold-out state.
 */
export function DishOrderPanel({ dish, closedUntil, hasSuggestions = false }: DishOrderPanelProps) {
  const id = useId();
  const router = useRouter();
  const cart = useCartActions();
  const [flavors, setFlavors] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [phase, setPhase] = useState<Phase>('ready');
  const [message, setMessage] = useState<Message | null>(null);
  const [justSoldOut, setJustSoldOut] = useState(false);
  const locked = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const later = (ms: number, run: () => void) => {
    timers.current.push(setTimeout(run, ms));
  };

  const soldOut = !dish.isAvailable || justSoldOut;
  const closedText = closedUntil
    ? `We're closed now. Your cart will keep this until we open at ${momentText(closedUntil)}.`
    : null;
  const flavorsFull = flavors.length >= MAX_FLAVORS;
  const charactersLeft = MAX_NOTE_LENGTH - note.length;

  const add = async () => {
    if (locked.current || soldOut) return;
    locked.current = true;
    setMessage(null);
    const pending = setTimeout(() => setPhase('pending'), PENDING_AFTER_MS);

    const checked = await checkDishes([dish.id]);
    clearTimeout(pending);

    // No answer in time (offline, slow): add anyway, checkout checks again.
    if (checked && !checked.get(dish.id)?.isAvailable) {
      setPhase('ready');
      setJustSoldOut(true);
      setMessage({
        tone: 'error',
        alert: true,
        text: `Sorry, ${dish.title} just sold out. Nothing was added to your cart.`,
      });
      locked.current = false;
      router.refresh();
      return;
    }

    cart.add({ menuItemId: dish.id, flavors, note, quantity: 1 });
    setPhase('added');
    setMessage({
      tone: 'success',
      text: closedText ? `Added to your cart. ${closedText}` : 'Added to your cart.',
    });
    announce(`${dish.title} added to your cart.`);
    later(REPEAT_GUARD_MS, () => {
      locked.current = false;
    });
    later(ADDED_FOR_MS, () => setPhase('ready'));
  };

  const soldOutLine =
    soldOut && !message ? (
      <>
        Sold out today.{' '}
        {hasSuggestions ? (
          'Try one of these instead.'
        ) : (
          <Link href="/menu" className="text-brand-strong underline underline-offset-4">
            Back to the menu
          </Link>
        )}
      </>
    ) : null;

  return (
    <div>
      {dish.flavors.length > 0 ? (
        <div className="mt-4">
          <h2 id={`${id}-flavors`} className="text-body-4 text-neutral-3">
            Extra flavor
          </h2>
          <p id={`${id}-flavors-help`} className="text-body-5 text-muted-foreground">
            {flavorsFull
              ? 'You can pick up to 5.'
              : 'Optional. Pick what you’d like more of (up to 5).'}
          </p>
          <ToggleGroup
            type="multiple"
            value={flavors}
            onValueChange={(value) => setFlavors(value.slice(0, MAX_FLAVORS))}
            aria-labelledby={`${id}-flavors`}
            aria-describedby={`${id}-flavors-help`}
            disabled={soldOut}
            className="mt-2 w-full flex-wrap justify-start"
          >
            {dish.flavors.map((flavor) => {
              const on = flavors.includes(flavor);
              return (
                <ToggleGroupItem
                  key={flavor}
                  value={flavor}
                  disabled={soldOut || (flavorsFull && !on)}
                  className="h-11 rounded-lg border border-input bg-white px-4 text-body-5 font-normal text-neutral-2 hover:bg-neutral-7 aria-pressed:border-2 aria-pressed:border-brand-strong aria-pressed:bg-brand-soft aria-pressed:text-neutral-1 data-[state=on]:bg-brand-soft"
                >
                  {on ? <Check className="size-4" aria-hidden /> : null}
                  {flavor}
                </ToggleGroupItem>
              );
            })}
          </ToggleGroup>
        </div>
      ) : null}

      <div className="mt-4">
        <Label htmlFor={`${id}-note`} className="text-body-4 font-normal text-neutral-3">
          Note for the kitchen
        </Label>
        <Textarea
          id={`${id}-note`}
          value={note}
          maxLength={MAX_NOTE_LENGTH}
          disabled={soldOut}
          placeholder="No onions, extra sauce…"
          onChange={(event) => setNote(event.target.value)}
          className="mt-1 min-h-[114px] rounded-xl bg-white px-5 py-2.5 text-body-4 disabled:bg-neutral-7 md:text-body-4"
        />
        <p aria-hidden className="mt-1 text-right text-caption text-muted-foreground tabular-nums">
          {note.length}/{MAX_NOTE_LENGTH}
        </p>
        <p aria-live="polite" className="sr-only">
          {charactersLeft <= 20 ? `${charactersLeft} characters left` : ''}
        </p>
      </div>

      <div className="mt-8 xl:mt-14">
        <Button
          type="button"
          size="touch"
          disabled={soldOut}
          aria-disabled={phase === 'pending' || undefined}
          onClick={() => void add()}
          className="w-full uppercase disabled:bg-neutral-6 disabled:text-neutral-3 disabled:opacity-100 md:w-auto md:min-w-[220px]"
        >
          {phase === 'pending' ? (
            <>
              <Spinner className="size-4 motion-reduce:animate-none" />
              Adding…
            </>
          ) : phase === 'added' ? (
            <>
              <Check className="size-4" aria-hidden />
              Added
            </>
          ) : (
            <>Add to cart · {formatPrice(dish.priceCents)}</>
          )}
        </Button>
        <div className="mt-3 min-h-6 text-body-5">
          {/* Present from the start, so a message put into it is announced at once. */}
          <div role="alert">
            {message?.alert ? (
              <p className="flex items-start gap-1.5 text-destructive">
                <CircleExclamationPoint className="mt-0.5 size-4 shrink-0" aria-hidden />
                {message.text}
              </p>
            ) : null}
          </div>
          {message?.alert ? null : (
            <p
              className={cn(
                'flex items-start gap-1.5',
                message?.tone === 'success' ? 'text-brand-strong' : 'text-neutral-3',
              )}
            >
              {message?.tone === 'success' ? (
                <Check className="mt-0.5 size-4 shrink-0" aria-hidden />
              ) : null}
              <span>{message?.text ?? soldOutLine ?? closedText}</span>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
