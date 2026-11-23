'use client';

import { useQueryClient } from '@tanstack/react-query';
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
import { forgetEmail } from '@/lib/email-handoff';
import { forgetDrafts } from '@/lib/form-draft';
import { showSessionToast, SIGN_OUT_FAILED_TEXT, SIGN_OUT_OFFLINE_TEXT } from './session-toast';

/** Marks the header's "Sign in" link, which takes focus after signing out on a public page. */
export const SIGN_IN_ENTRY_ATTRIBUTE = 'data-sign-in-entry';

/**
 * Focuses an element as soon as it is drawn and `ready` holds (the refreshed header or the next
 * page can take a moment). Gives up after 10 seconds.
 */
function focusWhenDrawn(selector: string, ready: () => boolean = () => true, attempts = 200) {
  const element = ready() ? document.querySelector<HTMLElement>(selector) : null;
  if (element) {
    element.focus();
    return;
  }
  if (attempts > 0) setTimeout(() => focusWhenDrawn(selector, ready, attempts - 1), 50);
}

/**
 * Signing out of this device (S5.8, S5.10). The request is a POST from a button, never a link.
 * With items in the cart, a dialog says the cart will be emptied first. Afterwards the cart is
 * emptied in every tab, other tabs are told, and focus lands somewhere sensible: Home's content
 * after an account page, otherwise the header's new "Sign in" link. Nothing typed or fetched for
 * this person stays behind in the tab: no form draft, no email for the sign-in form (S2.2), and
 * no cached query.
 *
 * If it fails, the account stays shown and the toast says why: "You're offline" only when the
 * browser is offline or the request never reached the server; a refusal (403, 429, 5xx) asks
 * to try again.
 */
export function useSignOut() {
  const router = useRouter();
  const pathname = usePathname();
  const { itemCount } = useCart();
  const endCartSession = useEndCartSession();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);

  function fail(text: string) {
    busy.current = false;
    setPending(false);
    setDialogOpen(false);
    showSessionToast(text);
  }

  async function signOutNow() {
    if (busy.current) return;
    if (isOffline()) {
      fail(SIGN_OUT_OFFLINE_TEXT);
      return;
    }
    busy.current = true;
    setPending(true);
    let response: Response;
    try {
      response = await fetch('/api/auth/sign-out', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
    } catch {
      // The request never reached the server.
      fail(SIGN_OUT_OFFLINE_TEXT);
      return;
    }
    if (!response.ok) {
      fail(SIGN_OUT_FAILED_TEXT);
      return;
    }

    endCartSession();
    forgetDrafts();
    forgetEmail();
    // Nothing fetched for this person stays in the tab's cache for whoever signs in next.
    queryClient.clear();
    postAuthEvent('signed-out');
    setDialogOpen(false);
    if (pathname.startsWith('/account')) {
      router.replace('/');
      // <main> belongs to the root layout, so it is already there; wait until it holds Home, so
      // the focus never lands on the account page that is about to go.
      focusWhenDrawn('#main', () => window.location.pathname === '/');
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
