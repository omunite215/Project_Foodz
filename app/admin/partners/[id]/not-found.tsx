import type { Metadata } from 'next';
import { AdminPage } from '@/components/admin/admin-page';
import { StaffGate } from '@/components/admin/staff-gate';

export const metadata: Metadata = { title: 'Application not found' };

/** A missing id, a non-UUID ("6VH450") or a withdrawn application (F6 A20.1, design 8.12). */
export default function ApplicationNotFound() {
  return (
    <AdminPage title="Partners" titleAs="p">
      <StaffGate kind="applicationNotFound" />
    </AdminPage>
  );
}
