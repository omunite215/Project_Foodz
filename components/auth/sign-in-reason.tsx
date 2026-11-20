'use client';

import { Heart, ShoppingBag, TicketPercent } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import type { SignInReason } from '@/server/modules/auth/schema';
import { FormAlert } from '@/components/forms/form-alert';
import { pendingFavoriteStep, readPendingFavorite, readPendingPromo } from '@/lib/sign-in-reason';

/*
 * Why she was sent to sign in (F3 design 1.3, B13). The server draws a sentence from a fixed
 * list, so it never shifts the form; this tab then names the dish or the code from its own
 * storage, never from the address. A forged link keeps the plain sentence and saves nothing.
 */

const SERVER_TEXT: Record<SignInReason, string> = {
  checkout: 'Sign in to check out. Your cart is saved.',
  promo: 'Sign in to use your promo code.',
  favorite: 'Sign in to save this dish to your favorites.',
};

const ICONS = { checkout: ShoppingBag, promo: TicketPercent, favorite: Heart } as const;

function namedText(reason: SignInReason): string | null {
  if (reason === 'promo') {
    const code = readPendingPromo();
    return code ? `Sign in to use ${code}.` : null;
  }
  if (reason === 'favorite') {
    const pending = readPendingFavorite();
    if (!pending) return null;
    const step = pendingFavoriteStep(pending, {
      signedIn: false,
      path: '',
      onAuthPage: true,
      now: Date.now(),
    });
    return step === 'keep' ? `Sign in to save ${pending.title} to your favorites.` : null;
  }
  return null;
}

const noUpdates = () => () => {};

export function SignInReasonNotice({ reason }: { reason: SignInReason }) {
  // The server's sentence first; the browser's own record names the dish or code after hydration.
  const named = useSyncExternalStore(
    noUpdates,
    () => namedText(reason),
    () => null,
  );

  return (
    <FormAlert variant="info" icon={ICONS[reason]} className="mb-6">
      {named ?? SERVER_TEXT[reason]}
    </FormAlert>
  );
}
