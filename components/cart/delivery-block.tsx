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
import { useId, useRef, useState, useSyncExternalStore } from 'react';
import { z } from 'zod';
import {
  guestAddressSearchAction,
  guestDeliveryCheckAction,
  listAddressesAction,
} from '@/server/modules/addresses/actions';
import {
  type AddressDto,
  type AddressSuggestion,
  latitudeSchema,
  longitudeSchema,
} from '@/server/modules/addresses/schema';
import type { Quote } from '@/server/modules/cart/schema';
import { AddressCombobox, GUEST_LIMIT_TEXT } from '@/components/addresses/address-combobox';
import { useSlowPending } from '@/components/forms/submit-button';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { callAction } from '@/lib/action-result';
import { announce } from '@/lib/announce';
import { distanceText } from '@/lib/cart-text';
import { cn } from '@/lib/utils';

/*
 * Where the order would go (F3 design 2.15, S2.6 to S2.8, U2). Signed in: the default saved
 * address, which "Change" swaps for another (the choice is kept with the cart, D18). A guest, or
 * someone with no saved address, can check an address without saving it: the point is kept in
 * this tab only and sent inside quotes.
 */

// ------------------------------------------------------------------ the checked address (this tab only)

export interface CheckedAddress {
  line1: string;
  lat: number;
  lng: number;
}

const CHECKED_KEY = 'foodz.cart.point';
const checkedSchema = z.object({
  line1: z.string().min(1).max(200),
  lat: latitudeSchema,
  lng: longitudeSchema,
});
const checkedListeners = new Set<() => void>();
let checkedCache: { raw: string | null; value: CheckedAddress | null } = { raw: null, value: null };

function readChecked(): CheckedAddress | null {
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(CHECKED_KEY);
  } catch {
    return null;
  }
  if (raw === checkedCache.raw) return checkedCache.value;
  let value: CheckedAddress | null = null;
  try {
    const parsed = checkedSchema.safeParse(raw ? JSON.parse(raw) : null);
    value = parsed.success ? parsed.data : null;
  } catch {
    value = null;
  }
  checkedCache = { raw, value };
  return value;
}

export function setCheckedAddress(value: CheckedAddress | null) {
  try {
    if (value) window.sessionStorage.setItem(CHECKED_KEY, JSON.stringify(value));
    else window.sessionStorage.removeItem(CHECKED_KEY);
  } catch {
    // Storage blocked: the check holds until the page is left.
  }
  for (const listener of checkedListeners) listener();
}

export function useCheckedAddress(): CheckedAddress | null {
  return useSyncExternalStore(
    (listener) => {
      checkedListeners.add(listener);
      return () => {
        checkedListeners.delete(listener);
      };
    },
    readChecked,
    () => null,
  );
}

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
  action,
}: {
  icon: LucideIcon;
  label: string;
  line1: string;
  distance: string | null;
  outside: boolean;
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
            Outside our delivery area now
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
  const book = useQuery({
    queryKey: ['account', 'addresses'],
    queryFn: async () => {
      const outcome = await callAction(() => listAddressesAction());
      if (!outcome.ok) throw new Error(outcome.error.message);
      return outcome.data;
    },
    staleTime: 30_000,
  });
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
  onInside,
  onAction,
}: {
  onInside: (address: CheckedAddress, message: string) => void;
  onAction: () => void;
}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<AddressSuggestion | null>(null);
  const [state, setState] = useState<CheckState>({ kind: 'idle' });
  const slow = useSlowPending(state.kind === 'checking', 150);
  const hintId = `${id}-hint`;

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
    announce(outcome.data.message);
    if (outcome.data.deliverable) {
      setState({ kind: 'idle' });
      onInside({ line1: item.line1, lat: item.lat, lng: item.lng }, outcome.data.message);
    } else {
      setState({ kind: 'outside', text: outcome.data.message });
    }
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
  const [changing, setChanging] = useState(false);
  const [checking, setChecking] = useState(false);
  const delivery = quote?.delivery ?? null;

  const done = () => {
    setChanging(false);
    requestAnimationFrame(() => changeRef.current?.focus());
  };

  let body: React.ReactNode;
  if (!delivery) {
    body = checked ? (
      <AddressRow
        icon={MapPin}
        label="Your address"
        line1={checked.line1}
        distance={null}
        outside={false}
        action={null}
      />
    ) : (
      <span aria-hidden className="mt-3 block h-16 rounded-lg bg-neutral-7" />
    );
  } else if (delivery.kind === 'saved' && delivery.address) {
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
              className="px-3 text-button-2 font-medium text-brand-strong hover:bg-brand-soft hover:text-brand-strong"
            >
              Change<span className="sr-only"> delivery address</span>
            </Button>
          }
        />
        {outside && !changing ? (
          <OutsideBox
            text={`We don't deliver to ${address.line1} yet. It's about ${delivery.distanceKm?.toFixed(1) ?? '?'} km away, and we deliver within ${delivery.radiusKm} km.`}
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
  } else if (delivery.kind === 'point' && checked && !checking) {
    body = (
      <AddressRow
        icon={MapPin}
        label="Your address"
        line1={checked.line1}
        distance={delivery.status === 'inside' ? distanceText(delivery) : null}
        outside={delivery.status === 'outside'}
        action={
          <Button
            type="button"
            variant="ghost"
            size="touch"
            aria-expanded={false}
            onClick={() => {
              onAction();
              setChecking(true);
            }}
            className="px-3 text-button-2 font-medium text-brand-strong hover:bg-brand-soft hover:text-brand-strong"
          >
            Change<span className="sr-only"> delivery address</span>
          </Button>
        }
      />
    );
  } else {
    body = (
      <>
        {checking ? null : (
          <>
            <p className="mt-3 text-body-5 text-neutral-3">
              We&apos;ll show the exact fee for your address.
            </p>
            <Button
              type="button"
              variant="outline"
              size="touch"
              aria-expanded={false}
              aria-controls={`${id}-check`}
              onClick={() => {
                onAction();
                setChecking(true);
              }}
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
              onAction={onAction}
              onInside={(address) => {
                onCheck(address);
                setChecking(false);
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
