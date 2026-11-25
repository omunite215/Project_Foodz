'use client';

import { TriangleAlert, X } from 'lucide-react';
import { type FormEvent, type ReactNode, type RefObject, useId, useRef } from 'react';
import { SubmitButton } from '@/components/forms/submit-button';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

/*
 * The board's dialog frame (F5 design 3.1): full screen on phones, a centred 512 px card from
 * 768 px, a pinned header and footer with the body scrolling between. Focus goes to the title
 * on open and back to the opener on close; while pending it can't be closed and its fields are
 * inert, and a double press sends once.
 */

export function ActionDialog({
  open,
  title,
  description,
  pending,
  irreversible = false,
  safeLabel,
  actionLabel,
  pendingLabel,
  danger = false,
  blocked = false,
  blockedReason,
  onClose,
  onSubmit,
  onCloseFocus,
  formRef,
  closeOnly = false,
  footerNote,
  children,
}: {
  open: boolean;
  title: string;
  /** A short line for screen readers that names what the dialog decides. */
  description?: string;
  pending: boolean;
  /** "This can't be undone." above the buttons (refuse, cancel). */
  irreversible?: boolean;
  safeLabel: string;
  actionLabel: string;
  pendingLabel: string;
  danger?: boolean;
  /** The action can't be pressed: offline, or locked after wrong codes. */
  blocked?: boolean;
  blockedReason?: string | null;
  onClose: () => void;
  onSubmit: () => void;
  /** Where focus goes when the dialog closes; the opener by default. */
  onCloseFocus?: () => boolean;
  formRef?: RefObject<HTMLFormElement | null>;
  /** The order changed and the action no longer applies: one "Close" button (design 3.4). */
  closeOnly?: boolean;
  /** A line above the buttons in place of "This can't be undone." (F6: "This takes effect at once."). */
  footerNote?: ReactNode;
  children: ReactNode;
}) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const reasonId = useId();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !pending) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        {...(description ? {} : { 'aria-describedby': undefined })}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          titleRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          if (onCloseFocus?.()) event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          if (pending) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (pending) event.preventDefault();
        }}
        className={cn(
          'flex flex-col gap-0 overflow-hidden bg-white p-0 text-neutral-2 ring-0',
          'max-md:inset-0 max-md:top-0 max-md:left-0 max-md:h-dvh max-md:max-w-none max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-none max-md:motion-safe:data-open:slide-in-from-bottom-6',
          'md:max-h-[calc(100dvh-4rem)] md:w-[calc(100%-2rem)] md:max-w-lg md:rounded-2xl md:shadow-raised',
          'duration-200 motion-reduce:duration-120 motion-reduce:data-open:zoom-in-100 motion-reduce:data-closed:zoom-out-100',
        )}
      >
        <header className="flex items-start gap-3 border-b border-neutral-6 px-6 pt-6 pb-4">
          <DialogTitle
            ref={titleRef}
            tabIndex={-1}
            className="flex-1 font-heading text-title-1 leading-tight font-normal text-neutral-2 outline-none [overflow-wrap:anywhere]"
          >
            {title}
          </DialogTitle>
          <Button
            type="button"
            variant="ghost"
            size="icon-kitchen"
            aria-label="Close"
            aria-disabled={pending || undefined}
            onClick={() => {
              if (!pending) onClose();
            }}
            className="-mt-2 -mr-3 shrink-0"
          >
            <X className="size-5" aria-hidden />
          </Button>
        </header>
        {description ? (
          <DialogDescription className="sr-only">{description}</DialogDescription>
        ) : null}
        <form
          ref={formRef}
          noValidate
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            if (!pending && !blocked && !closeOnly) onSubmit();
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div
            className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5"
            inert={pending || undefined}
          >
            {children}
          </div>
          <footer className="border-t border-neutral-6 px-6 py-4">
            {irreversible && !closeOnly ? (
              <p className="flex items-center gap-2 text-body-5 font-medium text-neutral-1">
                <TriangleAlert className="size-4 text-destructive" aria-hidden />
                This can&apos;t be undone.
              </p>
            ) : null}
            {footerNote && !irreversible && !closeOnly ? footerNote : null}
            <div
              className={cn(
                'flex flex-col-reverse gap-3 md:flex-row md:justify-end',
                (irreversible || footerNote) && !closeOnly && 'mt-3',
              )}
            >
              {closeOnly ? (
                <Button type="button" size="kitchen" onClick={onClose}>
                  Close
                </Button>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="kitchen"
                    aria-disabled={pending || undefined}
                    onClick={() => {
                      if (!pending) onClose();
                    }}
                  >
                    {safeLabel}
                  </Button>
                  <SubmitButton
                    pending={pending}
                    pendingLabel={pendingLabel}
                    blocked={blocked}
                    size="kitchen"
                    variant={danger ? 'danger' : 'default'}
                    aria-describedby={blocked && blockedReason ? reasonId : undefined}
                  >
                    {actionLabel}
                  </SubmitButton>
                </>
              )}
            </div>
            {blocked && blockedReason ? (
              <p id={reasonId} className="mt-2 text-body-5 text-neutral-3 md:text-right">
                {blockedReason}
              </p>
            ) : null}
          </footer>
        </form>
      </DialogContent>
    </Dialog>
  );
}
