import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import type { UserActor } from '@/server/auth/session';
import { getStaffOrderDetail } from '@/server/modules/board/service';
import { AdminPage } from '@/components/admin/admin-page';
import { StaffGate } from '@/components/admin/staff-gate';
import { StaffOrderPage } from '@/components/board/detail/staff-order-page';
import { boardAccess, staffPageMetadata } from '../../staff-access';

type Props = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Shared by the metadata and the page; a number or a made-up id is "Order not found". */
const loadDetail = cache(async (actor: UserActor, id: string) =>
  UUID.test(id) ? getStaffOrderDetail(actor, id.toLowerCase()) : null,
);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const access = await boardAccess();
  if (access.kind !== 'allowed') return staffPageMetadata('Order');
  const detail = await loadDetail(access.actor, (await params).id);
  return { title: detail ? `Order ${detail.number}` : 'Order not found' };
}

/** An order's address loaded directly: the detail as a full page in the shell (design 5.1). */
export default async function StaffOrderDetailPage({ params }: Props) {
  const access = await boardAccess();
  if (access.kind === 'handledByLayout') return null;
  if (access.kind === 'noAccess') {
    return (
      <AdminPage>
        <StaffGate kind="noAccess" />
      </AdminPage>
    );
  }
  const detail = await loadDetail(access.actor, (await params).id);
  if (!detail) notFound();
  return <StaffOrderPage initial={detail} />;
}
