'use client';

import { Plus, Trash2 } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { deleteAddressAction, setDefaultAddressAction } from '@/server/modules/addresses/actions';
import type { AddressBook as AddressBookData, AddressDto } from '@/server/modules/addresses/schema';
import { LockedLine } from '@/components/account/settings-card';
import { FormAlert } from '@/components/forms/form-alert';
import { BLOCKED_BUTTON_CLASS, SubmitButton } from '@/components/forms/submit-button';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { radiusText } from '@/lib/account-text';
import { callAction } from '@/lib/action-result';
import { announce } from '@/lib/announce';
import { prefersReducedMotion } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { gsap } from 'gsap';
import { AddressCard, addressName } from './address-card';
import { peekAddressStatus, takeAddressStatus } from './address-status';

/** "We deliver within 8 km of 88 Harbor Street, Boston." from the store settings. */
export function deliveryAreaText(store: AddressBookData['store']) {
  const place = store.addressText.split(',').slice(0, 2).join(',').trim();
  return `We deliver within ${radiusText(store.radiusKm)} of ${place}.`;
}

type Status = { tone: 'success' | 'error'; text: string } | null;

/** Brings a card into view with its outline, and a short tint for a new or edited one. */
function focusCard(id: string, highlight: boolean) {
  requestAnimationFrame(() => {
    const card = document.getElementById(`addr-${id}`);
    if (!card) return;
    card.focus();
    if (highlight && !prefersReducedMotion()) {
      const tint = getComputedStyle(document.documentElement).getPropertyValue(
        '--color-brand-soft',
      );
      gsap.from(card, {
        backgroundColor: tint.trim(),
        duration: 0.6,
        ease: 'power2.out',
        clearProps: 'backgroundColor',
      });
    }
  });
}

/** After "Set as default" the card's own button is gone, so focus goes to its "Edit". */
function focusEditOf(id: string) {
  requestAnimationFrame(() => {
    document.getElementById(`addr-${id}`)?.querySelector<HTMLElement>('a[href]')?.focus();
  });
}

/**
 * The address book (S4.1, S4.8, S4.9, S4.11 to S4.13): default first, then newest. Setting a
 * default is optimistic; deleting asks first and names the address. Results show in one status
 * slot, are announced once, and focus moves somewhere sensible.
 */
