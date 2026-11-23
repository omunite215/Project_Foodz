'use client';

import * as React from 'react';
import { Dialog as SheetPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';
import { usePortalContainer } from '@/components/ui/portal-container';

/*
 * A dialog that slides in from an edge: the cart and the menu filters (F3 design 2.1, 5.6).
 * Radix Dialog underneath: focus is trapped inside, the page behind is hidden from screen
 * readers and does not scroll, and Escape closes it. Each caller places it per breakpoint with
 * its own classes, and its motion fades only under reduced motion.
 */

function Sheet(props: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetTrigger(props: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose(props: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

function SheetContent({
  className,
  overlayClassName,
  children,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & { overlayClassName?: string }) {
  const container = usePortalContainer();
  return (
    <SheetPrimitive.Portal container={container}>
      <SheetPrimitive.Overlay
        data-slot="sheet-overlay"
        className={cn(
          'fixed inset-0 z-50 bg-neutral-1/40 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-150 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-200 motion-reduce:data-[state=closed]:duration-120 motion-reduce:data-[state=open]:duration-120',
          overlayClassName,
        )}
      />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          'fixed z-50 flex flex-col text-neutral-2 outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0',
          className,
        )}
        {...props}
      >
        {children}
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  );
}

function SheetTitle(props: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return <SheetPrimitive.Title data-slot="sheet-title" {...props} />;
}

function SheetDescription(props: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return <SheetPrimitive.Description data-slot="sheet-description" {...props} />;
}

export { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle, SheetTrigger };
