'use client';

import { CreditCard, Lock, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import type { SavedCardDto, SavedCardsPage } from '@/server/modules/payments/schema';
import { CardName, ExpiredChip } from '@/components/checkout/card-section';
import { FormAlert } from '@/components/forms/form-alert';
import { Button } from '@/components/ui/button';
import { announce } from '@/lib/announce';
import { useOnline } from '@/lib/use-online';
import { RemoveCardDialog } from './remove-card-dialog';

/*
 * /account/cards (F4 design 5, S6.12 to S6.14): the cards saved at Stripe, brand, last 4 and
 * expiry only. Removal is confirmed in a dialog; focus then moves to the next card's Remove.
 */

function Quiet({ children }: { children: string }) {
  return (
    <p className="flex items-center gap-2 text-body-5 text-neutral-3">
      <Lock className="size-4 shrink-0" aria-hidden />
      {children}
    </p>
  );
}

export function SavedCardRow({
  card,
  onRemove,
  offline = false,
  buttonRef,
}: {
  card: SavedCardDto;
  onRemove: (card: SavedCardDto) => void;
  offline?: boolean;
  buttonRef?: (element: HTMLButtonElement | null) => void;
}) {
  return (
    <li className="flex items-center gap-4 py-4 first:pt-0 last:pb-0">
      <span
        aria-hidden
        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-neutral-7"
      >
        <CreditCard className="size-5 text-neutral-2" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-body-4 font-medium text-neutral-1 [overflow-wrap:anywhere]">
          <CardName card={card} />
        </p>
        {card.expired ? (
          <ExpiredChip expiry={card.expiry} />
        ) : (
          <p className="mt-0.5 text-body-5 text-neutral-3">Expires {card.expiry}</p>
        )}
      </div>
      <div className="flex flex-col items-end">
        <Button
          ref={buttonRef}
          type="button"
          variant="ghost"
          size="touch"
          aria-disabled={offline || undefined}
          onClick={() => {
            if (offline) {
              announce("You're offline.");
              return;
            }
            onRemove(card);
          }}
          className="px-3 text-button-2 font-medium text-destructive hover:bg-neutral-7 hover:text-destructive"
        >
          <Trash2 className="hidden size-4 md:block" aria-hidden />
          Remove<span className="sr-only"> {card.spoken}</span>
        </Button>
        {offline ? <span className="text-caption text-neutral-3">You&apos;re offline.</span> : null}
      </div>
    </li>
  );
}

export function SavedCards({ page }: { page: SavedCardsPage }) {
  const router = useRouter();
  const online = useOnline();
  const [cards, setCards] = useState<SavedCardDto[]>(page.state === 'ok' ? page.cards : []);
  const [removing, setRemoving] = useState<SavedCardDto | null>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const emptyRef = useRef<HTMLHeadingElement>(null);
  const opener = useRef<string | null>(null);

  if (page.state === 'demo') {
    return (
      <div className="mt-8 rounded-2xl border border-neutral-6 bg-white p-5 md:p-6">
        <Quiet>The demo account can&apos;t save cards.</Quiet>
      </div>
    );
  }
  if (page.state === 'notConfigured') {
    return (
      <div className="mt-8 rounded-2xl border border-neutral-6 bg-white p-5 md:p-6">
        <Quiet>
          Card payments aren&apos;t set up on this computer, so there are no saved cards.
        </Quiet>
      </div>
    );
  }
  if (page.state === 'unavailable') {
    return (
      <FormAlert
        variant="error"
        className="mt-8"
        action={
          <Button
            type="button"
            variant="outline"
            size="touch"
            className="bg-white"
            onClick={() => router.refresh()}
          >
            Try again
          </Button>
        }
      >
        We couldn&apos;t load your saved cards. Try again in a moment.
      </FormAlert>
    );
  }

  const removed = (card: SavedCardDto, outcome: 'removed' | 'gone') => {
    const index = cards.findIndex((item) => item.id === card.id);
    const rest = cards.filter((item) => item.id !== card.id);
    const next = rest[index] ?? rest[index - 1] ?? null;
    setCards(rest);
    setRemoving(null);
    announce(outcome === 'removed' ? 'Card removed' : 'That card is no longer saved.');
    if (outcome === 'gone') router.refresh();
    requestAnimationFrame(() => {
      const target = next ? buttons.current.get(next.id) : null;
      if (target) target.focus();
      else if (rest.length === 0) emptyRef.current?.focus();
      else document.querySelector<HTMLHeadingElement>('main h1')?.focus();
    });
  };

  return (
    <div className="mt-8 rounded-2xl border border-neutral-6 bg-white p-5 md:p-6">
      {cards.length === 0 ? (
        <div className="flex flex-col items-center py-10 text-center">
          <span
            aria-hidden
            className="flex size-12 items-center justify-center rounded-full bg-neutral-7"
          >
            <CreditCard className="size-6 text-neutral-3" />
          </span>
          <h2
            ref={emptyRef}
            tabIndex={-1}
            className="mt-4 text-body-3 font-semibold text-neutral-1 focus:outline-none"
          >
            No saved cards
          </h2>
          <p className="mt-1 text-body-5 text-neutral-3">
            Check &lsquo;Save this card for next time&rsquo; at checkout to pay faster.
          </p>
        </div>
      ) : (
        <ul aria-label="Saved cards" className="divide-y divide-neutral-6">
          {cards.map((card) => (
            <SavedCardRow
              key={card.id}
              card={card}
              offline={!online}
              onRemove={(chosen) => {
                opener.current = chosen.id;
                setRemoving(chosen);
              }}
              buttonRef={(element) => {
                if (element) buttons.current.set(card.id, element);
                else buttons.current.delete(card.id);
              }}
            />
          ))}
        </ul>
      )}
      <RemoveCardDialog
        card={removing}
        onClose={() => setRemoving(null)}
        onRemoved={removed}
        onCloseFocus={() => {
          if (opener.current) buttons.current.get(opener.current)?.focus();
        }}
      />
    </div>
  );
}
