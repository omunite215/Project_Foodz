'use client';

import { useSelector } from '@tanstack/react-store';
import { type ReactNode, useRef } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { dispatchStore } from '@/lib/partner/dispatch';

/*
 * F6's bottom sheet for the Earnings tab (design 1.5, 1.8, 1.9): the 448 column, its title
 * focused on open, focus back to the opener on close. An offer closes it (F7 1.1: sheets close
 * under the offer layer), and focus then follows the offer, not the sheet.
 */

const SHEET =
  'inset-x-0 bottom-0 mx-auto max-h-[90dvh] max-w-md overflow-y-auto rounded-t-2xl bg-card px-4 pt-6 pb-[max(1rem,env(safe-area-inset-bottom))] text-foreground data-[state=open]:slide-in-from-bottom-6 motion-reduce:data-[state=open]:slide-in-from-bottom-0';

export function PartnerSheet({
  open,
  onOpenChange,
  title,
  description,
  returnFocus,
  canClose = true,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Read after the title; hidden from sight. */
  description?: string;
  returnFocus: () => void;
  /** False while a save is pending: Escape and the scrim do nothing. */
  canClose?: boolean;
  children: ReactNode;
}) {
  const offerOpen = useSelector(dispatchStore, (state) => state.card !== null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  return (
    <Sheet
      open={open && !offerOpen}
      onOpenChange={(next) => {
        if (!next && !canClose) return;
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
          if (!dispatchStore.state.card) returnFocus();
        }}
      >
        <SheetTitle
          ref={titleRef}
          tabIndex={-1}
          className="font-heading text-title-1 text-strong outline-none"
        >
          {title}
        </SheetTitle>
        {description ? (
          <SheetDescription className="sr-only">{description}</SheetDescription>
        ) : (
          <SheetDescription className="sr-only">{title}</SheetDescription>
        )}
        {children}
      </SheetContent>
    </Sheet>
  );
}
