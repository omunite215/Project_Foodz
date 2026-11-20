import type { Route } from 'next';
import { z } from 'zod';
import type { SignInReason } from '@/server/modules/auth/schema';
import { authPageHref } from './auth-links';
import { isSitePath } from './navigation';

/*
 * Sending someone to sign in for a reason (F3 B13, design 1.3, 3.2): `reason` comes from a fixed
 * list, and any name shown with it ("Sign in to save Bulgogi…") comes from this tab's own
 * sessionStorage, never from the address. A link can't make anyone favorite a dish: only a
 * record written by a tap in this tab can.
 */

/** "/sign-in?callbackUrl=%2Fmenu&reason=favorite" */
export function signInFor(
  page: '/sign-in' | '/sign-up',
  returnPath: unknown,
  reason: SignInReason | null,
): Route {
  const base = authPageHref(page, returnPath);
  if (!reason) return base;
  const href = `${base}${base.includes('?') ? '&' : '?'}reason=${reason}`;
  return isSitePath(href) ? href : base;
}

const PENDING_FAVORITE_KEY = 'foodz.favorite.pending';
const PENDING_PROMO_KEY = 'foodz.promo.pending';
const REOPEN_CART_KEY = 'foodz.cart.reopen';

/** How long a heart tapped while signed out waits for the sign-in (design 3.2). */
export const PENDING_FAVORITE_MS = 15 * 60_000;

export interface PendingFavorite {
  dishId: string;
  title: string;
  /** The page (path and query) the heart was tapped on. */
  path: string;
  /** When, in ms since the epoch. */
  at: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const pendingFavoriteSchema = z.object({
  dishId: z.string().regex(UUID),
  title: z.string().min(1).max(200),
  path: z.string().max(2048).refine(isSitePath),
  at: z.number().finite(),
});

export function parsePendingFavorite(raw: string | null): PendingFavorite | null {
  if (!raw) return null;
  try {
    const parsed = pendingFavoriteSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export type PendingFavoriteStep = 'save' | 'drop' | 'keep';

/**
 * What to do with a pending heart on a page render: save it once signed in, back on the same page
 * within 15 minutes; keep it while on the sign-in pages; otherwise drop it (back without signing
 * in, another page, or too old).
 */
export function pendingFavoriteStep(
  pending: PendingFavorite,
  {
    signedIn,
    path,
    onAuthPage,
    now,
  }: { signedIn: boolean; path: string; onAuthPage: boolean; now: number },
): PendingFavoriteStep {
  if (now - pending.at > PENDING_FAVORITE_MS || now < pending.at - 60_000) return 'drop';
  if (onAuthPage) return 'keep';
  if (!signedIn) return 'drop';
  return pending.path === path ? 'save' : 'drop';
}

function session(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function readPendingFavorite(): PendingFavorite | null {
  return parsePendingFavorite(session()?.getItem(PENDING_FAVORITE_KEY) ?? null);
}

export function writePendingFavorite(pending: PendingFavorite) {
  try {
    session()?.setItem(PENDING_FAVORITE_KEY, JSON.stringify(pending));
  } catch {
    // Storage blocked: the heart can't be kept for the return, and that is all.
  }
}

export function clearPendingFavorite() {
  session()?.removeItem(PENDING_FAVORITE_KEY);
}

/** A code that needs a signed-in customer (R5), kept for the return from sign-in. */
export function writePendingPromo(code: string) {
  try {
    session()?.setItem(PENDING_PROMO_KEY, code);
  } catch {
    // Storage blocked: she types the code again.
  }
}

export function readPendingPromo(): string | null {
  const code = session()?.getItem(PENDING_PROMO_KEY) ?? null;
  return code && /^[^\s<>]{1,32}$/u.test(code) ? code : null;
}

export function clearPendingPromo() {
  session()?.removeItem(PENDING_PROMO_KEY);
}

/** The cart opens again on return from sign-in (B1, S4.8): set before leaving, read once. */
export function requestCartReopen() {
  try {
    session()?.setItem(REOPEN_CART_KEY, '1');
  } catch {
    // Storage blocked: she opens the cart herself.
  }
}

export type CartReopenStep = 'open' | 'drop' | 'keep';

/**
 * What to do with the reopen flag on a page: keep it while on the sign-in pages (the cart would
 * cover the form), open the cart once she is back and signed in, and drop it if she came back
 * without signing in.
 */
export function cartReopenStep({
  signedIn,
  onAuthPage,
}: {
  signedIn: boolean;
  onAuthPage: boolean;
}): CartReopenStep {
  if (onAuthPage) return 'keep';
  return signedIn ? 'open' : 'drop';
}

/** True once, when the cart should open again on this page. */
export function takeCartReopen(where: { signedIn: boolean; onAuthPage: boolean }): boolean {
  const store = session();
  if (!store?.getItem(REOPEN_CART_KEY)) return false;
  const step = cartReopenStep(where);
  if (step === 'keep') return false;
  store.removeItem(REOPEN_CART_KEY);
  return step === 'open';
}
