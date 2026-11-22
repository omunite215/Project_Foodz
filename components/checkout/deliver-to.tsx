'use client';

import {
  BriefcaseBusiness,
  ChevronDown,
  House,
  MapPin,
  MapPinOff,
  MessageSquareText,
  Plus,
} from 'lucide-react';
import Link from 'next/link';
import { type Ref, useId, useState } from 'react';
import type { CheckoutAddress } from '@/server/modules/orders/schema';
import { FieldError } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { formatPrice } from '@/lib/format';
import { cn } from '@/lib/utils';
import { RadioCard } from './radio-card';

/*
 * "Deliver to" (F4 design 2.7, D9): saved addresses as radio cards with fee and distance; three
 * show (the chosen one first), "Show all" for the rest. The chosen card carries the courier
 * instructions and Edit. An address outside the area now is listed but can't be chosen.
 */

export const DELIVER_TO_ERROR_ID = 'deliver-to-error';

const ICONS = { HOME: House, WORK: BriefcaseBusiness, OTHER: MapPin } as const;
const SHOWN = 3;

/** The S13.3 reading: "Work, default, 1 Faneuil Hall Square, 1.3 km, delivery $2.64". */
export function addressReading(address: CheckoutAddress): string {
  const parts = [address.label, address.isDefault ? 'default' : null, address.line1];
  if (address.outsideNow) parts.push('outside our delivery area now');
  else {
    parts.push(`${address.distanceKm.toFixed(1)} km`);
    if (address.feeCents !== null) parts.push(`delivery ${formatPrice(address.feeCents)}`);
  }
  return parts.filter(Boolean).join(', ');
}

/** The three shown: the chosen one first, then the default, then the newest (server order). */
export function shownAddresses(addresses: readonly CheckoutAddress[], chosenId: string | null) {
  const chosen = addresses.find((address) => address.id === chosenId);
  const fallback = addresses.find((address) => address.isDefault && address.id !== chosenId);
  const first = [chosen, fallback].filter((address): address is CheckoutAddress =>
    Boolean(address),
  );
  const rest = addresses.filter((address) => !first.includes(address));
  return [...first, ...rest];
}

export interface DeliverToProps {
  addresses: readonly CheckoutAddress[];
  addressLimit: number;
  chosenId: string | null;
  onChoose: (id: string) => void;
  onAdd: (button: HTMLButtonElement) => void;
  onEdit: (address: CheckoutAddress, button: HTMLButtonElement) => void;
  error: string | null;
  demo: boolean;
  groupRef?: Ref<HTMLDivElement>;
}

