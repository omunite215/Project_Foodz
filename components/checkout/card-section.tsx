'use client';

import { Check, Clock, Copy, CreditCard, FlaskConical, Plus } from 'lucide-react';
import Link from 'next/link';
import { type Ref, useEffect, useId, useState } from 'react';
import type { SavedCardDto } from '@/server/modules/payments/schema';
import { CheckboxRow } from '@/components/forms/choice-chips';
import { Button } from '@/components/ui/button';
import { announce } from '@/lib/announce';
import { TEST_CARD_NUMBER, TEST_MODE_NOTE } from '@/lib/checkout-text';
import { RadioCard } from './radio-card';
import { type CardFieldsHandle, type CardFormStatus, StripeCardFields } from './stripe-card';

/*
 * The card part of "Payment" (F4 design 2.13): saved cards (most recently used first), "Use a new
 * card" with Stripe's fields, "Save this card for next time" (unticked, U4), the test-mode note
 * and "Manage saved cards". Also the order page's "Finish paying" step.
 */

export const NEW_CARD = 'new';

/** "Visa •••• 4242" on screen, "Visa ending in 4242" to a screen reader. */
export function CardName({ card }: { card: Pick<SavedCardDto, 'label' | 'spoken'> }) {
  return (
    <>
      <span aria-hidden>{card.label}</span>
      <span className="sr-only">{card.spoken}</span>
    </>
  );
}

/** The expired chip: "Expired 08/26" (S6.12). */
export function ExpiredChip({ expiry }: { expiry: string }) {
  return (
    <span className="mt-1 inline-flex h-6 items-center gap-1 rounded-md bg-tag-4-bg px-2 text-caption font-medium text-neutral-1">
      <Clock className="size-3 text-destructive" aria-hidden />
      Expired {expiry}
    </span>
  );
}

/** "Copy test card number", then "Copied" for 3 s (design 2.13 d). */
function CopyTestCard() {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), 3000);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={() => {
        void (async () => {
          try {
            await navigator.clipboard.writeText(TEST_CARD_NUMBER.replaceAll(' ', ''));
            setCopied(true);
            announce('Test card number copied');
          } catch {
            // Clipboard blocked: the number is in the note above.
          }
        })();
      }}
      className="-ml-2 h-11 px-2 text-button-2 font-medium text-neutral-1 underline underline-offset-4 hover:bg-white/60"
    >
      {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
      {copied ? 'Copied' : 'Copy test card number'}
    </Button>
  );
}

export interface CardSectionProps {
  savedCards: readonly SavedCardDto[];
  savedCardLimit: number;
  /** A saved card's id, or NEW_CARD. */
  choice: string;
  onChoice: (choice: string) => void;
  saveCard: boolean;
  onSaveCard: (save: boolean) => void;
  publishableKey: string;
  testMode: boolean;
  demo: boolean;
  fieldsRef: Ref<CardFieldsHandle>;
  formAttempt: number;
  onFormStatus: (status: CardFormStatus) => void;
  onFocusChange?: (focused: boolean) => void;
  /** Remove an expired card (opens the remove dialog). */
  onRemoveCard?: (card: SavedCardDto, button: HTMLButtonElement) => void;
  /** Ids prefix (checkout and the order page's payment step). */
  idPrefix?: string;
  /** Hide "Save this card" (the demo account). */
  allowSave?: boolean;
}

export function CardSection({
  savedCards,
  savedCardLimit,
  choice,
  onChoice,
  saveCard,
  onSaveCard,
  publishableKey,
  testMode,
  demo,
  fieldsRef,
  formAttempt,
  onFormStatus,
  onFocusChange,
  onRemoveCard,
  idPrefix = 'card',
  allowSave = true,
}: CardSectionProps) {
  const id = useId();
  const cards = demo ? [] : savedCards;
  const newCard = cards.length === 0 || choice === NEW_CARD;
  const atLimit = cards.length >= savedCardLimit;

  return (
    <div className="mt-6">
      {cards.length > 0 ? (
        <fieldset className="mb-6 min-w-0">
          <legend className="mb-2 text-body-4 text-neutral-3">Saved cards</legend>
          <div className="space-y-3">
            {cards.map((card) => (
              <RadioCard
                key={card.id}
                name={`${idPrefix}-saved-card`}
                value={card.id}
                checked={choice === card.id}
                disabled={card.expired}
                onChange={onChoice}
                icon={CreditCard}
                label={
                  card.expired
                    ? `${card.spoken}, expired ${card.expiry}`
                    : `${card.spoken}, expires ${card.expiry}`
                }
                labelClassName="min-h-14"
                beside={
                  card.expired && onRemoveCard ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="touch"
                      onClick={(event) => onRemoveCard(card, event.currentTarget)}
                      className="mr-2 self-center px-3 text-button-2 font-medium text-destructive hover:bg-neutral-7 hover:text-destructive"
                    >
                      Remove<span className="sr-only"> {card.spoken}</span>
                    </Button>
                  ) : undefined
                }
              >
                <span className="block text-body-4 font-medium text-neutral-1">
                  <CardName card={card} />
                </span>
                {card.expired ? (
                  <ExpiredChip expiry={card.expiry} />
                ) : (
                  <span className="mt-0.5 block text-body-5 text-neutral-3">
                    Expires {card.expiry}
                  </span>
                )}
              </RadioCard>
            ))}
            <RadioCard
              name={`${idPrefix}-saved-card`}
              value={NEW_CARD}
              checked={choice === NEW_CARD}
              onChange={onChoice}
              icon={Plus}
              labelClassName="min-h-14 items-center"
            >
              <span className="block text-body-4 font-medium text-neutral-1">Use a new card</span>
            </RadioCard>
          </div>
        </fieldset>
      ) : null}

      <div className={newCard ? undefined : 'hidden'}>
        <StripeCardFields
          publishableKey={publishableKey}
          disabled={demo}
          attempt={formAttempt}
          onStatus={onFormStatus}
          onFocusChange={onFocusChange}
          handleRef={fieldsRef}
          idPrefix={idPrefix}
        />
        {allowSave && !demo ? (
          atLimit ? (
            <p className="mt-4 text-body-5 text-neutral-3">
              You have {savedCardLimit} saved cards. Remove one in{' '}
              <Link href="/account/cards" className="font-medium text-neutral-1 underline">
                Saved cards
              </Link>{' '}
              to save another.
            </p>
          ) : (
            <div className="mt-4">
              <CheckboxRow
                id={`${id}-save-card`}
                label="Save this card for next time"
                checked={saveCard}
                onChange={onSaveCard}
              />
            </div>
          )
        ) : null}
      </div>

      {testMode ? (
        <div className="mt-4 rounded-xl bg-tag-3-bg p-3">
          <p className="flex items-start gap-2 text-body-5 text-neutral-1">
            <FlaskConical className="mt-0.5 size-4 shrink-0 text-tag-3" aria-hidden />
            {TEST_MODE_NOTE}
          </p>
          <div className="mt-1 pl-6">
            <CopyTestCard />
          </div>
        </div>
      ) : null}

      {cards.length > 0 ? (
        <Link
          href="/account/cards"
          className="mt-2 inline-flex h-11 items-center text-button-2 font-medium text-brand-strong underline-offset-4 hover:underline"
        >
          Manage saved cards
        </Link>
      ) : null}
    </div>
  );
}
