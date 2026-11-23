import type { Metadata } from 'next';
import { getBoard } from '@/server/modules/board/service';
import { AdminPage } from '@/components/admin/admin-page';
import { StaffGate } from '@/components/admin/staff-gate';
import { OrderBoard } from '@/components/board/order-board';
import { boardAccess, staffPageMetadata } from '../staff-access';

export function generateMetadata(): Promise<Metadata> {
  return staffPageMetadata('Order board');
}

/**
 * The order board (F5 design 2): every live order, in the first HTML (A2.8), then kept
 * current in the browser. Content editors get the no-access page (A1.5).
 */
export default async function OrderBoardPage() {
  const access = await boardAccess();
  if (access.kind === 'handledByLayout') return null;
  if (access.kind === 'noAccess') {
    return (
      <AdminPage>
        <StaffGate kind="noAccess" />
      </AdminPage>
    );
  }
  const snapshot = await getBoard(access.actor);
  return <OrderBoard initial={snapshot} />;
}
