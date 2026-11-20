'use client';

import { Check, CircleExclamationPoint } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { StoreMoment } from '@/server/modules/menu/schema';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { announce } from '@/lib/announce';
import { openCart } from '@/lib/cart-dialog';
import { cartFullText, lineFullText } from '@/lib/cart-text';
import { useCartActions } from '@/lib/data/cart';
import { useCartDishActions } from '@/lib/data/cart-dishes';
import { formatPrice, momentText } from '@/lib/format';
import { cn } from '@/lib/utils';
import { checkDishes } from './check-dishes';
import { FlavorToggles } from './flavor-toggles';
import { KitchenNote } from './kitchen-note';

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
  /** Offer "View cart" after it (F3 S1.4, S1.11). */
  viewCart?: boolean;
  /** The store's number, as a tel: link inside the text (S1.12). */
  phone?: { display: string; tel: string } | null;
}

export interface DishOrderPanelProps {
  dish: {
    id: string;
    title: string;
    slug: string;
    image: string | null;
    priceCents: number;
    flavors: string[];
    isAvailable: boolean;
  };
  /** Set when the store is closed: when it opens next. Adding stays allowed. */
  closedUntil?: StoreMoment | null;
  /** Sold out: are other dishes suggested below? */
  hasSuggestions?: boolean;
  /** For "Your cart is full … call us on (617) 555-0142." */
  phone?: { display: string; tel: string } | null;
}

/** The message text, with the store's number as a link when it has one. */
function MessageText({ message }: { message: Message }) {
  const phone = message.phone;
  if (!phone || !message.text.includes(phone.display)) return <>{message.text}</>;
  const [before, after] = message.text.split(phone.display);
  return (
    <>
      {before}
      <a href={`tel:${phone.tel}`} className="font-medium text-neutral-1 underline">
        {phone.display}
      </a>
      {after}
    </>
  );
}

/**
 * Extra flavors, a note for the kitchen and "Add to cart". The dish is checked again just
 * before it is added; if it has just sold out nothing is added and the page switches to its
 * sold-out state. The cart doesn't open by itself: "View cart" opens it (F3 S1.4).
 */
export function DishOrderPanel({
  dish,
  closedUntil,
  hasSuggestions = false,
  phone = null,
}: DishOrderPanelProps) {
  const router = useRouter();
  const cart = useCartActions();
  const cartDishes = useCartDishActions();
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

    const outcome = cart.add({ menuItemId: dish.id, flavors, note, quantity: 1 });
    if (outcome.kind !== 'added') {
      // Nothing was added: the button never says "Added" (S1.11, S1.12).
      setPhase('ready');
      const text =
        outcome.kind === 'lineFull'
          ? lineFullText(dish.title)
          : cartFullText(outcome.limit, phone?.display ?? null);
      setMessage({ tone: 'error', text, viewCart: true, phone });
      announce(text);
      later(REPEAT_GUARD_MS, () => {
        locked.current = false;
      });
      return;
    }

    cartDishes.remember({
      id: dish.id,
      title: dish.title,
      slug: dish.slug,
      image: dish.image,
      priceCents: checked?.get(dish.id)?.priceCents ?? dish.priceCents,
    });
    setPhase('added');
    setMessage({
      tone: 'success',
      text: closedText ? `Added to your cart. ${closedText}` : 'Added to your cart.',
      viewCart: true,
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

  const viewCart = message?.viewCart ? (
    <button
      type="button"
      onClick={(event) => openCart(event.currentTarget)}
      className="ml-2 inline-flex h-11 items-center font-medium text-brand-strong underline underline-offset-4"
    >
      View cart
    </button>
  ) : null;

  return (
    <div>
      <FlavorToggles
        flavors={dish.flavors}
        value={flavors}
        onChange={setFlavors}
        disabled={soldOut}
        className="mt-4"
      />

      <KitchenNote
        value={note}
        onChange={setNote}
        disabled={soldOut}
        placeholder="No onions, extra sauce…"
        className="mt-4"
        textareaClassName="min-h-[114px]"
      />

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
          ) : soldOut ? (
            'Sold out'
          ) : (
            <>Add to cart · {formatPrice(dish.priceCents)}</>
          )}
        </Button>
        <div className={cn('mt-3 text-body-5', viewCart ? 'min-h-11' : 'min-h-6')}>
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
                'flex flex-wrap items-center gap-x-1.5',
                message?.tone === 'success'
                  ? 'text-brand-strong'
                  : message?.tone === 'error'
                    ? 'text-destructive'
                    : 'text-neutral-3',
              )}
            >
              {message?.tone === 'success' ? (
                <Check className="size-4 shrink-0" aria-hidden />
              ) : message?.tone === 'error' ? (
                <CircleExclamationPoint className="size-4 shrink-0" aria-hidden />
              ) : null}
              <span>
                {message ? <MessageText message={message} /> : (soldOutLine ?? closedText)}
              </span>
              {viewCart}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
