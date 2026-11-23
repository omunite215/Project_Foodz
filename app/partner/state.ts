import 'server-only';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { getActor, getSession } from '@/server/auth/session';
import { getMyPartnerState } from '@/server/modules/partners/service';
import type { PartnerState } from '@/server/modules/partners/schema';
import { authPageHref } from '@/lib/auth-links';

/*
 * What `/partner` shows, decided on the server before any HTML (F6 B3, P17.6): one read per
 * request, shared by a page and its metadata. Guests go to sign in and come back to the address
 * they asked for, before anything renders.
 */

export interface PartnerRequest {
  userId: string;
  sessionKey: string;
  state: PartnerState;
}

export const loadPartnerState = cache(async (): Promise<PartnerRequest | null> => {
  const actor = await getActor();
  if (actor.kind !== 'user') return null;
  const session = await getSession();
  const state = await getMyPartnerState(actor, { sessionId: session?.session.id ?? null });
  if (!state) return null;
  return { userId: actor.userId, sessionKey: session?.session.id ?? '', state };
});

/** The state, or a redirect to sign in that comes back to `path`. */
export async function requirePartnerState(path: string): Promise<PartnerRequest> {
  const loaded = await loadPartnerState();
  if (!loaded) redirect(authPageHref('/sign-in', path));
  return loaded;
}

/** "Home | Foodz Partner". Absolute: a layout's template skips pages in its own segment. */
export const partnerTitle = (title: string | null): Metadata['title'] => ({
  absolute: title ? `${title} | Foodz Partner` : 'Foodz Partner',
});
