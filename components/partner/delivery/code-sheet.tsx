'use client';

import { useSelector } from '@tanstack/react-store';
import { gsap } from 'gsap';
import { CircleAlert, WifiOff } from 'lucide-react';
import { type Ref, useEffect, useId, useRef, useState } from 'react';
import { FormAlert } from '@/components/forms/form-alert';
import { SubmitButton } from '@/components/forms/submit-button';
import { SuccessMark } from '@/components/orders/success-mark';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { announce } from '@/lib/announce';
import { distanceMeters, type Point } from '@/lib/map-geometry';
import { prefersReducedMotion } from '@/lib/motion';
import { clearDelivered, dispatchStore, handOverCode } from '@/lib/partner/dispatch';
import {
  cashTickLabel,
  codeRetry,
  codeTitle,
  DELIVERY_COPY,
  deliveredAnnouncement,
  deliveredTitle,
  wrongCodeText,
} from '@/lib/partner/delivery-text';
import { cn } from '@/lib/utils';
import { CallKitchenLink, FAR_M, FarCheckDialog } from './pick-up-screen';

/*
 * The code sheet (F8 design 2.6, 2.7): the cash tick for cash orders, one field drawn as four
 * 56 px boxes (one real input, so paste, one-time-code autofill and screen readers all see one
 * field), the server's try count, the lock on the fifth wrong try, and the delivered moment
 * with the pay. The phone never counts tries itself (P42.5).
 */

const SHEET =
  'inset-x-0 bottom-0 mx-auto max-h-[90dvh] max-w-md overflow-y-auto rounded-t-2xl bg-card px-4 pt-6 pb-[max(1rem,env(safe-area-inset-bottom))] text-foreground data-[state=open]:slide-in-from-bottom-6 motion-reduce:data-[state=open]:slide-in-from-bottom-0';

const RETRY_MS = 2_000;
const LIMIT_TEXT = 'Too many tries for now. Call Foodz Kitchen.';
const CLOSE_AFTER_MS = 8_000;

