'use client';

import { WifiOff } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  cancelOrderAction,
  orderStatusAction,
  orderViewAction,
} from '@/server/modules/orders/actions';
import type { OrderView } from '@/server/modules/orders/schema';
import { kitchenStartedMessage, paymentInProgressMessage } from '@/server/modules/orders/text';
import type { SavedCardDto } from '@/server/modules/payments/schema';
import { BackLink } from '@/components/account/back-link';
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
import { Button } from '@/components/ui/button';
import { callAction } from '@/lib/action-result';
import { announce } from '@/lib/announce';
import {
  forgetConfirming,
  isConfirming,
  markConfirming,
  takeArrival,
  takeClearCart,
} from '@/lib/checkout-storage';
import { useCartActions } from '@/lib/data/cart';
import { cancelDescription, moneyNotices, orderStateOf, telOf } from '@/lib/order-text';
import { useMinuteClock } from '@/lib/use-minute-clock';
import { useOnline } from '@/lib/use-online';
import {
  DeliveryCard,
  MoneyNotices,
  OrderHero,
  OrderNumber,
  OrderStatusCard,
  Receipt,
} from './order-parts';
import { PaymentStep } from './payment-step';

/*
 * The order page (F4 design 3): the confirmation now and the place every state is explained.
 * Server-rendered with the receipt in the first HTML. Only a card payment the browser saw go
 * through polls the server (every 2 s for a minute, B7); the page also asks again when the tab is
 * shown and when the browser comes back online.
 */

const POLL_MS = 2000;
const POLL_FOR_MS = 60_000;
const SLOW_AFTER_MS = 30_000;

export interface OrderPageProps {
  view: OrderView;
  /** For "Finish paying"; null when the order isn't waiting or cards aren't set up. */
  payment: {
    publishableKey: string;
    testMode: boolean;
    savedCards: SavedCardDto[];
    savedCardLimit: number;
  } | null;
}

