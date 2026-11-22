'use client';

import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Clock, Info } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { AddressDto, StoreArea } from '@/server/modules/addresses/schema';
import {
  type Quote,
  type QuoteLine,
  quoteSchema,
  type TipChoice,
} from '@/server/modules/cart/schema';
import {
  cancelOrderAction,
  orderStatusAction,
  placeOrderAction,
  attemptStatusAction,
} from '@/server/modules/orders/actions';
import type {
  CheckoutAddress,
  CheckoutPage,
  PlaceOrderInput,
} from '@/server/modules/orders/schema';
import {
  cardPausedMessage,
  CARD_NOT_SAVED,
  cashLimitMessage,
  CHOOSE_ADDRESS,
  declineMessage,
  openingPhrase,
  paymentInProgressMessage,
  soldOutMessage,
  STRIPE_NOT_SET_UP,
  unpaidOrderMessage,
} from '@/server/modules/orders/text';
import { DemoNotice } from '@/components/account/demo-notice';
import { PromoSection } from '@/components/cart/promo';
import {
  quoteQueryKey,
  type QuoteRequest,
  requestKey,
  useQuote,
} from '@/components/cart/use-quote';
import { focusFirstInvalid } from '@/components/forms/feedback';
import { PageContainer } from '@/components/layout/page-container';
import { Button } from '@/components/ui/button';
import { type ActionFailure, callAction, withoutFieldError } from '@/lib/action-result';
import { announce } from '@/lib/announce';
import { onAuthEvent } from '@/lib/auth-channel';
import { openCart, useCartOpen } from '@/lib/cart-dialog';
import { lineSuffix, orderingOpensText, totalAnnouncement } from '@/lib/cart-text';
import {
  markArrival,
  markClearCart,
  markConfirming,
  NO_CHOICES,
  type PlacedHere,
  readAttempt,
  readChoices,
  readPlacedHere,
  writeAttempt,
  writeChoices,
  writePlacedHere,
} from '@/lib/checkout-storage';
import {
  attemptFingerprint,
  newAttemptKey,
  noWayToPayText,
  NOT_SENT,
  PAY_REASONS,
  payButtonLabel,
  payPendingLabel,
  parseTipAmount,
  pausedUntilText,
  placeLimitText,
  SWITCHED_TO_CARD,
  SLOW_PRESS,
  SLOW_PRESS_OFFLINE,
  CARD_FORM_FAILED,
  type PayMethod,
  type TipTile,
  tipChoiceFor,
} from '@/lib/checkout-text';
import { confirmCard } from '@/lib/confirm-card';
import {
  type CartLine,
  sortLines,
  useCart,
  useCartActions,
  useCartMeta,
  useKeepCartAsGuest,
} from '@/lib/data/cart';
import { useCartDishActions, useCartDishes } from '@/lib/data/cart-dishes';
import { clockAt } from '@/server/modules/orders/text';
import { formatClock, formatPrice } from '@/lib/format';
import { orderHref } from '@/lib/order-text';
import { pathOf } from '@/lib/navigation';
import { DEFAULT_PHONE_COUNTRY } from '@/lib/phone';
import type { PhoneCountry } from '@/lib/phone-countries';
import { previousRoute } from '@/lib/route-memory';
import { signInFor } from '@/lib/sign-in-reason';
import { useMinuteClock } from '@/lib/use-minute-clock';
import { useOnline } from '@/lib/use-online';
import { cn } from '@/lib/utils';
import type { SavedCardDto } from '@/server/modules/payments/schema';
import { RemoveCardDialog } from '@/components/cards/remove-card-dialog';
import { AddressDialog } from './address-dialog';
import { ArrivalBox } from './arrival-box';
import { CardSection, NEW_CARD } from './card-section';
import { EmptyCartGate, PlacedGate } from './checkout-gates';
import { NOTICE_ICONS, type Notice, NoticeList, UnpaidActions } from './checkout-notices';
import { CheckoutSummary, type SummaryLineView } from './checkout-summary';
import { ContactFields, useContactForm } from './contact-fields';
import { DeliverTo } from './deliver-to';
import { DuplicateDialog } from './duplicate-dialog';
import { NotSentNotice, PayBar, type PayBarContent } from './pay-bar';
import { type PaymentAlertState, PaymentMethod } from './payment-method';
import { getStripe, type CardFieldsHandle, type CardFormStatus } from './stripe-card';
import { TIP_AMOUNT_ID, TipPicker } from './tip-picker';

/*
 * Checkout (F4 design 2): one page, not steps (D1). The Summary, then Deliver to, Contact,
 * Arrival, Tip and Payment, and the pay bar with the amount the server worked out. A press is
 * sent once, with an attempt key, and never offered again while it may still be going through.
 * Everything she chose survives every refusal and decline; only the card fields are cleared.
 */

export type CheckoutReady = Extract<CheckoutPage, { eligibility: 'ok' | 'unconfirmed' | 'demo' }>;

export interface CheckoutProps {
  page: CheckoutReady;
  /** Her saved addresses in full, for the edit dialog. */
  addressBook: readonly AddressDto[];
  store: StoreArea;
  countries: readonly PhoneCountry[];
  draftOwner: string;
  demoNoticeDismissed: boolean;
}

type Press = 'idle' | 'pressing' | 'bank' | 'slow';
type ButtonContent = Extract<PayBarContent, { kind: 'button' }>;

interface PressNotice {
  kind: 'price' | 'soldOut' | 'promo';
  text: string;
  /** PROMO_REFUSED: the code to take off and the total without it (D24). */
  code?: string;
  totalCents?: number;
}

interface UnpaidState {
  id: string;
  number: string;
  totalCents: number;
  expiresAt: string | null;
}

const toQuoteLine = (line: CartLine) => ({
  key: line.key,
  menuItemId: line.menuItemId,
  flavors: line.flavors,
  quantity: line.quantity,
  ...(line.note ? { note: line.note } : {}),
});

const asText = (value: unknown) => (typeof value === 'string' ? value : undefined);
const asCount = (value: unknown) => (typeof value === 'number' ? value : undefined);

/** The new quote a refusal carries (PRICE_CHANGED, SOLD_OUT, PROMO_REFUSED). */
const quoteOf = (failure: ActionFailure): Quote | null => {
  const parsed = quoteSchema.safeParse(failure.details?.quote);
  return parsed.success ? parsed.data : null;
};

