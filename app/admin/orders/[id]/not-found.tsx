import type { Metadata } from 'next';
import { AdminPage } from '@/components/admin/admin-page';
import { StaffGate } from '@/components/admin/staff-gate';

export const metadata: Metadata = { title: 'Order not found' };

/** A made-up id, or a number where the id belongs (A10.6, A13.2). */
export default function OrderNotFound() {
  return (
    <AdminPage>
      <StaffGate kind="notFound" />
    </AdminPage>
  );
}
