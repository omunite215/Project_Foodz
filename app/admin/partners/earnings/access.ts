import 'server-only';
import type { Metadata } from 'next';
import { can } from '@/server/auth/roles';
import { getActor, type UserActor } from '@/server/auth/session';
import type { StaffShell } from '@/server/modules/staff/schema';
import { GATE_TAB_TITLES } from '@/components/admin/gate-text';
import { loadStaffShell } from '../../staff-access';

/*
 * Who reads the payouts report (F9 design 3.1, A63.1): ADMIN and the demo admin, who hold
 * `earnings: report`. SUPPORT, KITCHEN and CONTENT_EDITOR get the no-access page; customers,
 * partners, guests and staff without two-factor are handled by the `/admin` layout. The page
 * asks again before it reads anything, and the service checks the permission once more.
 */

/** The storefront 404's own title, so the page's name never shows to a customer or partner. */
const STOREFRONT_NOT_FOUND: Metadata = { title: { absolute: 'Page not found | Foodz' } };

export type ReportAccess =
  | { kind: 'allowed'; actor: UserActor; shell: Extract<StaffShell, { kind: 'staff' }> }
  | { kind: 'handledByLayout' }
  /** Where "Back" goes: SUPPORT to the Partners list, KITCHEN to the board. */
  | { kind: 'noAccess'; back: 'partners' | 'board' | null };

export async function reportAccess(): Promise<ReportAccess> {
  const shell = await loadStaffShell();
  if (shell.kind !== 'staff') return { kind: 'handledByLayout' };
  if (!can(shell.user.role, { earnings: ['report'] })) {
    const back = shell.screens.includes('partners')
      ? 'partners'
      : shell.screens.includes('orderBoard')
        ? 'board'
        : null;
    return { kind: 'noAccess', back };
  }
  const actor = await getActor();
  if (actor.kind !== 'user') return { kind: 'handledByLayout' };
  return { kind: 'allowed', actor, shell };
}

/** The report's tab title, or the gate's. */
export async function reportPageMetadata(title: string): Promise<Metadata> {
  const shell = await loadStaffShell();
  if (shell.kind === 'notStaff') return STOREFRONT_NOT_FOUND;
  if (shell.kind === 'twoFactorRequired') return { title: GATE_TAB_TITLES.twoFactor };
  if (shell.kind === 'staff' && !can(shell.user.role, { earnings: ['report'] })) {
    return { title: GATE_TAB_TITLES.noAccess };
  }
  return { title };
}
