'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { onAuthEvent } from '@/lib/auth-channel';
import { isAuthPage } from '@/lib/auth-links';
import { forgetCheckout } from '@/lib/checkout-storage';
import { useCartSession } from '@/lib/data/cart';
import { forgetEmail } from '@/lib/email-handoff';
import { forgetDrafts, hasUnsavedChanges, onUnsavedChangesSettled } from '@/lib/form-draft';
import { SessionToast, showSessionToast, SIGNED_OUT_ELSEWHERE_TEXT } from './session-toast';

/**
 * The email the sign-in forms carry belongs to the person who typed it. Once their session is
 * over, the next person here must not find it (S2.2). On the sign-in pages themselves it is in
 * use (a reset hands it to the sign-in form), so it stays there.
 */
function forgetCarriedEmail() {
  if (!isAuthPage(window.location.pathname)) forgetEmail();
}

/**
 * Keeps this tab in step with the session (S5.8, S5.10, S3.2):
 * - a cart kept for a session that has since ended is emptied, and the person is told;
 * - when another tab signs in, signs out or confirms the email, this one re-reads the page;
 * - while the email is waiting for confirmation, returning to the tab re-reads it too.
 *
 * A form with unsaved changes holds those re-reads back: on an account page, re-reading after
 * the session ended would send the person to sign in and wipe what they typed. The re-read waits
 * until no form holds changes (saved, or left for another page), so the person's next action
 * shows the signed-out state, and Save keeps the typing for after signing in (S2.12).
 */
export function SessionWatch({
  sessionKey,
  refreshOnReturn,
}: {
  /** An opaque key for the signed-in session (never its token); null when signed out. */
  sessionKey: string | null;
  refreshOnReturn: boolean;
}) {
  const router = useRouter();
  const refreshHeld = useRef(false);

  useCartSession(sessionKey, () => showSessionToast(SIGNED_OUT_ELSEWHERE_TEXT), forgetCarriedEmail);

  useEffect(() => {
    const refreshWhenSafe = () => {
      if (hasUnsavedChanges()) refreshHeld.current = true;
      else router.refresh();
    };
    const stopWatching = onUnsavedChangesSettled(() => {
      if (!refreshHeld.current) return;
      refreshHeld.current = false;
      router.refresh();
    });
    const stopListening = onAuthEvent((type) => {
      if (type === 'signed-out') {
        // Signed out on purpose in another tab: this tab's drafts, carried email and checkout
        // choices (note, tip, the order just placed) go too.
        forgetDrafts();
        forgetCarriedEmail();
        forgetCheckout();
      }
      refreshWhenSafe();
    });
    const onVisible = () => {
      if (refreshOnReturn && document.visibilityState === 'visible') refreshWhenSafe();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopWatching();
      stopListening();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refreshOnReturn, router]);

  return <SessionToast />;
}
