'use client';

import { Heart, ShoppingBag, TicketPercent } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import type { SignInReason } from '@/server/modules/auth/schema';
import { FormAlert } from '@/components/forms/form-alert';
import {
  pendingFavoriteStep,
  readPendingFavorite,
  readPendingPromo,
  reasonNoticeText,
} from '@/lib/sign-in-reason';

/*
 * Why she was sent to sign in or to create an account (F3 design 1.3, B13). The server draws a
 * sentence from a fixed list, so it never shifts the form; this tab then names the dish or the
 * code from its own storage, never from the address. A forged link keeps the plain sentence and
 * saves nothing.
 */

const ICONS = { checkout: ShoppingBag, promo: TicketPercent, favorite: Heart } as const;

/** The code or dish this tab kept for the return, while it is still waiting. */
function keptName(reason: SignInReason): string | null {
  if (reason === 'promo') return readPendingPromo();
  if (reason === 'favorite') {
    const pending = readPendingFavorite();
    if (!pending) return null;
    const step = pendingFavoriteStep(pending, {
      signedIn: false,
      path: '',
      onAuthPage: true,
      now: Date.now(),
    });
    return step === 'keep' ? pending.title : null;
  }
  return null;
}

const noUpdates = () => () => {};

export function SignInReasonNotice({
  reason,
  page = '/sign-in',
}: {
  reason: SignInReason;
  /** The sign-up page asks her to create an account, not to sign in. */
  page?: '/sign-in' | '/sign-up';
}) {
  // The server's sentence first; the browser's own record names the dish or code after hydration.
  const name = useSyncExternalStore(
    noUpdates,
    () => keptName(reason),
    () => null,
  );

  return (
    <FormAlert variant="info" icon={ICONS[reason]} className="mb-6">
      {reasonNoticeText(reason, page, name)}
    </FormAlert>
  );
}
