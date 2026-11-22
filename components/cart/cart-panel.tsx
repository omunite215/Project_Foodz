'use client';

import { Trash2, X } from 'lucide-react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { type Ref, useEffect, useId, useRef, useState } from 'react';
import type { DeliveryTargetInput, Quote, QuoteLine } from '@/server/modules/cart/schema';
import { dishHref } from '@/server/modules/menu/urls';
import { EmptyState } from '@/components/states/empty-state';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { SheetTitle } from '@/components/ui/sheet';
import { announce } from '@/lib/announce';
import {
  lineSuffix,
  linesLabel,
  removedSoldOutText,
  storeClosedText,
  totalAnnouncement,
} from '@/lib/cart-text';
import {
  type CartLine,
  MAX_CART_ITEMS,
  MAX_CART_LINES,
  sortLines,
  useCart,
  useCartActions,
  useCartMeta,
} from '@/lib/data/cart';
import { useCartDishActions, useCartDishes } from '@/lib/data/cart-dishes';
import { plural } from '@/lib/format';
import { signInFor } from '@/lib/sign-in-reason';
import { useOnline } from '@/lib/use-online';
import { cn } from '@/lib/utils';
import { CartLineEditor, CartLineItem, type CartLineView, UndoRow } from './cart-line';
import {
  CART_FULL_NOTICE_ID,
  type CartNotice,
  type CartNoticeKind,
  CartNotices,
  noticeText,
} from './cart-notices';
import { useUnpaidOrder } from './use-unpaid-order';
import { CheckoutBar } from './checkout-bar';
import { setCheckedAddress, useCheckedAddress } from '@/lib/data/checked-address';
import { DeliveryBlock, useSavedAddresses } from './delivery-block';
import { PriceBreakdown } from './price-breakdown';
import { PromoSection } from './promo';
import { useQuote } from './use-quote';

/*
 * The inside of the cart dialog (F3 design 2.1 to 2.18): header, notices, lines, promo code,
 * offers, delivery and price details, with the total and "Go to checkout" pinned below. Lines
 * render at once from this device; every figure comes from the server's quote.
 */

export interface CartPanelProps {
  signedIn: boolean;
  /** "(617) 555-0142" and its tel: form, for the cart-full notice. */
  phone: { display: string; tel: string } | null;
  /** On /menu, "Browse the menu" only closes the cart. */
  onMenu: boolean;
  titleRef: Ref<HTMLHeadingElement>;
  /** Close the cart from inside (button, "Browse the menu" on /menu). */
  onClose: () => void;
  /** A link inside the cart is about to replace its history entry. */
  onNavigate: () => void;
  /** Opened from checkout: its footer button reads "Back to checkout" and only closes it. */
  onCheckoutPage?: boolean;
}

interface Undo {
  line: CartLine;
  title: string;
}

type FocusTarget =
  | { kind: 'remove'; key: string }
  | { kind: 'edit'; key: string }
  | { kind: 'edit-id'; id: string }
  | { kind: 'undo' }
  | { kind: 'first-line' }
  | { kind: 'browse' };

const toQuoteLine = (line: CartLine) => ({
  key: line.key,
  menuItemId: line.menuItemId,
  flavors: line.flavors,
  quantity: line.quantity,
  ...(line.note ? { note: line.note } : {}),
});

