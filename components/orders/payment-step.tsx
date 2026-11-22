'use client';

import { Clock } from 'lucide-react';
import { useRef, useState } from 'react';
import { orderStatusAction, resumePaymentAction } from '@/server/modules/orders/actions';
import type { OrderView } from '@/server/modules/orders/schema';
import { cardPausedMessage, declineMessage } from '@/server/modules/orders/text';
import type { SavedCardDto } from '@/server/modules/payments/schema';
import { CardSection, NEW_CARD } from '@/components/checkout/card-section';
import { type PaymentAlertState, PaymentAlert } from '@/components/checkout/payment-method';
import {
  getStripe,
  type CardFieldsHandle,
  type CardFormStatus,
} from '@/components/checkout/stripe-card';
import { SubmitButton } from '@/components/forms/submit-button';
import { Button } from '@/components/ui/button';
import { callAction } from '@/lib/action-result';
import { announce } from '@/lib/announce';
import { CARD_FORM_FAILED, payButtonLabel, SLOW_PRESS } from '@/lib/checkout-text';
import { confirmCard } from '@/lib/confirm-card';

/*
 * "Finish paying" (F4 design 3.10, D38): the checkout card section for this order's amount. Card
 * only; switching to cash means cancelling and ordering again. A decline here ends the order as
 * failed (U2); success turns the page into Confirming, then Placed.
 */

export interface PaymentStepProps {
  view: OrderView;
  savedCards: readonly SavedCardDto[];
  savedCardLimit: number;
  publishableKey: string;
  testMode: boolean;
  /** Stripe took the payment: the page confirms it. */
  onPaid: () => void;
  /** The order changed (declined, expired, paid elsewhere): show its new state. */
  onChanged: (view: OrderView | null) => void;
}

export function PaymentStep({
  view,
  savedCards,
  savedCardLimit,
  publishableKey,
  testMode,
  onPaid,
  onChanged,
}: PaymentStepProps) {
  const firstCard = savedCards.find((card) => !card.expired)?.id ?? NEW_CARD;
  const [choice, setChoice] = useState(firstCard);
  const [saveCard, setSaveCard] = useState(false);
  const [formStatus, setFormStatus] = useState<CardFormStatus>('loading');
  const [formAttempt, setFormAttempt] = useState(0);
  const [phase, setPhase] = useState<'idle' | 'paying' | 'bank'>('idle');
  const [alert, setAlert] = useState<PaymentAlertState | null>(null);
  const fields = useRef<CardFieldsHandle>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const newCard = savedCards.length === 0 || choice === NEW_CARD;
  const busy = phase !== 'idle';

  const say = (state: PaymentAlertState, text: string) => {
    setAlert(state);
    announce(text);
    requestAnimationFrame(() => alertRef.current?.focus());
  };

  async function pay() {
    if (busy) return;
    setAlert(null);
    if (newCard && !fields.current?.check()) return;
    setPhase('paying');
    const outcome = await callAction(() =>
      resumePaymentAction({
        orderId: view.id,
        card: newCard
          ? { kind: 'new', save: saveCard }
          : { kind: 'saved', paymentMethodId: choice },
      }),
    );
    if (!outcome.ok) {
      setPhase('idle');
      const error = outcome.error;
      if (error.code === 'CARD_PAUSED' && typeof error.details?.until === 'string') {
        const text = cardPausedMessage(error.details.until, view.store.timeZone);
        say({ key: 'paused', variant: 'warning', icon: Clock, text }, text);
        return;
      }
      if (error.code === 'ORDER_NOT_PAYABLE') {
        onChanged(null);
        return;
      }
      say({ key: 'refused', variant: 'error', text: error.message }, error.message);
      return;
    }
    if (outcome.data.kind === 'paid') {
      onPaid();
      return;
    }
    const stripe = newCard
      ? fields.current?.stripe()
      : await getStripe(publishableKey).catch(() => null);
    const element = fields.current?.cardNumber() ?? null;
    const method = newCard
      ? element
        ? { card: element, name: view.contact.name }
        : null
      : { savedCardId: choice };
    if (!stripe || !method) {
      setPhase('idle');
      say({ key: 'slow', variant: 'info', text: SLOW_PRESS }, SLOW_PRESS);
      onChanged(null);
      return;
    }
    const result = await confirmCard({
      stripe,
      clientSecret: outcome.data.clientSecret,
      method,
      onBankCheck: () => setPhase('bank'),
    });
    if (result.kind === 'succeeded') {
      void callAction(() => orderStatusAction({ orderId: view.id, confirmed: true }));
      onPaid();
      return;
    }
    if (result.kind === 'unreachable') {
      setPhase('idle');
      say({ key: 'slow', variant: 'info', text: SLOW_PRESS }, SLOW_PRESS);
      onChanged(null);
      return;
    }
    // Declined: the order ends as failed and the page says why (U2).
    const status = await callAction(() => orderStatusAction({ orderId: view.id, confirmed: true }));
    setPhase('idle');
    const card = newCard ? null : savedCards.find((item) => item.id === choice);
    const text = declineMessage(
      { code: result.code, declineCode: result.declineCode },
      card?.label,
    );
    announce(card ? text.replace(card.label, card.spoken) : text);
    if (status.ok) onChanged(status.data);
    else say({ key: 'decline', variant: 'error', text }, text);
  }

  const formFailed = newCard && formStatus === 'failed';
  const loadingForm = newCard && formStatus === 'loading';

  return (
    <section
      aria-labelledby="finish-paying-title"
      className="mt-6 rounded-2xl border border-neutral-6 bg-white p-5 md:p-6"
    >
      <h2 id="finish-paying-title" className="text-body-2 font-semibold text-neutral-1">
        Finish paying
      </h2>
      <PaymentAlert
        alertRef={alertRef}
        alert={
          formFailed
            ? {
                key: 'form',
                variant: 'error',
                text: CARD_FORM_FAILED,
                action: (
                  <Button
                    type="button"
                    variant="outline"
                    size="touch"
                    className="bg-white"
                    onClick={() => setFormAttempt((count) => count + 1)}
                  >
                    Try again
                  </Button>
                ),
              }
            : alert
        }
      />
      <div inert={busy}>
        <CardSection
          savedCards={savedCards}
          savedCardLimit={savedCardLimit}
          choice={choice}
          onChoice={(next) => {
            setChoice(next);
            setAlert(null);
          }}
          saveCard={saveCard}
          onSaveCard={setSaveCard}
          publishableKey={publishableKey}
          testMode={testMode}
          demo={false}
          fieldsRef={fields}
          formAttempt={formAttempt}
          onFormStatus={setFormStatus}
          idPrefix="finish"
        />
      </div>
      <SubmitButton
        type="button"
        pending={busy}
        pendingLabel={phase === 'bank' ? 'Waiting for your bank…' : 'Paying…'}
        blocked={loadingForm || formFailed}
        onBlockedPress={() =>
          announce(formFailed ? 'Load the card form first.' : 'Loading card form…')
        }
        onClick={() => {
          void pay();
        }}
        className="mt-6 w-full uppercase"
      >
        {loadingForm ? 'Loading card form…' : payButtonLabel('card', view.breakdown.totalCents)}
      </SubmitButton>
      <p className="mt-3 text-body-5 text-neutral-3">
        To pay with cash instead, cancel this order and place it again with cash.
      </p>
    </section>
  );
}
