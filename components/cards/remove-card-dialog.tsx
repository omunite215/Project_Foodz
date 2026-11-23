'use client';

import { useState } from 'react';
import { removeSavedCardAction } from '@/server/modules/payments/actions';
import type { SavedCardDto } from '@/server/modules/payments/schema';
import { FormAlert } from '@/components/forms/form-alert';
import { SubmitButton } from '@/components/forms/submit-button';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { callAction } from '@/lib/action-result';

/*
 * "Remove Visa •••• 4242?" (F4 design 5.3): on the saved cards page and for an expired card at
 * checkout. "Keep it" is the first focus. A card that is no longer hers answers "not found": the
 * list refreshes and the row goes.
 */

export const REMOVE_FAILED = "We couldn't remove this card. Try again in a moment.";

export type RemoveOutcome = 'removed' | 'gone';

export function RemoveCardDialog({
  card,
  onClose,
  onRemoved,
  onCloseFocus,
}: {
  card: SavedCardDto | null;
  onClose: () => void;
  onRemoved: (card: SavedCardDto, outcome: RemoveOutcome) => void;
  /** Where focus goes when it closes without removing. */
  onCloseFocus?: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [removed, setRemoved] = useState(false);

  async function remove() {
    if (!card || pending) return;
    setPending(true);
    setFailed(false);
    const outcome = await callAction(() => removeSavedCardAction({ paymentMethodId: card.id }));
    setPending(false);
    if (outcome.ok || outcome.error.code === 'NOT_FOUND') {
      setRemoved(true);
      onRemoved(card, outcome.ok ? 'removed' : 'gone');
      return;
    }
    setFailed(true);
  }

  return (
    <AlertDialog
      open={card !== null}
      onOpenChange={(open) => {
        if (!open && !pending) {
          setFailed(false);
          onClose();
        }
      }}
    >
      <AlertDialogContent
        onCloseAutoFocus={(event) => {
          if (removed) {
            event.preventDefault();
            setRemoved(false);
            return;
          }
          if (onCloseFocus) {
            event.preventDefault();
            onCloseFocus();
          }
        }}
      >
        <AlertDialogTitle>
          <span aria-hidden>Remove {card?.label}?</span>
          <span className="sr-only">Remove {card?.spoken}?</span>
        </AlertDialogTitle>
        <AlertDialogDescription>
          You&apos;ll need to type it again the next time you pay with it.
        </AlertDialogDescription>
        {failed ? (
          <FormAlert variant="error" className="mt-4">
            {REMOVE_FAILED}
          </FormAlert>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <SubmitButton
            type="button"
            variant="danger"
            pending={pending}
            pendingLabel="Removing…"
            onClick={() => {
              void remove();
            }}
          >
            Remove card
          </SubmitButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
