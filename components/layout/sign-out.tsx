'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { SubmitButton } from '@/components/forms/submit-button';
import { itemsText } from '@/lib/account-text';
import { isOffline } from '@/lib/action-result';
import { announce } from '@/lib/announce';
import { postAuthEvent } from '@/lib/auth-channel';
import { useCart, useEndCartSession } from '@/lib/data/cart';
import { showSessionToast, SIGN_OUT_OFFLINE_TEXT } from './session-toast';

/** Marks the header's "Sign in" link, which takes focus after signing out on a public page. */
export const SIGN_IN_ENTRY_ATTRIBUTE = 'data-sign-in-entry';

/** Focuses an element as soon as it is drawn (the refreshed header can take a moment). */
function focusWhenDrawn(selector: string, attempts = 100) {
  const element = document.querySelector<HTMLElement>(selector);
  if (element) {
    element.focus();
    return;
  }
  if (attempts > 0) setTimeout(() => focusWhenDrawn(selector, attempts - 1), 50);
}

/**
 * Signing out of this device (S5.8, S5.10). The request is a POST from a button, never a link.
 * With items in the cart, a dialog says the cart will be emptied first. Afterwards the cart is
 * emptied in every tab, other tabs are told, and focus lands somewhere sensible: Home's content
 * after an account page, otherwise the header's new "Sign in" link.
 */
export function useSignOut() {
  const router = useRouter();
  const pathname = usePathname();
  const { itemCount } = useCart();
  const endCartSession = useEndCartSession();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);

  async function signOutNow() {
    if (busy.current) return;
    if (isOffline()) {
      setDialogOpen(false);
      showSessionToast(SIGN_OUT_OFFLINE_TEXT);
      return;
    }
    busy.current = true;
    setPending(true);
    try {
      const response = await fetch('/api/auth/sign-out', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      if (!response.ok) throw new Error(`Sign-out answered ${response.status}`);
    } catch {
      busy.current = false;
      setPending(false);
      setDialogOpen(false);
      showSessionToast(SIGN_OUT_OFFLINE_TEXT);
      return;
    }

    endCartSession();
    postAuthEvent('signed-out');
    setDialogOpen(false);
    if (pathname.startsWith('/account')) {
      router.replace('/');
      focusWhenDrawn('#main');
    } else {
      router.refresh();
      focusWhenDrawn(`[${SIGN_IN_ENTRY_ATTRIBUTE}]`);
    }
    announce("You're signed out");
    busy.current = false;
    setPending(false);
  }

  return {
    itemCount,
    pending,
    dialogOpen,
    setDialogOpen,
    signOutNow,
    /** Signs out now, or asks first when the cart has items. */
    request() {
      if (itemCount > 0) setDialogOpen(true);
      else void signOutNow();
    },
  };
}

export type SignOutState = ReturnType<typeof useSignOut>;

/** "Sign out?" with the number of items the cart will lose. Focus starts on Cancel. */
export function SignOutDialog({
  state,
  onCloseFocus,
}: {
  state: SignOutState;
  /** Where focus goes when the dialog closes (the control that opened it). */
  onCloseFocus?: () => void;
}) {
  return (
    <AlertDialog
      open={state.dialogOpen}
      onOpenChange={(open) => {
        if (!state.pending) state.setDialogOpen(open);
      }}
    >
      <AlertDialogContent
        onCloseAutoFocus={(event) => {
          if (!onCloseFocus) return;
          event.preventDefault();
          onCloseFocus();
        }}
      >
        <AlertDialogTitle>Sign out?</AlertDialogTitle>
        <AlertDialogDescription>
          Signing out empties your cart on this device {itemsText(state.itemCount)}.
        </AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <SubmitButton
            type="button"
            pending={state.pending}
            pendingLabel="Signing out…"
            onClick={() => void state.signOutNow()}
          >
            Sign out
          </SubmitButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
