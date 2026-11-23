'use client';

import { useQuery } from '@tanstack/react-query';
import {
  BriefcaseBusiness,
  CircleExclamationPoint,
  House,
  type LucideIcon,
  MapPin,
  MapPinOff,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import {
  guestAddressSearchAction,
  guestDeliveryCheckAction,
  listAddressesAction,
} from '@/server/modules/addresses/actions';
import type { AddressDto, AddressSuggestion } from '@/server/modules/addresses/schema';
import type { Quote } from '@/server/modules/cart/schema';
import { AddressCombobox, GUEST_LIMIT_TEXT } from '@/components/addresses/address-combobox';
import { useSlowPending } from '@/components/forms/submit-button';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { callAction } from '@/lib/action-result';
import { announce } from '@/lib/announce';
import { distanceText, freeDeliveryWithoutAddress, outsideText } from '@/lib/cart-text';
import { afterAddressCheck, type CheckedAddress } from '@/lib/data/checked-address';
import { cn } from '@/lib/utils';

/*
 * Where the order would go (F3 design 2.15, S2.6 to S2.8, U2). Signed in: the default saved
 * address, which "Change" swaps for another (the choice is kept with the cart, D18). A guest, or
 * someone with no saved address, can check an address without saving it: the point is kept in
 * this tab only and sent inside quotes.
 */

// ------------------------------------------------------------------ pieces

const KIND_ICONS: Record<AddressDto['kind'], LucideIcon> = {
  HOME: House,
  WORK: BriefcaseBusiness,
  OTHER: MapPin,
};

function iconFor(label: string, kind?: AddressDto['kind']): LucideIcon {
  if (kind) return KIND_ICONS[kind];
  if (label === 'Home') return House;
  if (label === 'Work') return BriefcaseBusiness;
  return MapPin;
}

function AddressRow({
  icon: Icon,
  label,
  line1,
  distance,
  outside,
  outsideSince = false,
  action,
}: {
  icon: LucideIcon;
  label: string;
  line1: string;
  distance: string | null;
  outside: boolean;
  /** A saved address that has fallen outside the area since it was saved reads "…area now". */
  outsideSince?: boolean;
  action: React.ReactNode;
}) {
  return (
    <div className="mt-3 flex items-start gap-3 rounded-lg border border-neutral-6 bg-white p-3">
      <span
        aria-hidden
        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-neutral-7"
      >
        <Icon className="size-5 text-neutral-2" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-body-4 font-medium text-neutral-1">{label}</p>
        <p className="truncate text-body-5 text-neutral-3">{line1}</p>
        {distance ? (
          <p className="text-body-5 text-neutral-3 tabular-nums">{distance} from our kitchen</p>
        ) : null}
        {outside ? (
          <p className="mt-1 flex items-center gap-1.5 text-body-5 text-neutral-1">
            <MapPinOff className="size-3.5 text-destructive" aria-hidden />
            {outsideSince ? 'Outside our delivery area now' : 'Outside our delivery area'}
          </p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

function OutsideBox({ text, action }: { text: string; action: React.ReactNode }) {
  return (
    <div className="mt-3 flex items-start gap-3 rounded-xl bg-tag-6-bg p-3 text-body-5">
      <MapPinOff className="mt-0.5 size-5 shrink-0 text-tag-6" aria-hidden />
      <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
        <p className="text-neutral-1">{text}</p>
        {action}
      </div>
    </div>
  );
}

const linkButton =
  'inline-flex h-11 items-center text-button-2 font-medium text-brand-strong underline-offset-4 hover:underline';

// ------------------------------------------------------------------ saved addresses

/** The signed-in customer's address book (the cart's picker and its choice of address). */
export function useSavedAddresses(enabled = true) {
  return useQuery({
    queryKey: ['account', 'addresses'],
    queryFn: async () => {
      const outcome = await callAction(() => listAddressesAction());
      if (!outcome.ok) throw new Error(outcome.error.message);
      return outcome.data;
    },
    staleTime: 30_000,
    enabled,
  });
}

function SavedAddressPicker({
  chosenId,
  onPick,
  onDone,
  onNavigate,
  listId,
}: {
  chosenId: string | null;
  onPick: (id: string) => void;
  onDone: () => void;
  onNavigate: () => void;
  listId: string;
}) {
  const book = useSavedAddresses();
  const addresses = book.data?.addresses ?? [];

  return (
    <div id={listId} className="mt-3">
      <fieldset>
        <legend className="sr-only">Deliver to</legend>
        {book.isPending ? (
          <p className="flex items-center gap-2 text-body-5 text-neutral-3">
            <Spinner className="size-4 motion-reduce:animate-none" />
            Loading your addresses…
          </p>
        ) : book.isError ? (
          <p className="text-body-5 text-neutral-3">We couldn&apos;t load your addresses.</p>
        ) : (
          <div className="space-y-2">
            {addresses.map((address) => {
              const Icon = KIND_ICONS[address.kind];
              return (
                <label
                  key={address.id}
                  className={cn(
                    'flex min-h-14 cursor-pointer items-start gap-3 rounded-lg border border-neutral-6 bg-white p-3 has-[:checked]:border-2 has-[:checked]:border-brand-strong has-[:checked]:bg-brand-soft has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring has-[:focus-visible]:outline-solid',
                    !address.deliverable && 'cursor-not-allowed bg-neutral-7',
                  )}
                >
                  <input
                    type="radio"
                    name={`${listId}-address`}
                    value={address.id}
                    checked={address.id === chosenId}
                    disabled={!address.deliverable}
                    onChange={() => onPick(address.id)}
                    className="mt-1 size-4 accent-brand-strong outline-none"
                  />
                  <Icon className="mt-0.5 size-5 shrink-0 text-neutral-2" aria-hidden />
                  <span className="min-w-0">
                    <span className="block text-body-4 font-medium text-neutral-1">
                      {address.label}
                    </span>
                    <span className="block text-body-5 text-neutral-3 [overflow-wrap:anywhere]">
                      {address.line1}
                    </span>
                    {address.deliverable ? null : (
                      <span className="mt-1 flex items-center gap-1.5 text-body-5 text-neutral-1">
                        <MapPinOff className="size-3.5 text-destructive" aria-hidden />
                        Outside our delivery area now
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </fieldset>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="touch" className="bg-white" onClick={onDone}>
          Done
        </Button>
        <Link href="/account/addresses" replace onNavigate={onNavigate} className={linkButton}>
          Manage addresses
        </Link>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ checking an address

type CheckState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'outside'; text: string }
  | { kind: 'failed'; limited: boolean };

function GuestAddressCheck({
  initialText = '',
  onChecked,
  onAction,
}: {
  /** The address checked before, when "Change" opened this: shown selected, to type over. */
  initialText?: string;
  /** A check came back, inside the area or not: the cart quotes that point from now on. */
  onChecked: (address: CheckedAddress, deliverable: boolean) => void;
  onAction: () => void;
}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(initialText);
  const [picked, setPicked] = useState<AddressSuggestion | null>(null);
  const [state, setState] = useState<CheckState>({ kind: 'idle' });
  const slow = useSlowPending(state.kind === 'checking', 150);
  const hintId = `${id}-hint`;

  // Opened by "Check your address" or "Change", whose button is gone: focus moves into the field.
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  async function checkPoint(item: AddressSuggestion) {
    onAction();
    setState({ kind: 'checking' });
    const outcome = await callAction(() =>
      guestDeliveryCheckAction({ lat: item.lat, lng: item.lng, line1: item.line1 }),
    );
    if (!outcome.ok) {
      const limited = outcome.error.code === 'RATE_LIMITED';
      setState({ kind: 'failed', limited });
      announce(limited ? GUEST_LIMIT_TEXT : "We couldn't check delivery for this address.");
      return;
    }
    // Outside, the sentence is the one the cart shows once reopened (2.15), not the server's.
    const sentence = outcome.data.deliverable
      ? outcome.data.message
      : outsideText(item.line1, outcome.data);
    announce(sentence);
    setState(outcome.data.deliverable ? { kind: 'idle' } : { kind: 'outside', text: sentence });
    // City and house number let checkout fill in its address form from this check (F4 D10).
    onChecked(
      {
        line1: item.line1,
        lat: item.lat,
        lng: item.lng,
        city: item.city,
        hasHouseNumber: item.hasHouseNumber,
      },
      outcome.data.deliverable,
    );
  }

  const tryAnother = () => {
    setPicked(null);
    setText('');
    setState({ kind: 'idle' });
    inputRef.current?.focus();
  };

  return (
    <div className="mt-3">
      <label htmlFor={`${id}-input`} className="text-body-4 text-neutral-3">
        Your address
      </label>
      <div className="mt-2">
        <AddressCombobox
          control={{ id: `${id}-input`, 'aria-describedby': hintId }}
          value={text}
          onType={(next) => {
            setText(next);
            setPicked(null);
            if (state.kind !== 'idle') setState({ kind: 'idle' });
          }}
          onPick={(item) => {
            setText(`${item.line1}, ${item.city}`);
            setPicked(item);
            void checkPoint(item);
          }}
          search={guestAddressSearchAction}
          listboxId={`${id}-options`}
          inputRef={inputRef}
        />
      </div>
      <p id={hintId} className="mt-1.5 text-body-5 text-muted-foreground">
        We use it only to work out the fee. It isn&apos;t saved.
      </p>
      {state.kind === 'checking' && slow ? (
        <p className="mt-3 flex items-center gap-2 text-body-5 text-neutral-3">
          <Spinner className="size-4 motion-reduce:animate-none" />
          Checking delivery…
        </p>
      ) : null}
      {state.kind === 'outside' ? (
        <OutsideBox
          text={state.text}
          action={
            <Button
              type="button"
              variant="outline"
              size="touch"
              className="mt-3 bg-white"
              onClick={tryAnother}
            >
              Choose another address
            </Button>
          }
        />
      ) : null}
      {state.kind === 'failed' ? (
        <div className="mt-3 flex items-start gap-3 rounded-xl bg-tag-4-bg p-3 text-body-5">
          <CircleExclamationPoint className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
          <div>
            <p className="text-neutral-1">
              {state.limited ? GUEST_LIMIT_TEXT : "We couldn't check delivery for this address."}
            </p>
            {picked && !state.limited ? (
              <Button
                type="button"
                variant="outline"
                size="touch"
                className="mt-3 bg-white"
                onClick={() => void checkPoint(picked)}
              >
                Try again
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ the block

export interface DeliveryBlockProps {
  quote: Quote | null;
  signedIn: boolean;
  checked: CheckedAddress | null;
  chosenId: string | null;
  onPickSaved: (id: string) => void;
  onCheck: (address: CheckedAddress | null) => void;
  onAction: () => void;
  onNavigate: () => void;
}

export function DeliveryBlock({
  quote,
  signedIn,
  checked,
  chosenId,
  onPickSaved,
  onCheck,
  onAction,
  onNavigate,
}: DeliveryBlockProps) {
  const id = useId();
  const listId = `${id}-list`;
  const changeRef = useRef<HTMLButtonElement>(null);
  const pointChangeRef = useRef<HTMLButtonElement>(null);
  /** An address was just checked: its row's "Change" takes the focus once drawn. */
  const focusPointChange = useRef(false);
  const [changing, setChanging] = useState(false);
  const [checking, setChecking] = useState(false);
  /** What the address field opens with: the checked address for "Change", empty for another. */
  const [checkText, setCheckText] = useState('');
  const delivery = quote?.delivery ?? null;

  const openCheck = (text: string) => {
    onAction();
    setCheckText(text);
    setChecking(true);
  };

  useEffect(() => {
    if (!focusPointChange.current || !pointChangeRef.current) return;
    focusPointChange.current = false;
    pointChangeRef.current.focus();
  });

  const done = () => {
    setChanging(false);
    requestAnimationFrame(() => changeRef.current?.focus());
  };

  let body: React.ReactNode;
  if (delivery?.kind === 'saved' && delivery.address) {
    const outside = delivery.status === 'outside';
    const address = delivery.address;
    body = (
      <>
        <AddressRow
          icon={iconFor(address.label)}
          label={address.label}
          line1={address.line1}
          distance={outside ? null : distanceText(delivery)}
          outside={outside}
          outsideSince
          action={
            <Button
              ref={changeRef}
              type="button"
              variant="ghost"
              size="touch"
              aria-expanded={changing}
              aria-controls={listId}
              onClick={() => {
                onAction();
                setChanging((open) => !open);
              }}
              className="px-3 text-button-2 font-medium text-brand-strong hover:bg-brand-soft hover:text-brand-strong aria-expanded:bg-brand-soft aria-expanded:text-brand-strong"
            >
              Change<span className="sr-only"> delivery address</span>
            </Button>
          }
        />
        {outside && !changing ? (
          <OutsideBox
            text={outsideText(address.line1, delivery)}
            action={
              <Button
                type="button"
                variant="outline"
                size="touch"
                className="mt-3 bg-white"
                onClick={() => setChanging(true)}
              >
                Choose another address
              </Button>
            }
          />
        ) : null}
        {changing ? (
          <SavedAddressPicker
            chosenId={chosenId ?? address.id}
            onPick={(next) => {
              onAction();
              onPickSaved(next);
            }}
            onDone={done}
            onNavigate={onNavigate}
            listId={listId}
          />
        ) : null}
      </>
    );
  } else if (checked && !checking) {
    // Drawn at once, before the quote for it is back (the distance follows with it).
    const quoted = delivery?.kind === 'point' ? delivery : null;
    const outside = quoted?.status === 'outside';
    body = (
      <>
        <AddressRow
          icon={MapPin}
          label="Your address"
          line1={checked.line1}
          distance={quoted?.status === 'inside' ? distanceText(quoted) : null}
          outside={outside}
          action={
            <Button
              ref={pointChangeRef}
              type="button"
              variant="ghost"
              size="touch"
              aria-expanded={false}
              onClick={() => openCheck(checked.line1)}
              className="px-3 text-button-2 font-medium text-brand-strong hover:bg-brand-soft hover:text-brand-strong"
            >
              Change<span className="sr-only"> delivery address</span>
            </Button>
          }
        />
        {outside && quoted ? (
          // The checked address is outside the area (S2.8): it stays the cart's address, so
          // checkout stays blocked until she picks one we deliver to.
          <OutsideBox
            text={outsideText(checked.line1, quoted)}
            action={
              <Button
                type="button"
                variant="outline"
                size="touch"
                className="mt-3 bg-white"
                onClick={() => openCheck('')}
              >
                Choose another address
              </Button>
            }
          />
        ) : null}
      </>
    );
  } else if (!delivery && !checking) {
    body = <span aria-hidden className="mt-3 block h-16 rounded-lg bg-neutral-7" />;
  } else {
    body = (
      <>
        {checking ? null : (
          <>
            <p className="mt-3 text-body-5 text-neutral-3">
              {quote && freeDeliveryWithoutAddress(quote) && quote.promo
                ? `Delivery is free with ${quote.promo.code}.`
                : 'We’ll show the exact fee for your address.'}
            </p>
            <Button
              type="button"
              variant="outline"
              size="touch"
              aria-expanded={false}
              aria-controls={`${id}-check`}
              onClick={() => openCheck('')}
              className="mt-3 bg-white"
            >
              <MapPin className="size-4" aria-hidden />
              Check your address
            </Button>
          </>
        )}
        <div id={`${id}-check`}>
          {checking ? (
            <GuestAddressCheck
              initialText={checkText}
              onAction={onAction}
              onChecked={(address, deliverable) => {
                // Inside or outside, the checked address replaces the earlier one everywhere:
                // the quote, the breakdown, checkout and this tab's storage (S2.8).
                const next = afterAddressCheck(address, deliverable);
                onCheck(next.keep);
                if (next.closeCheck) {
                  focusPointChange.current = true;
                  setChecking(false);
                }
              }}
            />
          ) : null}
        </div>
        {signedIn && !checking ? (
          <Link
            href="/account/addresses/new"
            replace
            onNavigate={onNavigate}
            className={cn(linkButton, 'mt-1')}
          >
            Save an address
          </Link>
        ) : null}
      </>
    );
  }

  return (
    <section aria-labelledby={`${id}-title`} className="mt-8">
      <h3 id={`${id}-title`} className="text-body-3 font-semibold text-neutral-1">
        Delivery
      </h3>
      {body}
    </section>
  );
}
