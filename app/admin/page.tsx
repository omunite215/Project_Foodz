import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AdminPage } from '@/components/admin/admin-page';
import { GATE_TAB_TITLES } from '@/components/admin/gate-text';
import { StaffGate } from '@/components/admin/staff-gate';
import { loadStaffShell } from './staff-access';

export async function generateMetadata(): Promise<Metadata> {
  const shell = await loadStaffShell();
  return {
    title:
      shell.kind === 'twoFactorRequired' ? GATE_TAB_TITLES.twoFactor : GATE_TAB_TITLES.nothingHere,
  };
}

/**
 * `/admin` (F5 design 1.1): staff with a screen go to it ("/admin/orders"); a content editor,
 * who has none yet, reads "Nothing here yet" (A1.5).
 */
export default async function AdminHome() {
  const shell = await loadStaffShell();
  if (shell.kind !== 'staff') return null;
  if (shell.home) redirect(shell.home);
  return (
    <AdminPage>
      <StaffGate kind="nothingHere" />
    </AdminPage>
  );
}