export function OrderPage({ view: initial, payment }: OrderPageProps) {
  const online = useOnline();
  const minute = useMinuteClock();
  const cart = useCartActions();
  const [shown, setShown] = useState({ from: initial, view: initial });
  if (shown.from !== initial) setShown({ from: initial, view: initial });
  const view = shown.view;
  const setView = (next: OrderView) => setShown((current) => ({ ...current, view: next }));

  const [confirming, setConfirming] = useState(false);
  const [confirmingSince, setConfirmingSince] = useState<number | null>(null);
  const [fresh, setFresh] = useState(false);
  /** The arrival check has run: "Finish paying" may show (not for a payment just confirmed). */
  const [arrivalChecked, setArrivalChecked] = useState(false);
  const [slow, setSlow] = useState(false);
  const [stalled, setStalled] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelRefusal, setCancelRefusal] = useState<{ text: string; kitchen: boolean } | null>(
    null,
  );
  const [refunding, setRefunding] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const refusalRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const state = orderStateOf(view, confirming);

  const arrived = (next: OrderView) => {
    requestAnimationFrame(() => {
      headingRef.current?.focus();
      if (
        next.status !== 'PENDING_PAYMENT' &&
        next.status !== 'FAILED' &&
        next.status !== 'CANCELLED'
      ) {
        announce(`Order placed, order ${next.number}`);
      }
    });
  };

  // On arrival: play the check once for a fresh order from checkout (D35), and pick up a card
  // payment this tab saw go through (B7).
  useEffect(() => {
    const isFresh = takeArrival(initial.id);
    const waiting = initial.status === 'PENDING_PAYMENT' && isConfirming(initial.id);
    setFresh(isFresh);
    if (waiting) {
      setConfirming(true);
      setConfirmingSince(Date.now());
    } else {
      forgetConfirming(initial.id);
      if (initial.status !== 'PENDING_PAYMENT' && takeClearCart(initial.id)) cart.clear();
    }
    if (isFresh) arrived(initial);
    setArrivalChecked(true);
    // Once, on arrival.
    // oxlint-disable-next-line react/exhaustive-deps
  }, []);

  /** The order as the server sees it now. */
  const latest = useRef({ view, confirming });
  useEffect(() => {
    latest.current = { view, confirming };
  });
  const settle = (next: OrderView) => {
    const before = latest.current;
    setView(next);
    if (before.confirming && next.status !== 'PENDING_PAYMENT') {
      setConfirming(false);
      setConfirmingSince(null);
      forgetConfirming(next.id);
      if (takeClearCart(next.id)) cart.clear();
      arrived(next);
    }
  };

  // Confirming: ask every 2 s for a minute; say so after 30 s; offer "Check again" after 60 s.
  useEffect(() => {
    if (!confirming || confirmingSince === null) return undefined;
    let stopped = false;
    const tick = async () => {
      const outcome = await callAction(() =>
        orderStatusAction({ orderId: latest.current.view.id, confirmed: true }),
      );
      if (!stopped && outcome.ok) settle(outcome.data);
    };
    const poll = setInterval(() => {
      if (Date.now() - confirmingSince > POLL_FOR_MS) {
        clearInterval(poll);
        setStalled(true);
        return;
      }
      void tick();
    }, POLL_MS);
    const slowTimer = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    void tick();
    return () => {
      stopped = true;
      clearInterval(poll);
      clearTimeout(slowTimer);
    };
    // `settle` reads the newest state through refs.
    // oxlint-disable-next-line react/exhaustive-deps
  }, [confirming, confirmingSince]);

  const refetch = async () => {
    const outcome = await callAction(() => orderViewAction({ orderId: latest.current.view.id }));
    if (outcome.ok) settle(outcome.data);
  };
  const refetchRef = useRef(refetch);
  useEffect(() => {
    refetchRef.current = refetch;
  });

  // Back to the tab, or back online: ask again (S11.2, S13.13).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refetchRef.current();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);
  const wasOnline = useRef(online);
  useEffect(() => {
    if (online && !wasOnline.current) void refetchRef.current();
    wasOnline.current = online;
  }, [online]);

  // The unpaid countdown reaches zero: the page asks again and shows Expired (S9.3).
  const expired =
    state === 'waiting' && view.expiresAt !== null && Date.parse(view.expiresAt) <= minute;
  useEffect(() => {
    if (expired) void refetchRef.current();
  }, [expired]);

  // A paid card order she cancelled is refunded in a job: "We're refunding…" until it lands.
  useEffect(() => {
    if (!refunding) return undefined;
    const started = Date.now();
    const timer = setInterval(() => {
      if (latest.current.view.payment.status === 'REFUNDED' || Date.now() - started > POLL_FOR_MS) {
        setRefunding(false);
        return;
      }
      void refetchRef.current();
    }, 3000);
    return () => clearInterval(timer);
  }, [refunding]);

  async function cancel() {
    if (cancelling) return;
    setCancelling(true);
    const outcome = await callAction(() => cancelOrderAction({ orderId: view.id }));
    setCancelling(false);
    setCancelOpen(false);
    if (outcome.ok) {
      const refreshed = await callAction(() => orderViewAction({ orderId: view.id }));
      if (refreshed.ok) setView(refreshed.data);
      if (outcome.data.refund) setRefunding(true);
      requestAnimationFrame(() => headingRef.current?.focus());
      announce(`Order ${view.number} cancelled`);
      return;
    }
    const error = outcome.error;
    const text =
      error.code === 'KITCHEN_STARTED'
        ? kitchenStartedMessage(view.number, view.store.phone)
        : error.code === 'PAYMENT_IN_PROGRESS'
          ? paymentInProgressMessage(view.number)
          : error.message;
    setCancelRefusal({ text, kitchen: error.code === 'KITCHEN_STARTED' });
    announce(text);
    requestAnimationFrame(() => refusalRef.current?.focus());
  }

  const notices = moneyNotices(view, state);
  const showDetails = state !== 'failed' && state !== 'mismatch';
  const canCancel = view.cancellable && !cancelRefusal?.kitchen && state !== 'confirming';
  const primary =
    state === 'failed'
      ? { href: '/checkout' as Route, label: 'Back to checkout' }
      : state === 'expired' || state === 'mismatch'
        ? { href: '/checkout' as Route, label: 'Go to checkout' }
        : state === 'confirming'
          ? null
          : { href: '/menu' as Route, label: 'Keep browsing' };
  const tel = telOf(view.store.phone);

  return (
    <div className="mx-auto max-w-[600px]">
      <div className="mb-6">
        <BackLink href="/account/orders">Your orders</BackLink>
      </div>
      {online ? null : (
        <FormAlert variant="info" icon={WifiOff} className="mb-6">
          You&apos;re offline. This page will update when you&apos;re back online.
        </FormAlert>
      )}
      <OrderHero
        view={view}
        state={state}
        play={fresh}
        headingRef={headingRef}
        slow={slow}
        now={minute}
      />
      <OrderNumber number={view.number} />
      <OrderStatusCard view={view} state={state} now={new Date(minute)} />
      <MoneyNotices notices={notices} />
      {state === 'waiting' && view.payable && payment && arrivalChecked ? (
        <PaymentStep
          view={view}
          savedCards={payment.savedCards}
          savedCardLimit={payment.savedCardLimit}
          publishableKey={payment.publishableKey}
          testMode={payment.testMode}
          onPaid={() => {
            markConfirming(view.id);
            setFresh(true);
            setStalled(false);
            setSlow(false);
            setConfirming(true);
            setConfirmingSince(Date.now());
            requestAnimationFrame(() => headingRef.current?.focus());
          }}
          onChanged={(next) => {
            if (next) {
              setView(next);
              requestAnimationFrame(() => headingRef.current?.focus());
            } else void refetch();
          }}
        />
      ) : null}
      {showDetails ? (
        <>
          <Receipt view={view} state={state} />
          <DeliveryCard view={view} />
        </>
      ) : null}

      <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
        {stalled && confirming ? (
          <Button
            type="button"
            variant="outline"
            size="touch"
            className="bg-white"
            onClick={() => {
              setStalled(false);
              setConfirmingSince(Date.now());
            }}
          >
            Check again
          </Button>
        ) : null}
        {primary ? (
          <Button asChild size="touch" className="uppercase">
            <Link href={primary.href}>{primary.label}</Link>
          </Button>
        ) : null}
        {canCancel ? (
          <div className="flex flex-col items-center gap-1">
            <Button
              ref={cancelButtonRef}
              type="button"
              variant="outline"
              size="touch"
              aria-disabled={!online || undefined}
              aria-describedby={online ? undefined : 'cancel-offline'}
              onClick={() => {
                if (!online) {
                  announce("You're offline.");
                  return;
                }
                setCancelRefusal(null);
                setCancelOpen(true);
              }}
              className="w-full border-destructive bg-white text-destructive hover:bg-tag-4-bg hover:text-destructive sm:w-auto"
            >
              Cancel order
            </Button>
            {online ? null : (
              <span id="cancel-offline" className="text-body-5 text-neutral-3">
                You&apos;re offline.
              </span>
            )}
          </div>
        ) : null}
      </div>
      <div ref={refusalRef} tabIndex={-1} className="outline-none">
        {cancelRefusal ? (
          <FormAlert variant="error" className="mt-6">
            {cancelRefusal.kitchen ? (
              <>
                The kitchen has already started on order {view.number}, so it can&apos;t be
                cancelled here. Call us on{' '}
                <a href={`tel:${tel}`} className="font-medium underline">
                  {view.store.phone}
                </a>
                .
              </>
            ) : (
              cancelRefusal.text
            )}
          </FormAlert>
        ) : null}
      </div>
      <p className="mt-6 text-center text-body-5 text-neutral-3">
        Need help? Call{' '}
        <a href={`tel:${tel}`} className="text-neutral-1 underline underline-offset-4">
          {view.store.phone}
        </a>
      </p>

      <AlertDialog
        open={cancelOpen}
        onOpenChange={(open) => {
          if (!open && !cancelling) setCancelOpen(false);
        }}
      >
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (cancelButtonRef.current?.isConnected) cancelButtonRef.current.focus();
          }}
        >
          <AlertDialogTitle>Cancel order {view.number}?</AlertDialogTitle>
          <AlertDialogDescription>{cancelDescription(view)}</AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep order</AlertDialogCancel>
            <SubmitButton
              type="button"
              variant="danger"
              pending={cancelling}
              pendingLabel="Cancelling…"
              onClick={() => {
                void cancel();
              }}
            >
              Cancel order
            </SubmitButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
