'use client';

import { Banknote, CreditCard, HandCoins, type LucideIcon } from 'lucide-react';
import type { ReactNode, Ref } from 'react';
import { FormAlert } from '@/components/forms/form-alert';
import { cashBoxText, type PayMethod } from '@/lib/checkout-text';
import { cn } from '@/lib/utils';
import { RadioCard } from './radio-card';

/*
 * "Payment" (F4 design 2.12, D12, D26): the payment alert slot, then Card and Cash on delivery
 * as two radio rows. Brands are written out; no card artwork. A row that can't be chosen says why
 * under its label.
 */

export interface PaymentAlertState {
  key: string;
  variant: 'error' | 'warning' | 'info' | 'success';
  icon?: LucideIcon;
  text: ReactNode;
  action?: ReactNode;
}

export interface PaymentMethodProps {
  method: PayMethod;
  onMethod: (method: PayMethod) => void;
  /** Why Card can't be chosen ("Paused until 8:40 pm"), or null. */
  cardBlocked: string | null;
  /** Why Cash can't be chosen (over $100.00), or null. */
  cashBlocked: string | null;
  alert: PaymentAlertState | null;
  alertRef?: Ref<HTMLDivElement>;
  /** The total for the cash box, null while it isn't final. */
  totalCents: number | null;
  tipCents: number;
  /** The card section, shown when Card is chosen. */
  card: ReactNode;
  /** Before the press is over, nothing here can change (D21). */
  inert?: boolean;
}

function MethodText({
  title,
  line,
  blocked,
}: {
  title: string;
  line: string;
  blocked: string | null;
}) {
  return (
    <>
      <span className="block text-body-4 font-medium text-neutral-1">{title}</span>
      <span className="mt-0.5 block text-body-5 text-neutral-3">{line}</span>
      {blocked ? (
        <span className="mt-1 block text-body-5 text-neutral-1 [overflow-wrap:anywhere]">
          {blocked}
        </span>
      ) : null}
    </>
  );
}

export function PaymentAlert({
  alert,
  alertRef,
}: {
  alert: PaymentAlertState | null;
  alertRef?: Ref<HTMLDivElement>;
}) {
  return (
    <div ref={alertRef} tabIndex={-1} className="outline-none focus-visible:outline-2">
      {alert ? (
        <FormAlert variant={alert.variant} icon={alert.icon} action={alert.action} className="mt-4">
          {alert.text}
        </FormAlert>
      ) : null}
    </div>
  );
}

export function PaymentMethod({
  method,
  onMethod,
  cardBlocked,
  cashBlocked,
  alert,
  alertRef,
  totalCents,
  tipCents,
  card,
}: PaymentMethodProps) {
  const choose = (value: string) => onMethod(value === 'card' ? 'card' : 'cash');
  return (
    <section aria-labelledby="payment-title">
      <h2 id="payment-title" className="text-body-2 font-semibold text-neutral-1">
        Payment
      </h2>
      <PaymentAlert alert={alert} alertRef={alertRef} />
      <fieldset className="mt-4 min-w-0">
        <legend className="sr-only">Payment method</legend>
        <div className="space-y-3">
          <RadioCard
            name="payment-method"
            value="card"
            checked={method === 'card'}
            disabled={cardBlocked !== null}
            onChange={choose}
            icon={CreditCard}
            label={['Card', 'Credit or debit card', cardBlocked].filter(Boolean).join(', ')}
          >
            <MethodText title="Card" line="Credit or debit card" blocked={cardBlocked} />
          </RadioCard>
          <RadioCard
            name="payment-method"
            value="cash"
            checked={method === 'cash'}
            disabled={cashBlocked !== null}
            onChange={choose}
            icon={Banknote}
            label={['Cash on delivery', 'Pay the courier when it arrives', cashBlocked]
              .filter(Boolean)
              .join(', ')}
          >
            <MethodText
              title="Cash on delivery"
              line="Pay the courier when it arrives"
              blocked={cashBlocked}
            />
          </RadioCard>
        </div>
      </fieldset>
      {method === 'cash' ? (
        <p
          className={cn(
            'mt-4 flex items-start gap-3 rounded-xl bg-neutral-7 p-4 text-body-5 text-neutral-1 md:text-body-4',
          )}
        >
          <HandCoins className="mt-0.5 size-5 shrink-0 text-neutral-3" aria-hidden />
          <span>{cashBoxText(totalCents, tipCents)}</span>
        </p>
      ) : (
        card
      )}
    </section>
  );
}