/** One input drawn as four boxes; the caret's box is marked. */
export function CodeBoxes({
  value,
  onChange,
  disabled,
  invalid,
  describedBy,
  inputRef,
  boxesRef,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  invalid: boolean;
  describedBy: string;
  inputRef?: Ref<HTMLInputElement>;
  boxesRef?: Ref<HTMLDivElement>;
}) {
  const labelId = useId();
  const [focused, setFocused] = useState(false);
  const active = Math.min(value.length, 3);
  return (
    <div>
      <p id={labelId} className="text-body-5 font-medium text-strong">
        {DELIVERY_COPY.codeLabel}
      </p>
      <div ref={boxesRef} className="relative mx-auto mt-2 w-fit">
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={4}
          value={value}
          disabled={disabled}
          aria-label={DELIVERY_COPY.codeName}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          data-code-input=""
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(event) => onChange(event.target.value.replace(/\D/g, '').slice(0, 4))}
          className="absolute inset-0 z-10 h-full w-full cursor-text bg-transparent text-transparent caret-transparent opacity-0 outline-none disabled:cursor-not-allowed"
        />
        <div aria-hidden className="flex justify-center gap-3">
          {[0, 1, 2, 3].map((index) => (
            <span
              key={index}
              className={cn(
                'flex size-14 items-center justify-center rounded-xl border-2 font-sans text-title-1 font-semibold text-strong tabular-nums',
                disabled ? 'border-border bg-muted' : 'border-input bg-background',
                focused && !disabled && index === active && 'border-primary ring-2 ring-primary/30',
              )}
            >
              {value[index] ?? ''}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

type Message =
  | { kind: 'enterAll' }
  | { kind: 'wrong'; triesLeft: number }
  | { kind: 'limit' }
  | { kind: 'offline' }
  | { kind: 'unavailable' }
  | { kind: 'failed' }
  | null;

export function CodeSheet({
  open,
  onOpenChange,
  position,
  returnFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** His latest fix, for the 300 m check (P41.4). */
  position: Point | null;
  returnFocus: () => void;
}) {
  const delivery = useSelector(dispatchStore, (state) => state.delivery);
  const delivered = useSelector(dispatchStore, (state) => state.delivered);
  const offerOpen = useSelector(dispatchStore, (state) => state.card !== null);
  // Typed digits are kept while the sheet is closed, cleared on a wrong try.
  const [digits, setDigits] = useState('');
  const [cash, setCash] = useState(false);
  const [cashError, setCashError] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const [pending, setPending] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [far, setFar] = useState<number | null>(null);
  // P41.4 asks once per delivery; after "Yes, hand it over" later tries go straight through.
  const [farConfirmed, setFarConfirmed] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cashRef = useRef<HTMLInputElement>(null);
  const boxesRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Automatic re-sends of the current try (gate S8: only when it never left, at most 5). */
  const retries = useRef(0);
  const messageId = useId();
  const cashErrorId = useId();
  const deliveryId = delivery?.deliveryId ?? null;

  // A new delivery starts clean; nothing of the last customer stays (P41.3).
  useEffect(() => {
    const timer = setTimeout(() => {
      setDigits('');
      setCash(false);
      setCashError(false);
      setMessage(null);
      setWaiting(false);
      setFarConfirmed(false);
    }, 0);
    return () => clearTimeout(timer);
  }, [deliveryId]);

  useEffect(
    () => () => {
      if (retry.current) clearTimeout(retry.current);
    },
    [],
  );

  // Delivered: read once; the sheet closes by itself after 8 s.
  const deliveredKey = delivered ? `${delivered.orderNumber}-${delivered.pay}` : null;
  useEffect(() => {
    if (!delivered) return undefined;
    announce(deliveredAnnouncement(delivered.orderNumber, delivered.pay));
    requestAnimationFrame(() => backRef.current?.focus());
    const timer = setTimeout(() => {
      clearDelivered();
      onOpenChange(false);
    }, CLOSE_AFTER_MS);
    return () => clearTimeout(timer);
    // oxlint-disable-next-line react/exhaustive-deps
  }, [deliveredKey]);

  const locked = Boolean(delivery?.otp.locked);
  const cashOrder = delivery?.payment.kind === 'cash';
  const cashAmount = /\$[\d,]+(?:\.\d{2})?/.exec(delivery?.payment.text ?? '')?.[0] ?? '';
  const first = delivery?.dropoff?.firstName ?? 'the customer';
  const showOpen = open && !offerOpen && (delivery !== null || delivered !== null);

  const shake = () => {
    const boxes = boxesRef.current;
    if (!boxes || prefersReducedMotion()) return;
    gsap.fromTo(
      boxes,
      { x: 0 },
      { keyframes: { x: [0, -8, 8, -6, 6, 0] }, duration: 0.3, ease: 'none' },
    );
  };

  const send = async (confirmFar: boolean) => {
    const outcome = await handOverCode(digits, cash, confirmFar);
    if (codeRetry(outcome.kind, retries.current) === 'retry') {
      retries.current += 1;
      setWaiting(true);
      retry.current = setTimeout(() => void send(confirmFar), RETRY_MS);
      return;
    }
    setWaiting(false);
    setPending(false);
    switch (outcome.kind) {
      case 'delivered':
        setDigits('');
        return;
      case 'wrong': {
        setDigits('');
        setMessage({ kind: 'wrong', triesLeft: outcome.triesLeft });
        announce(wrongCodeText(first, outcome.triesLeft), { assertive: true });
        shake();
        requestAnimationFrame(() => inputRef.current?.focus());
        return;
      }
      case 'locked':
        setDigits('');
        setMessage(null);
        announce(DELIVERY_COPY.locked, { assertive: true });
        return;
      case 'cash':
        setCashError(true);
        requestAnimationFrame(() => cashRef.current?.focus());
        return;
      case 'limit':
        setMessage({ kind: 'limit' });
        announce(LIMIT_TEXT, { assertive: true });
        return;
      case 'offline':
        // Still no connection after the re-sends: say so and stop.
        setMessage({ kind: 'offline' });
        announce(DELIVERY_COPY.noConnection, { assertive: true });
        return;
      case 'unavailable':
        // A server error or no answer in time: never sent again by itself (it may have counted).
        setMessage({ kind: 'unavailable' });
        announce(DELIVERY_COPY.cantCheck, { assertive: true });
        return;
      case 'gone':
        onOpenChange(false);
        return;
      default:
        setMessage({ kind: 'failed' });
    }
  };

  const submit = () => {
    if (pending || !delivery) return;
    if (cashOrder && !cash) {
      setCashError(true);
      announce(DELIVERY_COPY.cashTick);
      requestAnimationFrame(() => cashRef.current?.focus());
      return;
    }
    if (digits.length < 4) {
      setMessage({ kind: 'enterAll' });
      announce(DELIVERY_COPY.enterAll);
      requestAnimationFrame(() => inputRef.current?.focus());
      return;
    }
    const door = delivery.dropoff?.point ?? null;
    const meters = position && door ? distanceMeters(position, door) : null;
    if (meters !== null && meters > FAR_M && !farConfirmed) {
      setFar(Math.round(meters));
      return;
    }
    go(farConfirmed);
  };

  const go = (confirmFar: boolean) => {
    setFar(null);
    setPending(true);
    setMessage(null);
    retries.current = 0;
    void send(confirmFar);
  };

  /** Closing the sheet stops any re-send that was waiting for a connection. */
  const stopRetrying = () => {
    if (retry.current) clearTimeout(retry.current);
    retry.current = null;
    if (waiting) {
      setWaiting(false);
      setPending(false);
    }
  };

  const messageText =
    message?.kind === 'wrong'
      ? wrongCodeText(first, message.triesLeft)
      : message?.kind === 'enterAll'
        ? DELIVERY_COPY.enterAll
        : message?.kind === 'limit'
          ? LIMIT_TEXT
          : message?.kind === 'offline'
            ? DELIVERY_COPY.noConnection
            : message?.kind === 'unavailable'
              ? DELIVERY_COPY.cantCheck
              : message?.kind === 'failed'
                ? 'Something went wrong. Please try again.'
                : null;

  return (
    <>
      <Sheet
        open={showOpen}
        onOpenChange={(next) => {
          // It always closes (gate S8): a re-send waiting for a connection stops; an answer on
          // its way still lands.
          if (!next) stopRetrying();
          if (!next && delivered) clearDelivered();
          onOpenChange(next);
        }}
      >
        <SheetContent
          className={SHEET}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            titleRef.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (dispatchStore.state.card) return;
            if (dispatchStore.state.delivery) returnFocus();
            else
              requestAnimationFrame(() =>
                document.querySelector<HTMLElement>('[data-partner-h1]')?.focus(),
              );
          }}
        >
          {delivered ? (
            <div className="text-center motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-200">
              <SheetDescription className="sr-only">
                {deliveredAnnouncement(delivered.orderNumber, delivered.pay)}
              </SheetDescription>
              <SuccessMark state="delivered" play tone="partner" />
              <SheetTitle
                ref={titleRef}
                tabIndex={-1}
                className="mt-4 font-heading text-title-1 text-strong outline-none"
              >
                {deliveredTitle(delivered.orderNumber)}
              </SheetTitle>
              <p className="mt-2 text-body-4 text-foreground">
                You earned{' '}
                <b className="text-title-2 font-semibold text-strong tabular-nums">
                  {delivered.pay}
                </b>
              </p>
              <Button
                ref={backRef}
                type="button"
                size="dock"
                className="mt-6"
                onClick={() => {
                  clearDelivered();
                  onOpenChange(false);
                }}
              >
                {DELIVERY_COPY.backToWaiting}
              </Button>
            </div>
          ) : delivery ? (
            <form
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                submit();
              }}
            >
              <SheetTitle
                ref={titleRef}
                tabIndex={-1}
                className="font-heading text-title-1 text-strong outline-none"
              >
                {codeTitle(first)}
              </SheetTitle>
              <SheetDescription className="sr-only">{DELIVERY_COPY.codeName}</SheetDescription>
              {cashOrder && !locked ? (
                <div className="mt-4">
                  <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-border px-4 text-body-4 text-strong has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring has-[:focus-visible]:outline-solid">
                    <input
                      ref={cashRef}
                      type="checkbox"
                      checked={cash}
                      aria-invalid={cashError && !cash ? true : undefined}
                      aria-describedby={cashError && !cash ? cashErrorId : undefined}
                      onChange={(event) => {
                        setCash(event.target.checked);
                        if (event.target.checked) setCashError(false);
                      }}
                      className="size-5 shrink-0 accent-primary outline-none"
                    />
                    {cashTickLabel(cashAmount)}
                  </label>
                  {cashError && !cash ? (
                    <p id={cashErrorId} className="mt-1 text-body-5 text-danger-mark">
                      {DELIVERY_COPY.cashTick}
                    </p>
                  ) : null}
                </div>
              ) : null}
              <div className="mt-5">
                <CodeBoxes
                  value={digits}
                  onChange={(value) => {
                    setDigits(value);
                    if (message?.kind === 'enterAll') setMessage(null);
                  }}
                  disabled={locked || pending}
                  invalid={message?.kind === 'wrong' || message?.kind === 'enterAll'}
                  describedBy={messageId}
                  inputRef={inputRef}
                  boxesRef={boxesRef}
                />
              </div>
              <div id={messageId} className="mt-3 min-h-12">
                {locked ? (
                  <FormAlert variant="error" tone="partner">
                    {DELIVERY_COPY.locked}
                  </FormAlert>
                ) : messageText ? (
                  <p className="flex items-start gap-2 text-body-4 text-danger-mark">
                    <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                    {messageText}
                  </p>
                ) : null}
                {!locked && (message?.kind === 'unavailable' || message?.kind === 'limit') ? (
                  <div className="mt-3">
                    <CallKitchenLink phone={delivery.kitchen.phone} />
                  </div>
                ) : null}
              </div>
              <div className="mt-4">
                {locked ? (
                  <CallKitchenLink phone={delivery.kitchen.phone} />
                ) : (
                  <>
                    {cashOrder && !cash ? (
                      <p id={`${cashErrorId}-dock`} className="mb-2 text-body-5 text-foreground">
                        {DELIVERY_COPY.cashTick}
                      </p>
                    ) : null}
                    <SubmitButton
                      type="submit"
                      size="dock"
                      pending={pending}
                      pendingLabel={
                        waiting ? DELIVERY_COPY.waitingConnection : DELIVERY_COPY.completing
                      }
                      blocked={cashOrder && !cash}
                      onBlockedPress={() => {
                        setCashError(true);
                        announce(DELIVERY_COPY.cashTick);
                        requestAnimationFrame(() => cashRef.current?.focus());
                      }}
                      aria-describedby={cashOrder && !cash ? `${cashErrorId}-dock` : undefined}
                    >
                      {DELIVERY_COPY.completeDelivery}
                    </SubmitButton>
                    {waiting ? (
                      <p className="mt-2 flex items-center gap-2 text-body-5 text-foreground">
                        <WifiOff className="size-4" aria-hidden />
                        {DELIVERY_COPY.waitingConnection}
                      </p>
                    ) : null}
                  </>
                )}
              </div>
            </form>
          ) : null}
        </SheetContent>
      </Sheet>
      {delivery ? (
        <FarCheckDialog
          open={far !== null}
          step="handOver"
          orderNumber={delivery.orderNumber}
          meters={far ?? 0}
          onCancel={() => setFar(null)}
          onConfirm={() => {
            setFarConfirmed(true);
            go(true);
          }}
        />
      ) : null}
    </>
  );
}