/** The dishes named in a SOLD_OUT refusal. */
function soldOutDishes(failure: ActionFailure): string[] {
  const listed = failure.details?.soldOut;
  if (!Array.isArray(listed)) return [];
  return listed.flatMap((item: unknown) => {
    const dish = typeof item === 'object' && item !== null ? Reflect.get(item, 'dish') : null;
    return typeof dish === 'string' ? [dish] : [];
  });
}

/** The address chosen when the page opens: the cart's own choice, else the default, if deliverable. */
function firstChoice(addresses: readonly CheckoutAddress[], cartChoice: string | null) {
  const usable = (id: string | null) =>
    addresses.find((address) => address.id === id && !address.outsideNow)?.id ?? null;
  return usable(cartChoice) ?? usable(addresses.find((address) => address.isDefault)?.id ?? null);
}

const isTextField = (target: EventTarget | null) =>
  (target instanceof HTMLInputElement && TEXT_TYPES.has(target.type)) ||
  target instanceof HTMLTextAreaElement;

function focusSoon(target: HTMLElement | null | undefined) {
  requestAnimationFrame(() => target?.focus());
}

const COARSE_NARROW = '(pointer: coarse) and (width < 64rem)';
const TEXT_TYPES = new Set(['text', 'tel', 'email', 'search', 'number', '']);