export function CartPanel({
  signedIn,
  phone,
  onMenu,
  titleRef,
  onClose,
  onNavigate,
  onCheckoutPage = false,
}: CartPanelProps) {
  const router = useRouter();
  const id = useId();
  const { lines, itemCount, isReady } = useCart();
  const meta = useCartMeta();
  const cart = useCartActions();
  const dishes = useCartDishes();
  const dishActions = useCartDishActions();
  const storedPoint = useCheckedAddress();
  const online = useOnline();
  // Signed in with saved addresses, the saved default wins over an address checked before
  // signing in (2.15, S2.6), and "Change" lists the saved ones. With none saved, a checked
  // address still counts.
  const addressBook = useSavedAddresses(signedIn);
  const unpaidOrder = useUnpaidOrder(signedIn).data ?? null;
  const hasSaved = (addressBook.data?.addresses.length ?? 0) > 0;
  const checked =
    storedPoint && (!signedIn || (addressBook.isFetched && !hasSaved)) ? storedPoint : null;
  useEffect(() => {
    if (signedIn && hasSaved && storedPoint) setCheckedAddress(null);
  }, [signedIn, hasSaved, storedPoint]);

  const [undo, setUndo] = useState<Undo | null>(null);
  const [editing, setEditing] = useState<ReadonlySet<string>>(new Set());
  const [dismissed, setDismissed] = useState<ReadonlySet<CartNoticeKind>>(new Set());
  const [removedCount, setRemovedCount] = useState(0);
  const [codeEnded, setCodeEnded] = useState<string | null>(null);
  const [dropped, setDropped] = useState<ReadonlyMap<string, string[]>>(new Map());
  /** Where focus goes once the next render is on screen (S7.1, design 2.7, 2.8). */
  const focusTarget = useRef<FocusTarget | null>(null);
  const focusAfter = (target: FocusTarget) => {
    focusTarget.current = target;
  };
  const [confirmEmpty, setConfirmEmpty] = useState(false);

  const removeRefs = useRef(new Map<string, HTMLButtonElement>());
  const editRefs = useRef(new Map<string, HTMLButtonElement>());
  const nameRefs = useRef(new Map<string, HTMLAnchorElement>());
  const undoRef = useRef<HTMLButtonElement>(null);
  const browseRef = useRef<HTMLButtonElement>(null);
  const emptyCartRef = useRef<HTMLButtonElement>(null);

  // ---------------------------------------------------------------- the quote
  const delivery: DeliveryTargetInput = checked
    ? { kind: 'point', lat: checked.lat, lng: checked.lng }
    : signedIn
      ? meta.addressId
        ? { kind: 'saved', addressId: meta.addressId }
        : { kind: 'default' }
      : { kind: 'none' };
  const baseRequest = { lines: lines.map(toQuoteLine), delivery };

  // Answers act on the cart as it is when they arrive.
  const latest = useRef({ lines, cart, dishActions });
  useEffect(() => {
    latest.current = { lines, cart, dishActions };
  });

  /** What each answer says about the lines: names and photos, dishes gone, extras dropped. */
  const onAnswer = (answer: Quote) => {
    const now = latest.current;
    now.dishActions.learn(
      answer.lines.flatMap((line) =>
        line.dish && line.unitPriceCents !== null
          ? [{ id: line.menuItemId, ...line.dish, unitPriceCents: line.unitPriceCents }]
          : [],
      ),
    );
    const byKey = new Map(now.lines.map((line) => [line.key, line]));
    let gone = 0;
    const newlyDropped = new Map<string, string[]>();
    for (const answered of answer.lines) {
      const line = byKey.get(answered.key);
      if (!line) continue;
      if (answered.status === 'removed') {
        now.cart.remove(line.id);
        gone += 1;
      } else if (answered.droppedFlavors.length > 0) {
        newlyDropped.set(line.key, answered.droppedFlavors);
        now.cart.edit(line.id, { flavors: answered.flavors, note: line.note });
      }
    }
    if (gone > 0) {
      setRemovedCount((count) => count + gone);
      setDismissed((current) => new Set([...current].filter((kind) => kind !== 'removed')));
    }
    if (newlyDropped.size > 0) setDropped((current) => new Map([...current, ...newlyDropped]));
  };

  const view = useQuote(
    { ...baseRequest, ...(meta.code ? { code: meta.code } : {}) },
    isReady && lines.length > 0,
    onAnswer,
  );
  const quote = view.quote;
  const known = quote ?? view.lastQuote;
  const quoted = new Map<string, QuoteLine>((known?.lines ?? []).map((line) => [line.key, line]));

  // The figures she just changed are announced once they settle (S7.3); opening is not.
  const firstKey = useRef(view.currentKey);
  const announced = useRef<string | null>(null);
  useEffect(() => {
    if (!quote || view.status !== 'ready' || view.answeredKey !== view.currentKey) return;
    if (view.currentKey === firstKey.current || announced.current === view.currentKey) return;
    announced.current = view.currentKey;
    announce(totalAnnouncement(quote));
  }, [quote, view.status, view.answeredKey, view.currentKey]);

  // Unit prices shown now; they become the "last shown" ones once the cart closes (B8).
  const shownPrices = new Map(
    (known?.lines ?? []).flatMap((line) =>
      line.unitPriceCents === null ? [] : [[line.menuItemId, line.unitPriceCents] as const],
    ),
  );
  const pricesAtClose = useRef(shownPrices);
  useEffect(() => {
    pricesAtClose.current = shownPrices;
  });
  useEffect(
    () => () => {
      latest.current.dishActions.acknowledgePrices(pricesAtClose.current);
    },
    [],
  );

  // The display cache keeps only the dishes in the cart.
  const dishIds = [...new Set(lines.map((line) => line.menuItemId))].toSorted().join(',');
  useEffect(() => {
    if (isReady && dishIds) latest.current.dishActions.keepOnly(new Set(dishIds.split(',')));
  }, [isReady, dishIds]);

  // ---------------------------------------------------------------- line views
  const views = new Map<string, CartLineView>();
  let priceChanges = 0;
  let soldOutCount = 0;
  for (const line of lines) {
    const answer = quoted.get(line.key);
    const cached = dishes.get(line.menuItemId);
    const unitCents = answer?.unitPriceCents ?? cached?.priceCents ?? null;
    const nowCents = answer?.unitPriceCents ?? null;
    const priceChange =
      nowCents !== null && cached && cached.priceCents !== nowCents
        ? { nowCents, wasCents: cached.priceCents }
        : null;
    if (priceChange) priceChanges += 1;
    const soldOut = answer?.status === 'soldOut';
    if (soldOut) soldOutCount += 1;
    const title = answer?.dish?.title ?? cached?.title ?? null;
    const slug = answer?.dish?.slug ?? cached?.slug ?? null;
    views.set(line.key, {
      id: line.id,
      title,
      href: slug ? dishHref(slug) : null,
      image: answer?.dish?.image ?? cached?.image ?? null,
      quantity: line.quantity,
      flavors: line.flavors,
      note: line.note,
      unitCents,
      soldOut,
      priceChange,
      droppedFlavors: dropped.get(line.key) ?? [],
      flavorsOffered: answer ? answer.flavorsOffered : null,
    });
  }
  const titleOf = (line: CartLine) => views.get(line.key)?.title ?? 'This dish';

  // ---------------------------------------------------------------- notices
  const fullLimit =
    itemCount >= MAX_CART_ITEMS || view.status === 'tooBig'
      ? 'items'
      : lines.length >= MAX_CART_LINES
        ? 'lines'
        : null;
  const candidates: (CartNotice | null)[] = [
    unpaidOrder ? { kind: 'unpaid', ...unpaidOrder } : null,
    meta.placed && isReady && lines.length === 0 ? { kind: 'placed', ...meta.placed } : null,
    known && !known.store.isOpen
      ? { kind: 'closed', text: storeClosedText(known.store.opensAt) }
      : null,
    soldOutCount > 0 ? { kind: 'soldOut', count: soldOutCount } : null,
    removedCount > 0 ? { kind: 'removed', count: removedCount } : null,
    priceChanges > 0 ? { kind: 'priceChanged', count: priceChanges } : null,
    codeEnded ? { kind: 'codeEnded', text: codeEnded } : null,
    fullLimit
      ? { kind: 'full', limit: fullLimit, phone: phone?.display ?? null, tel: phone?.tel ?? null }
      : null,
    online ? null : { kind: 'offline' },
  ];
  const notices = candidates.filter(
    (notice): notice is CartNotice => notice !== null && !dismissed.has(notice.kind),
  );
  const noticeWords = notices.map(noticeText).join('\n');
  const spokenNotices = useRef(new Set<string>());
  useEffect(() => {
    for (const text of noticeWords.split('\n')) {
      if (!text || spokenNotices.current.has(text)) continue;
      spokenNotices.current.add(text);
      announce(text);
    }
  }, [noticeWords]);

  const cartFull = fullLimit
    ? {
        id: CART_FULL_NOTICE_ID,
        text: noticeText({
          kind: 'full',
          limit: fullLimit,
          phone: phone?.display ?? null,
          tel: null,
        }),
      }
    : null;

  // ---------------------------------------------------------------- focus after a change
  // Runs after every render: the element to focus exists once the change has been drawn.
  useEffect(() => {
    const target = focusTarget.current;
    if (!target) return;
    let element: HTMLElement | null | undefined = null;
    if (target.kind === 'remove') element = removeRefs.current.get(target.key);
    else if (target.kind === 'edit') element = editRefs.current.get(target.key);
    else if (target.kind === 'edit-id') {
      const line = latest.current.lines.find((item) => item.id === target.id);
      element = line ? editRefs.current.get(line.key) : null;
    } else if (target.kind === 'undo') element = undoRef.current;
    else if (target.kind === 'browse') element = browseRef.current;
    else {
      const first = latest.current.lines[0];
      element = first ? nameRefs.current.get(first.key) : browseRef.current;
    }
    if (!element) return;
    element.focus();
    focusTarget.current = null;
  });

  // ---------------------------------------------------------------- actions
  /** Her next action in the cart: the undo row goes, the list closes up (S1.8). */
  const acted = () => setUndo(null);

  const remove = (line: CartLine) => {
    const title = titleOf(line);
    const removed = cart.remove(line.id);
    if (!removed) return;
    setEditing((current) => {
      const next = new Set(current);
      next.delete(line.key);
      return next;
    });
    setUndo({ line: removed, title });
    focusAfter({ kind: 'undo' });
    announce(`${title} removed.`);
  };

  const restore = () => {
    if (!undo) return;
    if (cart.restore(undo.line)) {
      announce(`${undo.title} is back in your cart.`);
      focusAfter({ kind: 'remove', key: undo.line.key });
    }
    setUndo(null);
  };

  const removeSoldOut = () => {
    acted();
    const soldOut = lines.filter((line) => views.get(line.key)?.soldOut);
    for (const line of soldOut) cart.remove(line.id);
    announce(removedSoldOutText(soldOut.length));
    focusAfter({ kind: 'first-line' });
  };

  const save = (line: CartLine, change: { flavors: string[]; note: string }) => {
    acted();
    const title = titleOf(line);
    const outcome = cart.edit(line.id, change);
    setEditing((current) => {
      const next = new Set(current);
      next.delete(line.key);
      return next;
    });
    if (outcome.kind === 'merged') {
      const extras = change.flavors.length > 0 ? ` with ${change.flavors.join(', ')}` : '';
      announce(
        `Merged with your other ${title}${extras}. You now have ${outcome.quantity}${
          outcome.capped ? ', the most for one dish' : ''
        }.`,
      );
      focusAfter({ kind: 'edit-id', id: outcome.id });
      return;
    }
    announce(`${title} updated.`);
    focusAfter({ kind: 'edit', key: line.key });
  };

  const emptyAll = () => {
    cart.clear();
    setUndo(null);
    setConfirmEmpty(false);
    announce('Your cart is empty.');
    focusAfter({ kind: 'browse' });
  };

  const goTo = (href: Route) => {
    onNavigate();
    router.replace(href);
  };

  const checkout = () => {
    if (onCheckoutPage) {
      onClose();
      return;
    }
    goTo(signedIn ? '/checkout' : signInFor('/sign-in', '/checkout', 'checkout'));
  };

  // ---------------------------------------------------------------- render
  const empty = isReady && lines.length === 0 && !undo;
  const rows: { key: string; line: CartLine; undo: boolean }[] = sortLines([
    ...lines,
    ...(undo ? [undo.line] : []),
  ]).map((line) => ({ key: line.key, line, undo: undo?.line.key === line.key }));

  return (
    <div className="flex h-full min-h-0 flex-col bg-neutral-8 [@media(max-height:480px)]:overflow-y-auto">
      <div className="sticky top-0 z-10 flex h-16 shrink-0 items-center justify-between gap-3 border-b border-neutral-6 bg-white px-4 md:px-6">
        <SheetTitle
          ref={titleRef}
          tabIndex={-1}
          className="font-heading text-title-2 text-neutral-2 focus:outline-none"
        >
          Your cart
          {itemCount > 0 ? (
            <span aria-hidden className="tabular-nums">
              {' '}
              ({itemCount})
            </span>
          ) : null}
        </SheetTitle>
        <Button
          type="button"
          variant="ghost"
          size="icon-touch"
          aria-label="Close cart"
          onClick={onClose}
          className="-mr-2 rounded-full hover:bg-neutral-7"
        >
          <X className="size-6" aria-hidden />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-5 pb-8 md:px-6 [@media(max-height:480px)]:flex-none [@media(max-height:480px)]:overflow-visible">
        <CartNotices
          notices={notices}
          onDismiss={(kind) => {
            if (kind === 'priceChanged') dishActions.acknowledgePrices(shownPrices);
            if (kind === 'placed') cart.setPlaced(null);
            setDismissed((current) => new Set([...current, kind]));
          }}
          onRemoveSoldOut={removeSoldOut}
          onNavigate={onNavigate}
        />

        {empty ? (
          <EmptyState
            illustration="emptyCart"
            title="Your cart is empty"
            description="Dishes you add will show up here."
            titleAs="h3"
            className="py-12"
            action={
              <Button
                ref={browseRef}
                type="button"
                size="touch"
                className="uppercase"
                onClick={() => (onMenu ? onClose() : goTo('/menu'))}
              >
                Browse the menu
              </Button>
            }
          />
        ) : (
          <>
            <ul
              aria-label={linesLabel(itemCount)}
              className={cn('space-y-3', notices.length > 0 && 'mt-5')}
            >
              {rows.map(({ key, line, undo: isUndo }) => {
                if (isUndo && undo) {
                  return (
                    <li key={key}>
                      <UndoRow title={undo.title} onUndo={restore} undoRef={undoRef} />
                    </li>
                  );
                }
                const lineView = views.get(key);
                if (!lineView) return null;
                const isEditing = editing.has(key);
                return (
                  <li key={key} className="rounded-lg border border-neutral-6 bg-white p-3 md:p-4">
                    <CartLineItem
                      line={lineView}
                      suffix={lineSuffix(line, lines)}
                      cartFull={cartFull}
                      editing={isEditing}
                      editorId={`${id}-editor-${key}`}
                      editor={
                        isEditing ? (
                          <CartLineEditor
                            flavorsOffered={lineView.flavorsOffered ?? []}
                            flavors={line.flavors}
                            note={line.note ?? ''}
                            onSave={(change) => save(line, change)}
                            onCancel={() => {
                              setEditing((current) => {
                                const next = new Set(current);
                                next.delete(key);
                                return next;
                              });
                              focusAfter({ kind: 'edit', key });
                            }}
                          />
                        ) : null
                      }
                      onQuantity={(quantity) => {
                        acted();
                        cart.setQuantity(line.id, quantity);
                      }}
                      onRemove={() => remove(line)}
                      onEdit={() => {
                        acted();
                        setEditing((current) => {
                          const next = new Set(current);
                          if (next.has(key)) next.delete(key);
                          else next.add(key);
                          return next;
                        });
                      }}
                      onNavigate={onNavigate}
                      editRef={(element) => {
                        if (element) editRefs.current.set(key, element);
                        else editRefs.current.delete(key);
                      }}
                      removeRef={(element) => {
                        if (element) removeRefs.current.set(key, element);
                        else removeRefs.current.delete(key);
                      }}
                      nameRef={(element) => {
                        if (element) nameRefs.current.set(key, element);
                        else nameRefs.current.delete(key);
                      }}
                    />
                  </li>
                );
              })}
            </ul>
            {lines.length > 0 ? (
              <div className="mt-2 flex justify-end">
                <Button
                  ref={emptyCartRef}
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    acted();
                    setConfirmEmpty(true);
                  }}
                  className="h-11 px-2 text-button-2 font-medium text-destructive hover:bg-neutral-7 hover:text-destructive"
                >
                  <Trash2 className="size-4" aria-hidden />
                  Empty cart
                </Button>
              </div>
            ) : null}

            {lines.length > 0 ? (
              <>
                <PromoSection
                  request={baseRequest}
                  quote={quote}
                  storedCode={meta.code}
                  signedIn={signedIn}
                  onCodeEnded={(text) => {
                    setCodeEnded(text);
                    setDismissed(
                      (current) => new Set([...current].filter((kind) => kind !== 'codeEnded')),
                    );
                  }}
                  onAction={acted}
                  onNavigate={onNavigate}
                />
                <DeliveryBlock
                  quote={known}
                  signedIn={signedIn}
                  checked={checked}
                  chosenId={meta.addressId}
                  onPickSaved={(addressId) => {
                    setCheckedAddress(null);
                    cart.setAddressId(addressId);
                  }}
                  onCheck={setCheckedAddress}
                  onAction={acted}
                  onNavigate={onNavigate}
                />
                <PriceBreakdown
                  quote={quote}
                  status={view.status}
                  dim={view.dim}
                  headingId={`${id}-price`}
                />
              </>
            ) : null}
          </>
        )}
      </div>

      {empty || lines.length === 0 ? null : (
        <CheckoutBar
          quote={quote}
          status={view.status}
          dim={view.dim}
          slow={view.slow}
          onCheckout={checkout}
          onRetry={view.retry}
          backToCheckout={onCheckoutPage}
        />
      )}

      <AlertDialog
        open={confirmEmpty}
        onOpenChange={(open) => {
          setConfirmEmpty(open);
          if (!open) requestAnimationFrame(() => emptyCartRef.current?.focus());
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>
            Remove all {plural(itemCount, 'item')} from your cart?
          </AlertDialogTitle>
          {meta.code ? (
            <AlertDialogDescription>
              Your promo code {meta.code} will be removed too.
            </AlertDialogDescription>
          ) : (
            <AlertDialogDescription className="sr-only">
              Nothing can be brought back afterwards.
            </AlertDialogDescription>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Keep them</AlertDialogCancel>
            <Button type="button" variant="danger" size="touch" onClick={emptyAll}>
              Remove all
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
