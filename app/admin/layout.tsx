import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import type { StaffShell } from '@/server/modules/staff/schema';
import { AdminPage } from '@/components/admin/admin-page';
import { AdminShell } from '@/components/admin/admin-shell';
import type { ShellFrame, StaffShellValue } from '@/components/admin/staff-shell-context';
import { StaffGate } from '@/components/admin/staff-gate';
import { authPageHref } from '@/lib/auth-links';
import { STORE_TIME_ZONE } from '@/lib/order-text';
import { REQUEST_PATH_HEADER } from '@/lib/request-path';
import { loadStaffShell } from './staff-access';

export const metadata: Metadata = {
  title: { absolute: 'Staff tools | Foodz Admin', template: '%s | Foodz Admin' },
  // A1.9: never indexed. `no-store` is a response header for /admin (next.config).
  robots: { index: false, follow: false },
};

/** shadcn's sidebar remembers expanded or rail in this cookie. */
const SIDEBAR_COOKIE = 'sidebar_state';

function frameOf(shell: Extract<StaffShell, { kind: 'staff' }>): ShellFrame {
  if (shell.sidebar) return 'sidebar';
  return shell.user.role === 'kitchen' ? 'kitchen' : 'editor';
}

/**
 * Every `/admin` page (F5 design 1.1). The server decides what renders, before any HTML:
 * guests go to sign in and come back (A1.2), customers and couriers get the storefront's 404
 * (A1.3), staff without two-factor get the gate whatever the address (A1.4), and staff get
 * their frame. The storefront's header and footer never render here.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const shell = await loadStaffShell();

  if (shell.kind === 'guest') {
    const requested = (await headers()).get(REQUEST_PATH_HEADER) ?? '/admin';
    redirect(authPageHref('/sign-in', requested.startsWith('/admin') ? requested : '/admin'));
  }
  if (shell.kind === 'notStaff') notFound();

  if (shell.kind === 'twoFactorRequired') {
    const value: StaffShellValue = {
      frame: 'gate',
      user: shell.user,
      screens: [],
      readOnly: false,
      sessionExpiresAt: null,
      timeZone: STORE_TIME_ZONE,
    };
    return (
      <AdminShell shell={value} sidebarOpen={null}>
        <AdminPage>
          <StaffGate kind="twoFactor" />
        </AdminPage>
      </AdminShell>
    );
  }

  const saved = (await cookies()).get(SIDEBAR_COOKIE)?.value;
  const value: StaffShellValue = {
    frame: frameOf(shell),
    user: shell.user,
    screens: shell.screens,
    readOnly: shell.readOnly,
    sessionExpiresAt: shell.sessionExpiresAt,
    timeZone: STORE_TIME_ZONE,
  };
  return (
    <AdminShell
      shell={value}
      sidebarOpen={saved === 'true' ? true : saved === 'false' ? false : null}
    >
      {children}
    </AdminShell>
  );
}