export function Checkout({
  page,
  addressBook,
  store,
  countries,
  draftOwner,
  demoNoticeDismissed,
}: CheckoutProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const online = useOnline();
  const now = useMinuteClock();
  const cartOpen = useCartOpen();
  const { lines, itemCount, isReady } = useCart();
  const meta = useCartMeta();
  const cart = useCartActions();
  const dishes = useCartDishes();
  const dishActions = useCartDishActions();
  const keepCartAsGuest = useKeepCartAsGuest();
  const demo = page.eligibility === 'demo';
  const stripeKey = page.stripe.configured ? page.stripe.publishableKey : null;
  const timeZone = 'America/New_York';

  // ---------------------------------------------------------------- what this tab remembers
  const [placed, setPlaced] = useState<PlacedHere | null>(null);
  const [choicesLoaded, setChoicesLoaded] = useState(false);
  const [tile, setTile] = useState<TipTile>(NO_CHOICES.tip);
  const [otherText, setOtherText] = useState('');
  const [otherBlurred, setOtherBlurred] = useState(false);
  const [lastValidTip, setLastValidTip] = useState<number | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);

  // ---------------------------------------------------------------- choices
  const [chosenId, setChosenId] = useState<string | null | undefined>(undefined);
  const addressId = chosenId === undefined ? firstChoice(page.addresses, meta.addressId) : chosenId;
  const [pausedUntil, setPausedUntil] = useState<string | null>(page.cardPausedUntil);
  const paused = pausedUntil !== null && Date.parse(pausedUntil) > now;
  const cardBlocked = !stripeKey
    ? STRIPE_NOT_SET_UP
    : paused && pausedUntil
      ? pausedUntilText(pausedUntil, timeZone)
      : null;
  const [method, setMethod] = useState<PayMethod>(() => {
    if (cardBlocked) return 'cash';
    if (demo) return 'card';
    return page.lastPaymentMethod === 'cash' ? 'cash' : 'card';
  });
  const firstCard = page.savedCards.find((card) => !card.expired)?.id ?? NEW_CARD;
  const [cardChoice, setCardChoice] = useState(firstCard);
  const [saveCard, setSaveCard] = useState(false);
  const [cardStatus, setCardStatus] = useState<CardFormStatus>('loading');
  const [cardAttempt, setCardAttempt] = useState(0);
  const fields = useRef<CardFieldsHandle>(null);

  // ---------------------------------------------------------------- the press and its answers
  const [press, setPress] = useState<Press>('idle');
  const [checking, setChecking] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [deliverError, setDeliverError] = useState<string | null>(null);
  const [paymentAlert, setPaymentAlert] = useState<PaymentAlertState | null>(null);
  const [pressNotice, setPressNotice] = useState<PressNotice | null>(null);
  const [closedAtPress, setClosedAtPress] = useState<string | null>(null);
  const [notSent, setNotSent] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<{ orderId: string; number: string } | null>(null);
  const [limitUntil, setLimitUntil] = useState<number | null>(null);
  const [unpaid, setUnpaid] = useState<UnpaidState | null>(
    page.unpaidOrder
      ? {
          id: page.unpaidOrder.id,
          number: page.unpaidOrder.number,
          totalCents: page.unpaidOrder.totalCents,
          expiresAt: page.unpaidOrder.expiresAt,
        }
      : null,
  );
  const [unpaidCancelled, setUnpaidCancelled] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [unpaidNote, setUnpaidNote] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ open: boolean; address: AddressDto | null }>({
    open: false,
    address: null,
  });
  const [typing, setTyping] = useState(false);
  const [undo, setUndo] = useState<{ line: CartLine; title: string } | null>(null);
  const [removingCard, setRemovingCard] = useState<SavedCardDto | null>(null);
  const [goneCards, setGoneCards] = useState<ReadonlySet<string>>(new Set());
  const cardOpener = useRef<HTMLButtonElement | null>(null);
  const [removedCount, setRemovedCount] = useState(0);
  const [codeEnded, setCodeEnded] = useState<string | null>(null);
  const pressing = press === 'pressing' || press === 'bank';
  const pendingAttempt = useRef<string | null>(null);

  // ---------------------------------------------------------------- refs for focus
  const formRef = useRef<HTMLFormElement>(null);
  const addressGroupRef = useRef<HTMLDivElement>(null);
  const pageNoticeRef = useRef<HTMLDivElement>(null);
  const summaryNoticeRef = useRef<HTMLDivElement>(null);
  const paymentAlertRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const notSentRef = useRef<HTMLDivElement>(null);
  const gateRef = useRef<HTMLParagraphElement>(null);
  const payButtonRef = useRef<HTMLButtonElement>(null);
  const editCartRef = useRef<HTMLButtonElement>(null);
  const undoRef = useRef<HTMLButtonElement>(null);
  const removeRefs = useRef(new Map<string, HTMLButtonElement>());
  const dialogOpener = useRef<HTMLElement | null>(null);
  const focusUndo = useRef(false);

  // ---------------------------------------------------------------- contact form
  const { form, check: checkContact } = useContactForm({
    contactName: page.profile.name,
    phone: page.profile.phoneDisplay ?? '',
    phoneCountry: page.profile.phoneCountry ?? DEFAULT_PHONE_COUNTRY,
    savePhone: true,
    kitchenNote: '',
  });

  const note = useRef('');
  // This tab's choices come back after a reload (S7.2), and the order it just placed (S1.6).
  useEffect(() => {
    const saved = readChoices();
    setTile(saved.tip);
    setOtherText(saved.otherText);
    const amount = parseTipAmount(saved.otherText);
    if (amount.kind === 'ok') setLastValidTip(amount.cents);
    setSummaryOpen(saved.summaryOpen);
    if (saved.note) {
      note.current = saved.note;
      form.setFieldValue('kitchenNote', saved.note);
    }
    setPlaced(readPlacedHere());
    setChoicesLoaded(true);
    // A press this tab made before a reload: find out what became of it (S7.3, S7.4).
    const attempt = readAttempt();
    if (attempt?.pressed) {
      void (async () => {
        const outcome = await callAction(() => attemptStatusAction({ attemptKey: attempt.key }));
        if (!outcome.ok) return;
        if (outcome.data.kind === 'placed') {
          const here = {
            orderId: outcome.data.orderId,
            number: outcome.data.number,
            confirming: false,
          };
          writePlacedHere(here);
          setPlaced(here);
          cart.clear();
        }
        writeAttempt(null);
      })();
    }
    // Once, on arrival.
    // oxlint-disable-next-line react/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!choicesLoaded) return;
    writeChoices({ tip: tile, otherText, note: note.current, summaryOpen });
  }, [choicesLoaded, tile, otherText, summaryOpen]);

  // Confirmed in another tab or the mail app: the gate gives way without a reload (S1.3).
  useEffect(() => {
    if (page.eligibility !== 'unconfirmed') return undefined;
    const off = onAuthEvent((type) => {
      if (type === 'email-confirmed') router.refresh();
    });
    const onVisible = () => {
      if (document.visibilityState === 'visible') router.refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      off();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [page.eligibility, router]);

  // ---------------------------------------------------------------- the quote
  const tipAmount = parseTipAmount(otherText);
  const tip: TipChoice = tipChoiceFor(tile, tipAmount, lastValidTip);
  const request: QuoteRequest = {
    lines: lines.map(toQuoteLine),
    delivery: addressId ? { kind: 'saved', addressId } : { kind: 'none' },
    ...(meta.code ? { code: meta.code } : {}),
    tip,
    method,
  };
  const latest = useRef({ lines, cart, dishActions });
  useEffect(() => {
    latest.current = { lines, cart, dishActions };
  });
  const onAnswer = (answer: Quote) => {
    const current = latest.current;
    current.dishActions.learn(
      answer.lines.flatMap((line) =>
        line.dish && line.unitPriceCents !== null
          ? [{ id: line.menuItemId, ...line.dish, unitPriceCents: line.unitPriceCents }]
          : [],
      ),
    );
    const byKey = new Map(current.lines.map((line) => [line.key, line]));
    let gone = 0;
    for (const answered of answer.lines) {
      const line = byKey.get(answered.key);
      if (!line) continue;
      if (answered.status === 'removed') {
        current.cart.remove(line.id);
        gone += 1;
      } else if (answered.droppedFlavors.length > 0) {
        current.cart.edit(line.id, { flavors: answered.flavors, note: line.note });
      }
    }
    if (gone > 0) setRemovedCount((count) => count + gone);
  };
  const view = useQuote(request, isReady && lines.length > 0 && !cartOpen, onAnswer);
  const quote = view.quote;
  const known = quote ?? view.lastQuote;
  const quoted = new Map<string, QuoteLine>((known?.lines ?? []).map((line) => [line.key, line]));
  const failedQuote =
    view.status === 'failed' || view.status === 'offline' || view.status === 'tooBig';

  // The total she changed is announced once it settles; opening is not (S13.4).
  const firstKey = useRef(view.currentKey);
  const announced = useRef<string | null>(null);
  useEffect(() => {
    if (!quote || view.status !== 'ready' || view.answeredKey !== view.currentKey) return;
    if (view.currentKey === firstKey.current || announced.current === view.currentKey) return;
    announced.current = view.currentKey;
    announce(totalAnnouncement(quote));
  }, [quote, view.status, view.answeredKey, view.currentKey]);

  // Over $100.00 while Cash is chosen: Card it is, said once (S5.2). Back under doesn't switch back.
  const cashAllowed = quote?.cashAllowed ?? true;
  useEffect(() => {
    if (cashAllowed || method !== 'cash' || cardBlocked) return;
    setMethod('card');
    setPaymentAlert({ key: 'switched', variant: 'info', icon: Info, text: SWITCHED_TO_CARD });
    announce(SWITCHED_TO_CARD);
  }, [cashAllowed, method, cardBlocked]);

  // The place-order limit lifts by itself at its time (B11).
  useEffect(() => {
    if (limitUntil === null) return undefined;
    const timer = setTimeout(() => setLimitUntil(null), Math.max(0, limitUntil - Date.now()));
    return () => clearTimeout(timer);
  }, [limitUntil]);

  // ---------------------------------------------------------------- lines
  const rows = sortLines([...lines, ...(undo ? [undo.line] : [])]);
  let soldOutCount = 0;
  const summaryLines: SummaryLineView[] = rows.map((line) => {
    const answer = quoted.get(line.key);
    const cached = dishes.get(line.menuItemId);
    const nowCents = answer?.unitPriceCents ?? null;
    const soldOut = answer?.status === 'soldOut';
    if (soldOut && undo?.line.key !== line.key) soldOutCount += 1;
    return {
      key: line.key,
      title: answer?.dish?.title ?? cached?.title ?? null,
      suffix: lineSuffix(line, lines),
      image: answer?.dish?.image ?? cached?.image ?? null,
      quantity: line.quantity,
      unitCents: nowCents ?? cached?.priceCents ?? null,
      flavors: line.flavors,
      note: line.note,
      soldOut,
      priceChange:
        nowCents !== null && cached && cached.priceCents !== nowCents
          ? { nowCents, wasCents: cached.priceCents }
          : null,
      droppedFlavors: answer?.droppedFlavors ?? [],
    };
  });
  const titleOf = (line: CartLine) =>
    quoted.get(line.key)?.dish?.title ?? dishes.get(line.menuItemId)?.title ?? 'This dish';

  useEffect(() => {
    if (!focusUndo.current) return;
    focusUndo.current = false;
    undoRef.current?.focus();
  });

  const removeLine = (key: string) => {
    const line = lines.find((item) => item.key === key);
    if (!line) return;
    const title = titleOf(line);
    const removed = cart.remove(line.id);
    if (!removed) return;
    setUndo({ line: removed, title });
    focusUndo.current = true;
    announce(`${title} removed.`);
  };
  const restoreLine = () => {
    if (!undo) return;
    const { line, title } = undo;
    setUndo(null);
    if (cart.restore(line)) {
      announce(`${title} is back in your cart.`);
      requestAnimationFrame(() => removeRefs.current.get(line.key)?.focus());
    }
  };
  const removeSoldOut = () => {
    const soldOut = lines.filter((line) => quoted.get(line.key)?.status === 'soldOut');
    for (const line of soldOut) cart.remove(line.id);
    setPressNotice(null);
    announce(
      soldOut.length === 1
        ? 'Removed 1 sold-out dish.'
        : `Removed ${soldOut.length} sold-out dishes.`,
    );
    focusSoon(editCartRef.current);
  };

  // ---------------------------------------------------------------- notices
  const addressCards = page.addresses;
  const pageNotices: Notice[] = [];
  if (unpaid) {
    pageNotices.push({
      key: 'unpaid',
      variant: 'warning',
      icon: NOTICE_ICONS.unpaid,
      text: unpaidOrderMessage(unpaid.number, unpaid.totalCents, unpaid.expiresAt, timeZone),
      action: (
        <UnpaidActions
          orderId={unpaid.id}
          cancelling={cancelling}
          onCancel={() => {
            void cancelUnpaid();
          }}
          inProgress={unpaidNote}
        />
      ),
    });
  }
  if (closedAtPress) {
    pageNotices.push({ key: 'closed', variant: 'error', icon: Clock, text: closedAtPress });
  } else if (known && !known.store.isOpen) {
    pageNotices.push({
      key: 'closed',
      variant: 'warning',
      icon: Clock,
      text: known.store.opensAt
        ? `We're closed right now. You can order from ${openingPhrase(known.store.opensAt)}.`
        : "We're closed right now.",
    });
  } else if (known?.store.closingSoon && known.store.closesAt) {
    pageNotices.push({
      key: 'closing',
      variant: 'info',
      icon: Clock,
      text: `We stop taking orders at ${formatClock(known.store.closesAt.time)}.`,
    });
  }
  if (unpaidCancelled) {
    pageNotices.push({
      key: 'cancelled',
      variant: 'success',
      icon: NOTICE_ICONS.done,
      text: unpaidCancelled,
      onDismiss: () => setUnpaidCancelled(null),
    });
  }

  const summaryNotices: Notice[] = [];
  if (pressNotice) {
    summaryNotices.push({
      key: `press-${pressNotice.kind}`,
      variant:
        pressNotice.kind === 'soldOut'
          ? 'error'
          : pressNotice.kind === 'promo'
            ? 'warning'
            : 'info',
      icon:
        pressNotice.kind === 'soldOut'
          ? NOTICE_ICONS.soldOut
          : pressNotice.kind === 'promo'
            ? NOTICE_ICONS.promo
            : NOTICE_ICONS.price,
      text: pressNotice.text,
      action:
        pressNotice.kind === 'soldOut' ? (
          <Button
            type="button"
            variant="outline"
            size="touch"
            className="bg-white"
            onClick={removeSoldOut}
          >
            Remove sold-out dishes
          </Button>
        ) : pressNotice.kind === 'promo' &&
          pressNotice.code &&
          pressNotice.totalCents !== undefined ? (
          <Button
            type="button"
            size="touch"
            onClick={() => {
              const total = pressNotice.totalCents;
              cart.setCode(null);
              setPressNotice(null);
              void pay({ withoutCode: true, expectedTotalCents: total });
            }}
          >
            {method === 'card'
              ? `Remove ${pressNotice.code} and pay ${formatPrice(pressNotice.totalCents ?? 0)}`
              : `Remove ${pressNotice.code} and place order · ${formatPrice(pressNotice.totalCents ?? 0)}`}
          </Button>
        ) : undefined,
    });
  } else if (soldOutCount > 0) {
    summaryNotices.push({
      key: 'soldOut',
      variant: 'error',
      icon: NOTICE_ICONS.soldOut,
      text:
        soldOutCount === 1
          ? "1 dish in your cart is sold out today, so it isn't in your total."
          : `${soldOutCount} dishes in your cart are sold out today, so they aren't in your total.`,
      action: (
        <Button
          type="button"
          variant="outline"
          size="touch"
          className="bg-white"
          onClick={removeSoldOut}
        >
          Remove sold-out dishes
        </Button>
      ),
    });
  }
  if (removedCount > 0) {
    summaryNotices.push({
      key: 'removed',
      variant: 'info',
      text:
        removedCount === 1
          ? '1 dish in your cart is no longer on our menu, so we took it out.'
          : `${removedCount} dishes in your cart are no longer on our menu, so we took them out.`,
      onDismiss: () => setRemovedCount(0),
    });
  }
  if (codeEnded) {
    summaryNotices.push({
      key: 'codeEnded',
      variant: 'warning',
      icon: NOTICE_ICONS.promo,
      text: codeEnded,
      onDismiss: () => setCodeEnded(null),
    });
  }
  if (!online) {
    summaryNotices.push({
      key: 'offline',
      variant: 'info',
      text: "You're offline. Your total will update when you're back online.",
    });
  }
  // Notices that appear after the page loaded are read once (design 2.5).
  const spoken = useRef(new Set<string>());
  const noticeWords = [...pageNotices, ...summaryNotices]
    .map((notice) => (typeof notice.text === 'string' ? notice.text : ''))
    .join('\n');
  const loadedWords = useRef<string | null>(null);
  useEffect(() => {
    if (loadedWords.current === null) {
      loadedWords.current = noticeWords;
      for (const text of noticeWords.split('\n')) spoken.current.add(text);
      return;
    }
    for (const text of noticeWords.split('\n')) {
      if (!text || spoken.current.has(text)) continue;
      spoken.current.add(text);
      announce(text);
    }
  }, [noticeWords]);

  // ---------------------------------------------------------------- the pay bar
  const final = quote && quote.totalKind === 'final' ? quote.totalCents : null;
  const blockers = quote?.checkoutBlockers ?? [];
  const noAddress = !addressId || blockers.includes('outside');
  const cashBlocked =
    quote && !quote.cashAllowed ? cashLimitMessage(quote.totalCents, quote.cashLimitCents) : null;
  const newCard =
    method === 'card' && (page.savedCards.length === 0 || demo || cardChoice === NEW_CARD);

  const payContent = ((): PayBarContent => {
    if (press === 'slow') {
      return { kind: 'status', offline: !online, checking, onCheck: () => void checkAttempt() };
    }
    if (page.eligibility === 'unconfirmed') return { kind: 'email', email: page.email };
    if (demo) return { kind: 'demo', onCreateAccount: () => void createAccount() };
    const label = payButtonLabel(method, final);
    const button = (reason: string | null, extra: Partial<ButtonContent> = {}): ButtonContent => ({
      kind: 'button',
      label,
      pendingLabel: null,
      blocked: true,
      reason,
      reasonText: reason,
      ...extra,
    });
    if (pressing) {
      return {
        kind: 'button',
        label,
        pendingLabel: press === 'bank' ? 'Waiting for your bank…' : payPendingLabel(method),
        blocked: false,
        reason: null,
        reasonText: null,
      };
    }
    if (unpaid) return button(PAY_REASONS.unpaid(unpaid.number));
    if (!online) return button(PAY_REASONS.offline);
    if (view.status === 'loading' || view.status === 'updating' || !isReady) {
      return button(view.slow ? PAY_REASONS.updating : null, {
        greyLater: true,
        reasonSpinner: view.slow,
        reasonText: PAY_REASONS.updating,
      });
    }
    if (view.status === 'failed' || view.status === 'tooBig') {
      return button(null, {
        reason: (
          <>
            <span>{PAY_REASONS.failed}</span>
            <button
              type="button"
              onClick={view.retry}
              className="inline-flex h-11 items-center font-medium text-brand-strong underline underline-offset-4"
            >
              Try again
            </button>
          </>
        ),
        reasonTone: 'error',
        reasonText: PAY_REASONS.failed,
      });
    }
    if (view.status === 'rateLimited') return button(PAY_REASONS.rateLimited);
    if (blockers.includes('soldOut') || blockers.includes('empty'))
      return button(PAY_REASONS.soldOut);
    if (closedAtPress || blockers.includes('closed') || (quote && !quote.store.isOpen)) {
      const opens = quote ? orderingOpensText(quote.store.opensAt) : 'Ordering opens soon';
      return { ...button(null), label: opens, reasonText: opens };
    }
    if (noAddress) return button(PAY_REASONS.address);
    if (cashBlocked && cardBlocked) {
      return button(noWayToPayText(paused && pausedUntil ? clockAt(pausedUntil, timeZone) : null));
    }
    if (newCard && cardStatus === 'loading') {
      return { ...button(null), label: 'Loading card form…', reasonText: 'Loading card form…' };
    }
    if (newCard && cardStatus === 'failed') return button(PAY_REASONS.cardFailed);
    if (limitUntil !== null) {
      return button(placeLimitText(clockAt(new Date(limitUntil).toISOString(), timeZone)));
    }
    return {
      kind: 'button',
      label,
      pendingLabel: null,
      blocked: false,
      reason: null,
      reasonText: null,
    };
  })();

  // ---------------------------------------------------------------- pressing (design 2.17)
  const goToOrder = (orderId: string) => router.replace(orderHref(orderId));

  const placedNow = (orderId: string, number: string, confirming: boolean) => {
    const here = { orderId, number, confirming };
    writePlacedHere(here);
    writeAttempt(null);
    markArrival(orderId);
    setPlaced(here);
    if (confirming) {
      markConfirming(orderId);
      markClearCart(orderId);
    } else {
      cart.clear();
    }
    goToOrder(orderId);
  };

  const backToForm = () => {
    setPress('idle');
    pendingAttempt.current = null;
  };

  const showNotSent = (text = NOT_SENT) => {
    backToForm();
    writeAttempt(null);
    setNotSent(text);
    announce(text);
    focusSoon(notSentRef.current);
  };

  const alertPayment = (state: PaymentAlertState, text: string) => {
    setPaymentAlert(state);
    announce(text);
    focusSoon(paymentAlertRef.current);
  };

  async function checkAttempt() {
    const key = pendingAttempt.current;
    if (!key || checking) return;
    setChecking(true);
    const outcome = await callAction(() => attemptStatusAction({ attemptKey: key }));
    setChecking(false);
    if (!outcome.ok) return;
    const status = outcome.data;
    if (status.kind === 'placed') placedNow(status.orderId, status.number, false);
    else if (status.kind === 'awaitingPayment') goToOrder(status.orderId);
    else showNotSent();
  }

  // While the status panel shows: ask again every 10 s, and when back online (S7.3).
  useEffect(() => {
    if (press !== 'slow') return;
    focusSoon(statusRef.current);
    announce(online ? SLOW_PRESS : SLOW_PRESS_OFFLINE);
    // Announced once when it appears.
    // oxlint-disable-next-line react/exhaustive-deps
  }, [press]);
  const checkRef = useRef(checkAttempt);
  useEffect(() => {
    checkRef.current = checkAttempt;
  });
  useEffect(() => {
    if (press !== 'slow' || !online) return undefined;
    const timer = setInterval(() => void checkRef.current(), 10_000);
    return () => clearInterval(timer);
  }, [press, online]);
  useEffect(() => {
    if (press === 'slow' && online) void checkRef.current();
    // Only on coming back online.
    // oxlint-disable-next-line react/exhaustive-deps
  }, [online]);

  /** Refusals at the press: each shows where it belongs (design 2.19). */
  function refused(error: ActionFailure) {
    backToForm();
    const newQuote = quoteOf(error);
    if (newQuote) queryClient.setQueryData(quoteQueryKey(requestKey(request)), newQuote);
    switch (error.code) {
      case 'INVALID_INPUT': {
        setFailure(error);
        const fieldErrors = error.fieldErrors ?? {};
        if (fieldErrors.addressId) {
          setDeliverError(CHOOSE_ADDRESS);
          focusSoon(
            addressGroupRef.current?.querySelector<HTMLInputElement>('input:not(:disabled)'),
          );
          return;
        }
        if (fieldErrors.tip) {
          setOtherBlurred(true);
          focusSoon(document.getElementById(TIP_AMOUNT_ID));
          return;
        }
        if (Object.keys(fieldErrors).length === 0) {
          showNotSent(error.message);
          return;
        }
        focusFirstInvalid(formRef.current);
        return;
      }
      case 'PRICE_CHANGED':
      case 'SOLD_OUT':
        setPressNotice({
          kind: error.code === 'SOLD_OUT' ? 'soldOut' : 'price',
          text: error.code === 'SOLD_OUT' ? soldOutMessage(soldOutDishes(error)) : error.message,
        });
        announce(error.message);
        focusSoon(summaryNoticeRef.current);
        return;
      case 'PROMO_REFUSED': {
        setPressNotice({
          kind: 'promo',
          text: error.message,
          code: asText(error.details?.code),
          totalCents: newQuote?.totalCents,
        });
        announce(error.message);
        focusSoon(summaryNoticeRef.current);
        return;
      }
      case 'OUTSIDE_AREA':
        setDeliverError(CHOOSE_ADDRESS);
        router.refresh();
        focusSoon(addressGroupRef.current?.querySelector<HTMLInputElement>('input:not(:disabled)'));
        return;
      case 'STORE_CLOSED':
        setClosedAtPress(error.message);
        announce(error.message);
        focusSoon(pageNoticeRef.current);
        return;
      case 'CASH_LIMIT':
        setMethod('card');
        alertPayment(
          { key: 'switched', variant: 'info', icon: Info, text: SWITCHED_TO_CARD },
          SWITCHED_TO_CARD,
        );
        return;
      case 'CARD_PAUSED': {
        const until = asText(error.details?.until) ?? null;
        setPausedUntil(until);
        if (cashAllowed) setMethod('cash');
        const words = until ? cardPausedMessage(until, timeZone) : error.message;
        alertPayment({ key: 'paused', variant: 'warning', icon: Clock, text: words }, words);
        return;
      }
      case 'UNPAID_ORDER': {
        const orderId = asText(error.details?.orderId);
        const number = asText(error.details?.number);
        if (orderId && number) {
          setUnpaid({
            id: orderId,
            number,
            totalCents: asCount(error.details?.totalCents) ?? 0,
            expiresAt: asText(error.details?.expiresAt) ?? null,
          });
        }
        announce(error.message);
        focusSoon(pageNoticeRef.current);
        return;
      }
      case 'LIKELY_DUPLICATE': {
        const orderId = asText(error.details?.orderId);
        const number = asText(error.details?.number);
        if (orderId && number) setDuplicate({ orderId, number });
        return;
      }
      case 'RATE_LIMITED':
        setLimitUntil(Date.now() + (error.retryAfterSeconds ?? 60) * 1000);
        announce(error.message);
        return;
      case 'EMAIL_NOT_CONFIRMED':
      case 'DEMO_READ_ONLY':
      case 'NOT_A_CUSTOMER':
      case 'UNAUTHENTICATED':
        router.refresh();
        focusSoon(gateRef.current);
        return;
      case 'STRIPE_NOT_CONFIGURED':
        setMethod('cash');
        alertPayment(
          { key: 'stripe', variant: 'error', text: STRIPE_NOT_SET_UP },
          STRIPE_NOT_SET_UP,
        );
        return;
      case 'NOT_FOUND':
        setCardChoice(NEW_CARD);
        router.refresh();
        alertPayment({ key: 'card', variant: 'error', text: CARD_NOT_SAVED }, CARD_NOT_SAVED);
        return;
      case 'UNAVAILABLE':
        writeAttempt(null);
        alertPayment({ key: 'unavailable', variant: 'error', text: error.message }, error.message);
        return;
      case 'TIMEOUT':
      case 'OFFLINE':
        setPress('slow');
        return;
      default:
        showNotSent();
    }
  }

  /** A card order is waiting: confirm it with Stripe (design 2.17, D18). */
  async function payByCard(orderId: string, number: string, clientSecret: string) {
    const saved = method === 'card' && !newCard ? cardChoice : null;
    const stripe = saved
      ? stripeKey && (await getStripe(stripeKey).catch(() => null))
      : fields.current?.stripe();
    const element = fields.current?.cardNumber() ?? null;
    const paymentMethod = saved
      ? { savedCardId: saved }
      : element
        ? { card: element, name: form.getFieldValue('contactName') }
        : null;
    if (!stripe || !paymentMethod) {
      setPress('slow');
      return;
    }
    const outcome = await confirmCard({
      stripe,
      clientSecret,
      method: paymentMethod,
      onBankCheck: () => setPress('bank'),
    });
    if (outcome.kind === 'succeeded') {
      void callAction(() => orderStatusAction({ orderId, confirmed: true }));
      placedNow(orderId, number, true);
      return;
    }
    if (outcome.kind === 'unreachable') {
      setPress('slow');
      return;
    }
    // Declined: the server learns it now, the attempt ends, a new press is a new attempt (U2).
    await callAction(() => orderStatusAction({ orderId, confirmed: true }));
    writeAttempt(null);
    backToForm();
    const card = saved ? page.savedCards.find((item) => item.id === saved) : null;
    const text = declineMessage(
      { code: outcome.code, declineCode: outcome.declineCode },
      card?.label,
    );
    const spokenText = card ? text.replace(card.label, card.spoken) : text;
    if (saved) setCardChoice(NEW_CARD);
    else fields.current?.clear();
    setPaymentAlert({ key: 'decline', variant: 'error', text });
    announce(spokenText);
    if (outcome.code === 'incorrect_cvc' && !saved) {
      requestAnimationFrame(() => fields.current?.showCvcError(text));
    } else {
      focusSoon(paymentAlertRef.current);
    }
  }

  async function pay(
    options: { allowDuplicate?: boolean; withoutCode?: boolean; expectedTotalCents?: number } = {},
  ) {
    if (pressing || press === 'slow') return;
    setNotSent(null);
    setPressNotice(null);
    setFailure(null);
    setDeliverError(null);
    if (paymentAlert?.key === 'decline' || paymentAlert?.key === 'card') setPaymentAlert(null);

    // Checked in the browser first; nothing is sent while anything is wrong (S2.9).
    if (!addressId) {
      setDeliverError(CHOOSE_ADDRESS);
      announce(CHOOSE_ADDRESS);
      focusSoon(
        addressGroupRef.current?.querySelector<HTMLInputElement>('input:not(:disabled)') ??
          document.querySelector<HTMLElement>('[data-add-address]'),
      );
      return;
    }
    const contactOk = await checkContact();
    const tipOk = tile.kind !== 'other' || tipAmount.kind !== 'error';
    if (!tipOk) setOtherBlurred(true);
    if (!contactOk || !tipOk) {
      focusFirstInvalid(formRef.current);
      return;
    }
    if (newCard && !fields.current?.check()) return;

    const expected = options.expectedTotalCents ?? final;
    if (expected === null || expected === undefined || !quote) return;
    const values = form.state.values;
    const card: PlaceOrderInput['card'] =
      method === 'card'
        ? newCard
          ? { kind: 'new', save: saveCard }
          : { kind: 'saved', paymentMethodId: cardChoice }
        : undefined;
    const code = options.withoutCode ? undefined : (meta.code ?? undefined);
    const fingerprint = attemptFingerprint({
      lines: request.lines,
      code: code ?? null,
      addressId,
      tip,
      method,
      card: card ?? null,
      name: values.contactName,
      phone: values.phone,
      note: values.kitchenNote,
      expected,
    });
    const stored = readAttempt();
    const attemptKey = stored?.fingerprint === fingerprint ? stored.key : newAttemptKey();
    writeAttempt({ key: attemptKey, fingerprint, pressed: true });
    pendingAttempt.current = attemptKey;

    const input: PlaceOrderInput = {
      attemptKey,
      lines: request.lines,
      ...(code ? { code } : {}),
      addressId,
      tip,
      method,
      ...(card ? { card } : {}),
      contactName: values.contactName,
      phone: values.phone,
      phoneCountry: values.phoneCountry,
      savePhone: values.savePhone && Boolean(values.phone) && !demo,
      ...(values.kitchenNote.trim() ? { kitchenNote: values.kitchenNote } : {}),
      expectedTotalCents: expected,
      shown: {
        lines: quote.lines.flatMap((line) =>
          line.status === 'ok' && line.unitPriceCents !== null
            ? [{ key: line.key, unitPriceCents: line.unitPriceCents }]
            : [],
        ),
        deliveryFeeCents: quote.delivery.feeCents,
        ...(quote.promo?.status === 'applied' ? { promoAmountCents: quote.promo.amountCents } : {}),
      },
      ...(options.allowDuplicate ? { allowDuplicate: true } : {}),
    };

    setPress('pressing');
    const outcome = await callAction(() => placeOrderAction(input));
    if (!outcome.ok) {
      refused(outcome.error);
      return;
    }
    const result = outcome.data;
    if (result.kind === 'placed') {
      placedNow(result.orderId, result.number, false);
      return;
    }
    await payByCard(result.orderId, result.number, result.clientSecret);
  }

  async function cancelUnpaid() {
    if (!unpaid || cancelling) return;
    setCancelling(true);
    setUnpaidNote(null);
    const outcome = await callAction(() => cancelOrderAction({ orderId: unpaid.id }));
    setCancelling(false);
    if (outcome.ok) {
      const text = `Order ${unpaid.number} is cancelled. You can place your order now.`;
      setUnpaid(null);
      setUnpaidCancelled(text);
      announce(text);
      focusSoon(pageNoticeRef.current);
      void queryClient.invalidateQueries({ queryKey: ['cart-quote'] });
      return;
    }
    const text =
      outcome.error.code === 'PAYMENT_IN_PROGRESS'
        ? paymentInProgressMessage(unpaid.number)
        : outcome.error.message;
    setUnpaidNote(text);
    announce(text);
  }

  async function createAccount() {
    try {
      const response = await fetch('/api/auth/sign-out', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      if (!response.ok) throw new Error('sign-out refused');
    } catch {
      announce("We couldn't sign you out. Try again in a moment.");
      return;
    }
    keepCartAsGuest();
    window.location.assign(signInFor('/sign-up', '/checkout', 'checkout'));
  }

  // ---------------------------------------------------------------- the pinned bar while typing (D5)
  const typingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const startTyping = () => {
    if (!window.matchMedia(COARSE_NARROW).matches) return;
    clearTimeout(typingTimer.current);
    setTyping(true);
  };
  const stopTyping = () => {
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => setTyping(false), 100);
  };
  useEffect(() => () => clearTimeout(typingTimer.current), []);

  // ---------------------------------------------------------------- render
  if (isReady && lines.length === 0 && !undo) {
    return placed ? (
      <PlacedGate orderId={placed.orderId} number={placed.number} confirming={placed.confirming} />
    ) : (
      <EmptyCartGate />
    );
  }

  const otherError =
    tile.kind === 'other' && otherBlurred && tipAmount.kind === 'error'
      ? tipAmount.message
      : (failure?.fieldErrors?.tip?.[0] ?? null);
  const goBackHref: Route = '/menu';

  return (
    <PageContainer>
      <div className="py-4">
        <Button
          asChild
          variant="outline"
          size="touch"
          className="border-brand-strong bg-transparent text-brand-strong hover:bg-brand-soft hover:text-brand-strong"
        >
          <Link
            href={goBackHref}
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              const previous = previousRoute();
              if (previous && pathOf(previous) !== '/checkout') {
                event.preventDefault();
                router.back();
              }
            }}
          >
            <ArrowLeft className="size-6" aria-hidden />
            Go back
          </Link>
        </Button>
      </div>

      <div
        onFocusCapture={(event) => {
          if (isTextField(event.target)) startTyping();
        }}
        onBlurCapture={(event) => {
          if (isTextField(event.target)) stopTyping();
        }}
        className={cn(
          'pb-[calc(var(--pay-bar-h,7rem)+2rem)] md:mx-auto md:max-w-[672px]',
          'lg:mx-0 lg:grid lg:max-w-none lg:grid-cols-[minmax(0,1fr)_377px] lg:grid-rows-[auto_1fr] lg:gap-x-12 lg:pt-15 lg:pb-15',
          'xl:grid-cols-12 xl:gap-x-6 xl:pt-20 xl:pb-20',
          '[@media(max-height:480px)]:pb-10',
        )}
      >
        <header className="lg:col-start-1 lg:row-start-1 xl:col-span-5">
          {demo && !demoNoticeDismissed ? <DemoNotice /> : null}
          <h1
            tabIndex={-1}
            className="font-heading text-h4 leading-tight text-neutral-2 focus:outline-none md:text-h2"
          >
            Confirm and pay
          </h1>
          <p className="mt-3 text-body-4 text-muted-foreground md:text-body-2 xl:text-body-1">
            Hooray! This is the last step before your meal.
          </p>
          <NoticeList
            notices={pageNotices}
            focusRef={pageNoticeRef}
            className="mt-6 space-y-3 outline-none"
          />
          <div className="mt-8 lg:hidden" />
        </header>

        <CheckoutSummary
          lines={summaryLines}
          undo={undo ? { key: undo.line.key, title: undo.title } : null}
          itemCount={itemCount}
          quote={quote}
          status={isReady ? view.status : 'loading'}
          dim={view.dim}
          open={summaryOpen}
          onToggle={() => setSummaryOpen((current) => !current)}
          onRemove={removeLine}
          onUndo={restoreLine}
          onEditCart={(button) => openCart(button)}
          notices={
            summaryNotices.length > 0 ? (
              <NoticeList notices={summaryNotices} focusRef={summaryNoticeRef} />
            ) : null
          }
          promo={
            <PromoSection
              request={{ lines: request.lines, delivery: request.delivery, tip, method }}
              quote={quote}
              storedCode={meta.code}
              signedIn
              onCodeEnded={setCodeEnded}
              onAction={() => setUndo(null)}
              onNavigate={() => undefined}
              showOffers={false}
              className="mt-6"
            />
          }
          undoRef={undoRef}
          removeRef={(key, element) => {
            if (element) removeRefs.current.set(key, element);
            else removeRefs.current.delete(key);
          }}
          editCartRef={editCartRef}
          loading={!isReady}
          inert={pressing}
        />

        <div className="lg:col-start-1 lg:row-start-2 xl:col-span-5">
          <form
            ref={formRef}
            id="checkout"
            method="post"
            noValidate
            inert={pressing}
            onSubmit={(event) => {
              // Enter in a field never places the order (D47): only the pay button does.
              event.preventDefault();
            }}
            className="mt-10 space-y-10 lg:mt-12 lg:space-y-12"
          >
            <DeliverTo
              addresses={addressCards}
              addressLimit={page.addressLimit}
              chosenId={addressId}
              onChoose={(id) => {
                setChosenId(id);
                cart.setAddressId(id);
                setDeliverError(null);
              }}
              onAdd={(button) => {
                dialogOpener.current = button;
                setDialog({ open: true, address: null });
              }}
              onEdit={(address, button) => {
                dialogOpener.current = button;
                setDialog({
                  open: true,
                  address: addressBook.find((item) => item.id === address.id) ?? null,
                });
              }}
              error={deliverError}
              demo={demo}
              groupRef={addressGroupRef}
            />
            <ContactFields
              form={form}
              countries={countries}
              profilePhone={page.profile.phone}
              demo={demo}
              failure={failure}
              onEdited={(field) => setFailure((current) => withoutFieldError(current, field))}
              onNote={(text) => {
                note.current = text;
                writeChoices({ tip: tile, otherText, note: text, summaryOpen });
              }}
            />
            <ArrivalBox quote={known} failed={failedQuote} dim={view.dim} />
            <TipPicker
              tile={tile}
              onTile={(next) => {
                setTile(next);
                setFailure((current) => withoutFieldError(current, 'tip'));
              }}
              otherText={otherText}
              onOtherText={(text) => {
                setOtherText(text);
                const amount = parseTipAmount(text);
                if (amount.kind === 'ok') setLastValidTip(amount.cents);
              }}
              onOtherBlur={() => setOtherBlurred(true)}
              otherError={otherError}
              otherCents={tipAmount.kind === 'ok' ? tipAmount.cents : null}
              quote={known}
              failed={failedQuote}
              dim={view.dim}
            />
            <PaymentMethod
              method={method}
              onMethod={(next) => {
                setMethod(next);
                setPaymentAlert(null);
              }}
              cardBlocked={cardBlocked}
              cashBlocked={cashBlocked}
              alert={
                newCard && cardStatus === 'failed'
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
                          onClick={() => setCardAttempt((count) => count + 1)}
                        >
                          Try again
                        </Button>
                      ),
                    }
                  : paymentAlert
              }
              alertRef={paymentAlertRef}
              totalCents={final}
              tipCents={quote?.tipCents ?? 0}
              card={
                stripeKey ? (
                  <CardSection
                    savedCards={page.savedCards.filter((saved) => !goneCards.has(saved.id))}
                    onRemoveCard={(saved, button) => {
                      cardOpener.current = button;
                      setRemovingCard(saved);
                    }}
                    savedCardLimit={page.savedCardLimit}
                    choice={cardChoice}
                    onChoice={(choice) => {
                      setCardChoice(choice);
                      setPaymentAlert(null);
                    }}
                    saveCard={saveCard}
                    onSaveCard={setSaveCard}
                    publishableKey={stripeKey}
                    testMode={page.stripe.testMode}
                    demo={demo}
                    fieldsRef={fields}
                    formAttempt={cardAttempt}
                    onFormStatus={setCardStatus}
                    onFocusChange={(focused) => (focused ? startTyping() : stopTyping())}
                  />
                ) : null
              }
            />
          </form>

          <PayBar
            content={payContent}
            onPay={() => void pay()}
            notice={notSent ? <NotSentNotice>{notSent}</NotSentNotice> : null}
            noticeRef={notSentRef}
            statusRef={statusRef}
            gateRef={gateRef}
            buttonRef={payButtonRef}
            typing={typing}
          />
        </div>
      </div>

      <AddressDialog
        open={dialog.open}
        address={dialog.address}
        store={store}
        firstAddress={page.addressCount === 0}
        draftOwner={draftOwner}
        onClose={() => setDialog((current) => ({ ...current, open: false }))}
        onSaved={(address, edited) => {
          setChosenId(address.id);
          cart.setAddressId(address.id);
          setDeliverError(null);
          dialogOpener.current = null;
          announce(edited ? 'Address updated' : 'Address saved');
          router.refresh();
        }}
        returnFocus={() => {
          const opener = dialogOpener.current;
          if (opener?.isConnected) opener.focus();
          else
            requestAnimationFrame(() =>
              addressGroupRef.current?.querySelector<HTMLInputElement>('input:checked')?.focus(),
            );
        }}
      />

      <RemoveCardDialog
        card={removingCard}
        onClose={() => setRemovingCard(null)}
        onRemoved={(saved, outcome) => {
          setGoneCards((current) => new Set([...current, saved.id]));
          setRemovingCard(null);
          announce(outcome === 'removed' ? 'Card removed' : 'That card is no longer saved.');
          // Focus moves to the next card in the group (design 2.13 a).
          requestAnimationFrame(() =>
            document
              .querySelector<HTMLInputElement>('input[name="card-saved-card"]:not(:disabled)')
              ?.focus(),
          );
        }}
        onCloseFocus={() => cardOpener.current?.focus()}
      />

      <DuplicateDialog
        duplicate={duplicate}
        pending={pressing}
        pendingLabel={payPendingLabel(method)}
        onView={() => {
          if (duplicate) goToOrder(duplicate.orderId);
        }}
        onPlaceAgain={() => {
          writeAttempt(null);
          setDuplicate(null);
          void pay({ allowDuplicate: true });
        }}
        onClose={() => {
          setDuplicate(null);
          focusSoon(payButtonRef.current);
        }}
      />
    </PageContainer>
  );
}
