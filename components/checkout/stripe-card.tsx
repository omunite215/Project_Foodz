'use client';

import type {
  Stripe,
  StripeCardCvcElement,
  StripeCardExpiryElement,
  StripeCardNumberElement,
  StripeElementChangeEvent,
  StripeElementStyle,
} from '@stripe/stripe-js';
import { loadStripe } from '@stripe/stripe-js/pure';
import { CircleExclamationPoint } from 'lucide-react';
import { type Ref, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { announce } from '@/lib/announce';
import {
  CARD_FIELD_LABELS,
  type CardField,
  cardErrorAnnouncement,
  cardErrorText,
} from '@/lib/checkout-text';
import { cn } from '@/lib/utils';

/*
 * The card fields (F4 design 2.13 b, 2.14, 2.15, D13 to D15): Stripe's split Elements inside our
 * field shells, with our labels outside and our words under each field. The red look comes from
 * our own check (on leaving a field, then live), never from Stripe's, so a half-typed number
 * doesn't turn red while she types. Card data stays in Stripe's frames.
 */

const LOAD_TIMEOUT_MS = 10_000;
const FIELDS: readonly CardField[] = ['cardNumber', 'cardExpiry', 'cardCvc'];
const INCOMPLETE: Record<CardField, string> = {
  cardNumber: 'incomplete_number',
  cardExpiry: 'incomplete_expiry',
  cardCvc: 'incomplete_cvc',
};

/** From the design tokens: neutral-2 text, neutral-3 icons, muted placeholder (4.87:1). */
const STYLE: StripeElementStyle = {
  base: {
    color: '#23262F',
    fontFamily: 'Poppins, ui-sans-serif, system-ui, sans-serif',
    fontSize: '16px',
    fontWeight: '400',
    lineHeight: '24px',
    fontSmoothing: 'antialiased',
    iconColor: '#353945',
    '::placeholder': { color: '#6B7183' },
    ':disabled': { color: '#353945' },
  },
  invalid: { color: '#23262F', iconColor: '#D12B4F' },
  complete: { iconColor: '#353945' },
};

const CLASSES = {
  base: 'StripeElement',
  focus: 'is-focused',
  invalid: 'is-invalid',
  complete: 'is-complete',
  empty: 'is-empty',
};

const stripes = new Map<string, Promise<Stripe | null>>();

/** Stripe.js for this key, loaded once; a failed load can be tried again. */
export function getStripe(publishableKey: string): Promise<Stripe | null> {
  const cached = stripes.get(publishableKey);
  if (cached) return cached;
  const loading = loadStripe(publishableKey).catch((error: unknown) => {
    stripes.delete(publishableKey);
    throw error;
  });
  stripes.set(publishableKey, loading);
  return loading;
}

export type CardFormStatus = 'loading' | 'ready' | 'failed';

export interface CardFieldsHandle {
  /** Shows each field's problem and focuses the first; true when all three are complete. */
  check(): boolean;
  /** Empties the three fields (after a decline). */
  clear(): void;
  stripe(): Stripe | null;
  cardNumber(): StripeCardNumberElement | null;
  /** The bank says the CVC doesn't match: show it under the field and focus it. */
  showCvcError(text: string): void;
}

interface FieldState {
  empty: boolean;
  complete: boolean;
  code: string | null;
  /** The words shown under the field, or null. */
  shown: string | null;
  /** Checked live from now on (it has shown an error). */
  live: boolean;
}

const EMPTY_FIELD: FieldState = {
  empty: true,
  complete: false,
  code: null,
  shown: null,
  live: false,
};

type Elements = {
  cardNumber: StripeCardNumberElement;
  cardExpiry: StripeCardExpiryElement;
  cardCvc: StripeCardCvcElement;
};

const codeOf = (field: CardField, state: Pick<FieldState, 'empty' | 'complete' | 'code'>) =>
  state.code ?? (state.empty ? 'empty' : state.complete ? null : INCOMPLETE[field]);

export interface StripeCardFieldsProps {
  publishableKey: string;
  disabled?: boolean;
  /** Mount again from scratch ("Try again"). */
  attempt: number;
  onStatus: (status: CardFormStatus) => void;
  /** A card field has focus (the pinned pay bar hides on phones while she types). */
  onFocusChange?: (focused: boolean) => void;
  handleRef: Ref<CardFieldsHandle>;
  /** Ids prefix, so the order page's payment step and checkout never clash. */
  idPrefix?: string;
}

export function StripeCardFields({
  publishableKey,
  disabled = false,
  attempt,
  onStatus,
  onFocusChange,
  handleRef,
  idPrefix = 'card',
}: StripeCardFieldsProps) {
  const [status, setStatus] = useState<CardFormStatus>('loading');
  const [fields, setFields] = useState<Record<CardField, FieldState>>({
    cardNumber: EMPTY_FIELD,
    cardExpiry: EMPTY_FIELD,
    cardCvc: EMPTY_FIELD,
  });
  const [brand, setBrand] = useState<string | null>(null);
  const mounts = useRef<Record<CardField, HTMLDivElement | null>>({
    cardNumber: null,
    cardExpiry: null,
    cardCvc: null,
  });
  const stripeRef = useRef<Stripe | null>(null);
  const elementsRef = useRef<Elements | null>(null);
  const brandRef = useRef<string | null>(null);
  const callbacks = useRef({ onStatus, onFocusChange });
  useEffect(() => {
    callbacks.current = { onStatus, onFocusChange };
  });

  /** Updates one field; announces its words the first time they show (design 2.15). */
  const update = (field: CardField, change: (current: FieldState) => FieldState) => {
    setFields((current) => {
      const before = current[field];
      const after = change(before);
      if (after.shown && !before.shown) {
        announce(cardErrorAnnouncement(field, after.shown));
      }
      return { ...current, [field]: after };
    });
  };

  const onFocus = () => callbacks.current.onFocusChange?.(true);
  const onBlur = (field: CardField) => () => {
    callbacks.current.onFocusChange?.(false);
    update(field, (current) => {
      if (current.empty && !current.live) return current;
      const code = codeOf(field, current);
      const shown = code ? cardErrorText(field, code, brandRef.current) : null;
      return { ...current, shown, live: current.live || shown !== null };
    });
  };
  const onChange = (field: CardField, event: StripeElementChangeEvent) => {
    update(field, (current) => {
      const next = {
        ...current,
        empty: event.empty,
        complete: event.complete,
        code: event.error?.code ?? null,
      };
      if (!current.live) return next;
      const code = codeOf(field, next);
      return { ...next, shown: code ? cardErrorText(field, code, brandRef.current) : null };
    });
  };

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ready = new Set<CardField>();
    setStatus('loading');
    callbacks.current.onStatus('loading');
    setFields({ cardNumber: EMPTY_FIELD, cardExpiry: EMPTY_FIELD, cardCvc: EMPTY_FIELD });

    const fail = () => {
      if (cancelled) return;
      cancelled = true;
      setStatus('failed');
      callbacks.current.onStatus('failed');
    };
    timer = setTimeout(fail, LOAD_TIMEOUT_MS);

    const start = async () => {
      let stripe: Stripe | null = null;
      try {
        stripe = await getStripe(publishableKey);
      } catch {
        fail();
        return;
      }
      if (cancelled) return;
      if (!stripe) {
        fail();
        return;
      }
      {
        stripeRef.current = stripe;
        // No `fonts` (D14): Stripe.js fetches a font stylesheet from this page, which our CSP's
        // connect-src refuses; the fields use the fallback stack in STYLE instead.
        const elements = stripe.elements({ locale: 'en' });
        const options = { style: STYLE, classes: CLASSES, disabled };
        const created: Elements = {
          cardNumber: elements.create('cardNumber', {
            ...options,
            showIcon: true,
            iconStyle: 'default',
            disableLink: true,
          }),
          cardExpiry: elements.create('cardExpiry', options),
          cardCvc: elements.create('cardCvc', options),
        };
        elementsRef.current = created;
        if (FIELDS.some((field) => !mounts.current[field])) {
          fail();
          return;
        }

        const onReady = (field: CardField) => () => {
          ready.add(field);
          if (ready.size === FIELDS.length && !cancelled) {
            clearTimeout(timer);
            setStatus('ready');
            callbacks.current.onStatus('ready');
          }
        };

        const number = created.cardNumber;
        number.on('ready', onReady('cardNumber'));
        number.on('focus', onFocus);
        number.on('blur', onBlur('cardNumber'));
        number.on('change', (event) => {
          brandRef.current = event.brand;
          setBrand(event.brand);
          onChange('cardNumber', event);
        });
        const expiry = created.cardExpiry;
        expiry.on('ready', onReady('cardExpiry'));
        expiry.on('focus', onFocus);
        expiry.on('blur', onBlur('cardExpiry'));
        expiry.on('change', (event) => onChange('cardExpiry', event));
        const cvc = created.cardCvc;
        cvc.on('ready', onReady('cardCvc'));
        cvc.on('focus', onFocus);
        cvc.on('blur', onBlur('cardCvc'));
        cvc.on('change', (event) => onChange('cardCvc', event));

        const { cardNumber: numberAt, cardExpiry: expiryAt, cardCvc: cvcAt } = mounts.current;
        if (numberAt) number.mount(numberAt);
        if (expiryAt) expiry.mount(expiryAt);
        if (cvcAt) cvc.mount(cvcAt);
      }
    };
    void start();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      const created = elementsRef.current;
      elementsRef.current = null;
      if (created) for (const field of FIELDS) created[field].destroy();
    };
    // `disabled` is fixed for the page (the demo account); remounting on it isn't needed.
    // oxlint-disable-next-line react/exhaustive-deps
  }, [publishableKey, attempt]);

  useImperativeHandle(handleRef, () => ({
    check() {
      let first: CardField | null = null;
      const next = { ...fields };
      for (const field of FIELDS) {
        const code = codeOf(field, fields[field]);
        const shown = code ? cardErrorText(field, code, brand) : null;
        next[field] = { ...fields[field], shown, live: true };
        if (shown && !first) first = field;
      }
      setFields(next);
      if (first) {
        const firstShown = next[first].shown;
        elementsRef.current?.[first].focus();
        if (firstShown) announce(cardErrorAnnouncement(first, firstShown));
        return false;
      }
      return true;
    },
    clear() {
      const created = elementsRef.current;
      if (created) for (const field of FIELDS) created[field].clear();
      setFields({ cardNumber: EMPTY_FIELD, cardExpiry: EMPTY_FIELD, cardCvc: EMPTY_FIELD });
    },
    stripe: () => stripeRef.current,
    cardNumber: () => elementsRef.current?.cardNumber ?? null,
    showCvcError(text) {
      setFields((current) => ({
        ...current,
        cardCvc: { ...current.cardCvc, shown: text, live: true },
      }));
      elementsRef.current?.cardCvc.focus();
    },
  }));

  const shell = (field: CardField) => {
    const state = fields[field];
    const errorId = `${idPrefix}-${field}-error`;
    return (
      <div key={field} className="min-w-0">
        {/* Our visible label outside Stripe's frame; pressing it puts the caret in the field
            (design 2.14), as a native label would. A pointer convenience only: Tab reaches the
            frame itself, which carries Stripe's own accessible name. */}
        {/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions */}
        <label
          id={`${idPrefix}-${field}-label`}
          onClick={() => elementsRef.current?.[field].focus()}
          className="block text-body-4 text-neutral-3"
        >
          {CARD_FIELD_LABELS[field]}
        </label>
        <div
          data-stripe-field={field}
          data-invalid={state.shown ? 'true' : undefined}
          data-disabled={disabled ? 'true' : undefined}
          className={cn(
            'relative mt-2 flex h-11 items-center rounded-xl border border-input bg-white px-5 transition-colors hover:border-neutral-3',
            'focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring focus-within:outline-solid',
            'data-[invalid=true]:border-destructive data-[invalid=true]:ring-3 data-[invalid=true]:ring-destructive/20',
            'data-[disabled=true]:border-neutral-6 data-[disabled=true]:bg-neutral-7',
          )}
        >
          <div
            ref={(element) => {
              mounts.current[field] = element;
            }}
            className={cn(
              'w-full [&_.StripeElement]:w-full',
              status === 'ready' ? 'opacity-100' : 'opacity-0',
            )}
          />
          {status === 'loading' ? (
            <span
              aria-hidden
              className="absolute inset-y-0 left-5 my-auto h-4 w-40 max-w-[60%] rounded-sm bg-neutral-7 animate-skeleton motion-reduce:animate-none"
            />
          ) : null}
        </div>
        {state.shown ? (
          <p id={errorId} className="mt-2 flex items-start gap-1.5 text-body-5 text-destructive">
            <CircleExclamationPoint className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{state.shown}</span>
          </p>
        ) : null}
      </div>
    );
  };

  // A form that failed stays in the page, hidden, so "Try again" can mount into it.
  return (
    <div
      className={cn('space-y-6', status === 'failed' && 'hidden')}
      aria-busy={status === 'loading' || undefined}
    >
      {status === 'loading' ? <p className="sr-only">Loading card form</p> : null}
      {shell('cardNumber')}
      <div className="grid grid-cols-2 gap-3">
        {shell('cardExpiry')}
        {shell('cardCvc')}
      </div>
    </div>
  );
}