export function AddressBook({ book }: { book: AddressBookData }) {
  const router = useRouter();
  const limitId = useId();
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());
  const [defaultId, setDefaultId] = useState<string | null>(
    book.addresses.find((address) => address.isDefault)?.id ?? null,
  );
  // Arriving from the form after a save: "Address saved".
  const [status, setStatus] = useState<Status>(() => {
    const saved = peekAddressStatus();
    return saved ? { tone: 'success', text: saved.text } : null;
  });
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<AddressDto | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const addButtonRef = useRef<HTMLAnchorElement>(null);
  // Where focus goes once the delete dialog has closed (its focus trap holds it until then):
  // the next card after a delete, otherwise back to the Delete button that opened it.
  const focusAfterDialog = useRef<string | null>(null);
  const dialogOpener = useRef<HTMLElement | null>(null);

  // The server's order and default win after every refresh.
  const [shownBook, setShownBook] = useState(book);
  if (shownBook !== book) {
    setShownBook(book);
    setDefaultId(book.addresses.find((address) => address.isDefault)?.id ?? null);
    setRemoved(new Set());
  }

  useEffect(() => {
    const saved = takeAddressStatus();
    if (!saved) return;
    announce(saved.text);
    if (saved.focusId) focusCard(saved.focusId, true);
  }, []);

  const addresses = book.addresses
    .filter((address) => !removed.has(address.id))
    .toSorted((a, b) => Number(b.id === defaultId) - Number(a.id === defaultId));
  const atLimit = book.canEdit && addresses.length >= book.limit;

  async function setDefault(address: AddressDto) {
    if (busy) return;
    const previous = defaultId;
    setBusy(true);
    setDefaultId(address.id);
    setStatus(null);
    focusEditOf(address.id);
    const outcome = await callAction(() => setDefaultAddressAction({ id: address.id }));
    setBusy(false);
    if (!outcome.ok) {
      setDefaultId(previous);
      setStatus({ tone: 'error', text: outcome.error.message });
      announce(outcome.error.message);
      return;
    }
    const text = `${address.label} is now your default address`;
    setStatus({ tone: 'success', text });
    announce(text);
    router.refresh();
  }

  async function confirmDelete(address: AddressDto) {
    if (deletePending) return;
    setDeletePending(true);
    const order = addresses.map((item) => item.id);
    const index = order.indexOf(address.id);
    const outcome = await callAction(() => deleteAddressAction({ id: address.id }));
    setDeletePending(false);
    setDeleting(null);
    if (!outcome.ok && outcome.error.code !== 'NOT_FOUND') {
      setStatus({ tone: 'error', text: outcome.error.message });
      announce(outcome.error.message);
      return;
    }
    const newDefault = outcome.ok ? outcome.data.newDefault : null;
    if (newDefault) setDefaultId(newDefault.id);
    setRemoved((current) => new Set([...current, address.id]));
    const text = newDefault ? `${newDefault.label} is now your default address` : 'Address deleted';
    setStatus({ tone: 'success', text: newDefault ? `Address deleted. ${text}` : text });
    announce(newDefault ? `Address deleted. ${text}` : text);

    const rest = order.filter((itemId) => itemId !== address.id);
    const next = rest[Math.min(index, rest.length - 1)];
    focusAfterDialog.current = next ? `addr-${next}` : 'add-address';
    router.refresh();
  }

  const statusSlot = status ? (
    <FormAlert variant={status.tone} className="mt-6">
      {status.text}
    </FormAlert>
  ) : null;

  const subtitle = deliveryAreaText(book.store);

  return (
    <div>
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1
            tabIndex={-1}
            className="font-heading text-h4 leading-tight text-neutral-2 focus:outline-none md:text-h3"
          >
            Addresses
          </h1>
          {/* The empty state says it under its picture instead, so it reads once (S4.1). */}
          {addresses.length > 0 ? (
            <p className="mt-2 text-body-4 text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
        {book.canEdit && addresses.length > 0 ? (
          <div className="md:text-right">
            <Button
              asChild
              size="touch"
              className={cn('w-full uppercase md:w-auto', atLimit && BLOCKED_BUTTON_CLASS)}
              aria-disabled={atLimit || undefined}
              aria-describedby={atLimit ? limitId : undefined}
            >
              <Link
                ref={addButtonRef}
                id="add-address"
                href="/account/addresses/new"
                onClick={(event) => {
                  if (atLimit) {
                    event.preventDefault();
                    announce('You can save up to 10 addresses. Delete one to add another.');
                  }
                }}
              >
                <Plus className="size-4" aria-hidden />
                Add an address
              </Link>
            </Button>
            {atLimit ? (
              <p id={limitId} className="mt-2 text-body-5 text-neutral-3">
                You can save up to 10 addresses. Delete one to add another.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      {book.canEdit ? null : (
        <div className="mt-6 flex flex-col items-start gap-3">
          <LockedLine>
            The demo account&apos;s addresses can&apos;t be changed. You can still try the delivery
            check.
          </LockedLine>
          <Button
            asChild
            variant="outline"
            size="touch"
            className="border-brand-strong bg-white text-brand-strong hover:bg-brand-soft hover:text-brand-strong"
          >
            <Link href="/account/addresses/new">Try the delivery check</Link>
          </Button>
        </div>
      )}

      {statusSlot}

      {addresses.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-neutral-6 bg-white px-5 py-12 text-center md:px-6">
          <Image
            src="/illustrations/delivery-address.svg"
            alt=""
            width={200}
            height={176}
            unoptimized
            className="mx-auto h-auto w-40 md:w-50"
          />
          <h2 className="mt-6 font-heading text-title-1 text-neutral-2">No saved addresses yet</h2>
          <p className="mt-3 text-body-4 text-neutral-3">{subtitle}</p>
          {book.canEdit ? (
            <Button asChild size="touch" className="mt-8 uppercase">
              <Link id="add-address" href="/account/addresses/new">
                <Plus className="size-4" aria-hidden />
                Add an address
              </Link>
            </Button>
          ) : null}
        </div>
      ) : (
        <ul className="mt-6 grid gap-4 md:grid-cols-2 md:gap-6">
          {addresses.map((address) => (
            <li key={address.id}>
              <AddressCard
                address={address}
                isDefault={address.id === defaultId}
                canEdit={book.canEdit}
                busy={busy}
                onSetDefault={() => void setDefault(address)}
                onDelete={(opener) => {
                  dialogOpener.current = opener;
                  focusAfterDialog.current = null;
                  setDeleting(address);
                }}
              />
            </li>
          ))}
        </ul>
      )}

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open && !deletePending) setDeleting(null);
        }}
      >
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            // The dialog has no trigger of its own, so focus is placed here every time.
            // Deleted: the next card, or "Add an address" when none is left. Cancelled: back to
            // the Delete button that opened it.
            event.preventDefault();
            const target = focusAfterDialog.current;
            const opener = dialogOpener.current;
            focusAfterDialog.current = null;
            dialogOpener.current = null;
            (target ? document.getElementById(target) : opener)?.focus();
          }}
        >
          <AlertDialogTitle>Delete {deleting ? addressName(deleting) : ''}?</AlertDialogTitle>
          <AlertDialogDescription>
            Orders you&apos;ve already placed keep their address.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <SubmitButton
              type="button"
              variant="danger"
              pending={deletePending}
              pendingLabel="Deleting…"
              onClick={() => {
                if (deleting) void confirmDelete(deleting);
              }}
            >
              <Trash2 className="size-4" aria-hidden />
              Delete address
            </SubmitButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
