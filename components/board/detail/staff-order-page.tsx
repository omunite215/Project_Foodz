'use client';

import { useState } from 'react';
import type { StaffOrderDetail } from '@/server/modules/board/schema';
import { BackLink } from '@/components/account/back-link';
import { AdminPage, useSessionPhase } from '@/components/admin/admin-page';
import { SignedOutOverlay } from '@/components/admin/signed-out-overlay';
import { useStaffShell } from '@/components/admin/staff-shell-context';
import { StaffOrderDetailView, useStaffOrderDetail } from './staff-order-detail';

/**
 * The detail loaded directly or reloaded (F5 design 5.1): the same content as a full page
 * inside the shell, "Order 1042" as the top bar's h1, "Back to the board" above it.
 */
export function StaffOrderPage({ initial }: { initial: StaffOrderDetail }) {
  const shell = useStaffShell();
  const [signedOut, setSignedOut] = useState(false);
  const sessionEnded = useSessionPhase(shell.sessionExpiresAt) === 'ended';
  const detail = useStaffOrderDetail(initial.id, initial, !signedOut && !sessionEnded);
  const data = detail.data ?? initial;

  return (
    <AdminPage title={`Order ${data.number}`}>
      <div
        className="mx-auto w-full max-w-[720px] px-4 py-6 lg:px-6"
        inert={signedOut || undefined}
      >
        <BackLink href="/admin/orders">Back to the board</BackLink>
        <div className="mt-6 overflow-hidden rounded-2xl border border-neutral-6 bg-white">
          <StaffOrderDetailView
            detail={data}
            variant="page"
            timeZone={shell.timeZone}
            onSignedOut={() => setSignedOut(true)}
          />
        </div>
      </div>
      {signedOut || sessionEnded ? <SignedOutOverlay /> : null}
    </AdminPage>
  );
}