export function DeliverTo({
  addresses,
  addressLimit,
  chosenId,
  onChoose,
  onAdd,
  onEdit,
  error,
  demo,
  groupRef,
}: DeliverToProps) {
  const id = useId();
  const [showAll, setShowAll] = useState(false);
  const ordered = shownAddresses(addresses, chosenId);
  const visible = showAll ? ordered : ordered.slice(0, SHOWN);
  const atLimit = addresses.length >= addressLimit;
  const limitId = `${id}-limit`;
  const listId = `${id}-list`;

  return (
    <fieldset aria-describedby={error ? DELIVER_TO_ERROR_ID : undefined} className="min-w-0">
      <legend className="mb-4 w-full p-0">
        <h2 className="text-body-2 font-semibold text-neutral-1">Deliver to</h2>
      </legend>
      {addresses.length === 0 ? (
        <>
          <p className="text-body-5 text-neutral-3">
            Add the address you&apos;d like your order delivered to.
          </p>
          {demo ? null : (
            <Button
              type="button"
              size="touch"
              onClick={(event) => onAdd(event.currentTarget)}
              className="mt-3 w-full"
            >
              <Plus className="size-4" aria-hidden />
              Add a new address
            </Button>
          )}
        </>
      ) : (
        <>
          <div ref={groupRef} id={listId} className="space-y-3">
            {visible.map((address) => {
              const checked = address.id === chosenId;
              return (
                <RadioCard
                  key={address.id}
                  name="address"
                  value={address.id}
                  checked={checked}
                  disabled={address.outsideNow}
                  onChange={onChoose}
                  label={addressReading(address)}
                  icon={ICONS[address.kind]}
                  aside={
                    address.outsideNow || address.feeCents === null ? null : (
                      <span aria-hidden>
                        <span className="block text-body-4 font-medium text-neutral-1 tabular-nums">
                          {formatPrice(address.feeCents)}
                        </span>
                        <span className="block text-body-5 text-neutral-3 tabular-nums">
                          {address.distanceKm.toFixed(1)} km
                        </span>
                      </span>
                    )
                  }
                  extra={
                    checked ? (
                      <div className="flex items-start gap-3 border-t border-neutral-6 px-4 py-3">
                        <MessageSquareText
                          className="mt-1 size-4 shrink-0 text-neutral-3"
                          aria-hidden
                        />
                        <p className="min-w-0 flex-1 text-body-5 text-neutral-1 [overflow-wrap:anywhere]">
                          {address.notes
                            ? `Courier instructions: ${address.notes}`
                            : 'No instructions for the courier.'}
                        </p>
                        {demo ? null : (
                          <Button
                            type="button"
                            variant="ghost"
                            size="touch"
                            onClick={(event) => onEdit(address, event.currentTarget)}
                            // brand-strong on the chosen card's tint is 4.19:1; neutral-1 keeps AA.
                            className="-my-2 px-3 text-button-2 font-medium text-neutral-1 underline underline-offset-4 hover:bg-white/60 hover:text-neutral-1"
                          >
                            Edit<span className="sr-only"> {address.label} address</span>
                          </Button>
                        )}
                      </div>
                    ) : null
                  }
                >
                  <span aria-hidden>
                    <span className="block text-body-4 font-medium text-neutral-1 [overflow-wrap:anywhere]">
                      {address.label}
                      {address.isDefault ? (
                        <span className="ml-2 inline-flex h-6 items-center rounded-md bg-neutral-7 px-2 align-middle text-caption font-medium text-neutral-1 group-has-[input:checked]/card:bg-white">
                          Default
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 line-clamp-2 block text-body-5 text-neutral-3 [overflow-wrap:anywhere]">
                      {[address.line1, address.line2].filter(Boolean).join(', ')}
                    </span>
                    {address.outsideNow ? (
                      <span className="mt-1 flex items-center gap-1.5 text-body-5 text-neutral-1">
                        <MapPinOff className="size-3.5 text-destructive" />
                        Outside our delivery area now
                      </span>
                    ) : null}
                  </span>
                </RadioCard>
              );
            })}
          </div>
          {addresses.length > SHOWN ? (
            <Button
              type="button"
              variant="ghost"
              aria-expanded={showAll}
              aria-controls={listId}
              onClick={() => setShowAll((current) => !current)}
              className="mt-2 h-11 px-2 text-button-2 font-medium text-brand-strong hover:bg-neutral-7 hover:text-brand-strong"
            >
              {showAll ? 'Show fewer addresses' : `Show all ${addresses.length} addresses`}
              <ChevronDown
                className={cn('size-4 transition-transform duration-150', showAll && 'rotate-180')}
                aria-hidden
              />
            </Button>
          ) : null}
          {demo ? null : (
            <>
              <Button
                type="button"
                variant="outline"
                size="touch"
                aria-disabled={atLimit || undefined}
                aria-describedby={atLimit ? limitId : undefined}
                onClick={(event) => {
                  if (!atLimit) onAdd(event.currentTarget);
                }}
                className="mt-3 w-full border-dashed border-neutral-5 bg-white text-neutral-2 hover:bg-neutral-7"
              >
                <Plus className="size-4" aria-hidden />
                Add a new address
              </Button>
              {atLimit ? (
                <p id={limitId} className="mt-2 text-body-5 text-neutral-3">
                  You have {addressLimit} saved addresses. Delete one in{' '}
                  <Link href="/account/addresses" className="font-medium text-neutral-1 underline">
                    Addresses
                  </Link>{' '}
                  to add another.
                </p>
              ) : null}
            </>
          )}
        </>
      )}
      <FieldError id={DELIVER_TO_ERROR_ID}>{error}</FieldError>
    </fieldset>
  );
}
