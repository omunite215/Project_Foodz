'use client';

import { useRef } from 'react';
import { SubmitButton } from '@/components/forms/submit-button';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

/*
 * "Place it again?" (F4 design 2.20, D25): the same order to the same address a moment ago.
 * "View order 1042" is the first focus, the safe choice; Escape sends nothing.
 */

export function DuplicateDialog({
  duplicate,
  pending,
  pendingLabel,
  onView,
  onPlaceAgain,
  onClose,
}: {
  duplicate: { orderId: string; number: string } | null;
  pending: boolean;
  pendingLabel: string;
  onView: () => void;
  onPlaceAgain: () => void;
  onClose: () => void;
}) {
  const viewRef = useRef<HTMLButtonElement>(null);
  return (
    <AlertDialog
      open={duplicate !== null}
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <AlertDialogContent
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          viewRef.current?.focus();
        }}
      >
        <AlertDialogTitle>Place it again?</AlertDialogTitle>
        <AlertDialogDescription>
          You placed this same order a moment ago (order {duplicate?.number}).
        </AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button ref={viewRef} type="button" variant="outline" size="touch" onClick={onView}>
              View order {duplicate?.number}
            </Button>
          </AlertDialogCancel>
          <SubmitButton
            type="button"
            pending={pending}
            pendingLabel={pendingLabel}
            onClick={onPlaceAgain}
          >
            Place it again
          </SubmitButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
