import 'server-only';
import type { Metadata } from 'next';
import { cache } from 'react';
import { getActor, type UserActor } from '@/server/auth/session';
import { getStaffShell } from '@/server/modules/staff/service';
import type { StaffShell } from '@/server/modules/staff/schema';
import { GATE_TAB_TITLES } from '@/components/admin/gate-text';

/*
 * Staff access for `/admin` pages (F5 design 1.1, A1.10). The layout decides the frame, and
 * every page asks again before it reads anything: a page renders alongside its layout, so it
 * must never rely on the layout having stopped a visitor.
 */

/**
 * The tab title of the storefront's 404 (app/not-found.tsx under the root template). Customers
 * and couriers at a staff address get that page, so its title must not name the screen either
 * (F5 A1.3, F6 A18.3). Absolute: the admin layout's template would add "Foodz Admin".
 */
const STOREFRONT_NOT_FOUND: Metadata = { title: { absolute: 'Page not found | Foodz' } };

/** One read per request, shared by the layout, the page and its metadata. */
export const loadStaffShell = cache((): Promise<StaffShell> => getStaffShell());

export type BoardAccess =
  | { kind: 'allowed'; actor: UserActor; shell: Extract<StaffShell, { kind: 'staff' }> }
  /** The layout already shows the gate, the 404 or the sign-in redirect. */
  | { kind: 'handledByLayout' }
  /** CONTENT_EDITOR on an order page: "You don't have access to this page" (A1.5). */
  | { kind: 'noAccess' };

/** May this request read the order board and order details? */
export async function boardAccess(): Promise<BoardAccess> {
  const shell = await loadStaffShell();
  if (shell.kind !== 'staff') return { kind: 'handledByLayout' };
  if (!shell.screens.includes('orderBoard')) return { kind: 'noAccess' };
  const actor = await getActor();
  if (actor.kind !== 'user') return { kind: 'handledByLayout' };
  return { kind: 'allowed', actor, shell };
}

/** A page's tab title, or the gate's when the person can't see the page (design 1.10). */
export async function staffPageMetadata(title: string): Promise<Metadata> {
  const shell = await loadStaffShell();
  if (shell.kind === 'notStaff') return STOREFRONT_NOT_FOUND;
  if (shell.kind === 'twoFactorRequired') return { title: GATE_TAB_TITLES.twoFactor };
  if (shell.kind === 'staff' && !shell.screens.includes('orderBoard')) {
    return { title: GATE_TAB_TITLES.noAccess };
  }
  return { title };
}

export type PartnersAccess =
  | { kind: 'allowed'; actor: UserActor; shell: Extract<StaffShell, { kind: 'staff' }> }
  | { kind: 'handledByLayout' }
  /** KITCHEN and CONTENT_EDITOR at a Partners address (F6 A18.2). */
  | { kind: 'noAccess' };

/** May this request read partner applications (F6 A18)? SUPPORT, ADMIN and the demo admin. */
export async function partnersAccess(): Promise<PartnersAccess> {
  const shell = await loadStaffShell();
  if (shell.kind !== 'staff') return { kind: 'handledByLayout' };
  if (!shell.screens.includes('partners')) return { kind: 'noAccess' };
  const actor = await getActor();
  if (actor.kind !== 'user') return { kind: 'handledByLayout' };
  return { kind: 'allowed', actor, shell };
}

/** A Partners page's tab title, or the gate's (F6 A18.4: never a person's name). */
export async function partnersPageMetadata(title: string): Promise<Metadata> {
  const shell = await loadStaffShell();
  if (shell.kind === 'notStaff') return STOREFRONT_NOT_FOUND;
  if (shell.kind === 'twoFactorRequired') return { title: GATE_TAB_TITLES.twoFactor };
  if (shell.kind === 'staff' && !shell.screens.includes('partners')) {
    return { title: GATE_TAB_TITLES.partnersNoAccess };
  }
  return { title };
}

export type LiveMapAccess =
  | { kind: 'allowed'; actor: UserActor; shell: Extract<StaffShell, { kind: 'staff' }> }
  | { kind: 'handledByLayout' }
  /** KITCHEN and CONTENT_EDITOR at the live map (F8 A47.2). */
  | { kind: 'noAccess' };

/** May this request see the live map? SUPPORT, ADMIN and the demo admin (F8 A46.1). */
export async function liveMapAccess(): Promise<LiveMapAccess> {
  const shell = await loadStaffShell();
  if (shell.kind !== 'staff') return { kind: 'handledByLayout' };
  if (!shell.screens.includes('liveMap')) return { kind: 'noAccess' };
  const actor = await getActor();
  if (actor.kind !== 'user') return { kind: 'handledByLayout' };
  return { kind: 'allowed', actor, shell };
}

/** The live map's tab title, or the gate's. */
export async function liveMapPageMetadata(title: string): Promise<Metadata> {
  const shell = await loadStaffShell();
  if (shell.kind === 'notStaff') return STOREFRONT_NOT_FOUND;
  if (shell.kind === 'twoFactorRequired') return { title: GATE_TAB_TITLES.twoFactor };
  if (shell.kind === 'staff' && !shell.screens.includes('liveMap')) {
    return { title: GATE_TAB_TITLES.liveMapNoAccess };
  }
  return { title };
}
