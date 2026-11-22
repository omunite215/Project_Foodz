'use client';

import { X } from 'lucide-react';
import { useRef } from 'react';
import type { AddressDto, StoreArea } from '@/server/modules/addresses/schema';
import { AddressForm } from '@/components/addresses/address-form';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { useDialogHistory } from '@/lib/dialog-history';

/*
 * Add or edit an address without leaving checkout (F4 design 2.8): the F2 form in the F3 sheet,
 * full screen on phones and a centred 560 px dialog from 768 px. Back closes it. Rendered outside
 * the checkout form, so its own form never sends checkout's.
 */

export interface AddressDialogProps {
  open: boolean;
  /** The address being edited, or null for a new one. */
  address: AddressDto | null;
  store: StoreArea;
  firstAddress: boolean;
  draftOwner: string;
  onClose: () => void;
  onSaved: (address: AddressDto, edited: boolean) => void;
  /** Where focus goes when it closes (the opener). */
  returnFocus: () => void;
}

export function AddressDialog({
  open,
  address,
  store,
  firstAddress,
  draftOwner,
  onClose,
  onSaved,
  returnFocus,
}: AddressDialogProps) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const history = useDialogHistory('foodzAddress', open, onClose);
  const title = address ? `Edit ${address.label} address` : 'Add an address';

  return (
    <Sheet open={open} onOpenChange={(next) => (next ? undefined : history.close())}>
      <SheetContent
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          titleRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocus();
        }}
        className="inset-0 h-dvh w-full bg-white data-[state=closed]:duration-160 data-[state=closed]:slide-out-to-bottom-6 data-[state=open]:duration-240 data-[state=open]:slide-in-from-bottom-6 md:inset-auto md:top-1/2 md:left-1/2 md:h-auto md:max-h-[calc(100dvh-3rem)] md:w-[calc(100%-3rem)] md:max-w-[560px] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl md:shadow-raised md:data-[state=closed]:slide-out-to-bottom-0 md:data-[state=closed]:zoom-out-95 md:data-[state=closed]:duration-150 md:data-[state=open]:slide-in-from-bottom-0 md:data-[state=open]:zoom-in-95 md:data-[state=open]:duration-200 motion-reduce:data-[state=closed]:duration-120 motion-reduce:data-[state=closed]:slide-out-to-bottom-0 motion-reduce:data-[state=open]:duration-120 motion-reduce:data-[state=open]:slide-in-from-bottom-0 motion-reduce:md:data-[state=closed]:zoom-out-100 motion-reduce:md:data-[state=open]:zoom-in-100"
      >
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-neutral-6 px-4 md:px-6">
          <SheetTitle
            ref={titleRef}
            tabIndex={-1}
            className="font-heading text-title-2 text-neutral-2 focus:outline-none"
          >
            {title}
          </SheetTitle>
          <Button
            type="button"
            variant="ghost"
            size="icon-touch"
            aria-label="Close"
            onClick={history.close}
            className="-mr-2 rounded-full hover:bg-neutral-7"
          >
            <X className="size-6" aria-hidden />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-5 pb-6 md:px-6">
          {open ? (
            <AddressForm
              address={address}
              store={store}
              defaultKind={address?.kind ?? (firstAddress ? 'HOME' : 'OTHER')}
              firstAddress={firstAddress}
              canSave
              draftOwner={draftOwner}
              onSaved={(saved) => {
                history.close();
                onSaved(saved, address !== null);
              }}
              onCancel={history.close}
            />
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
