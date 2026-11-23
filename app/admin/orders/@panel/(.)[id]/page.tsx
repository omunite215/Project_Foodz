import type { Metadata } from 'next';
import { getStaffOrderDetail } from '@/server/modules/board/service';
import { DetailPanel } from '@/components/board/detail/detail-panel';
import { boardAccess, staffPageMetadata } from '../../../staff-access';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Props = { params: Promise<{ id: string }> };

/** The tab says which order is open over the board (A1.9): "Order 1042 | Foodz Admin". */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const access = await boardAccess();
  if (access.kind !== 'allowed') return staffPageMetadata('Order');
  const { id } = await params;
  const detail = UUID.test(id) ? await getStaffOrderDetail(access.actor, id.toLowerCase()) : null;
  return { title: detail ? `Order ${detail.number}` : 'Order not found' };
}

/**
 * An order opened from the board: the detail as a panel over it (F5 design 5.1). The panel
 * loads the order itself, so it opens at once with what the card already knows.
 */
export default async function OrderPanel({ params }: Props) {
  const access = await boardAccess();
  if (access.kind !== 'allowed') return null;
  const { id } = await params;
  return <DetailPanel key={id} orderId={UUID.test(id) ? id.toLowerCase() : id} />;
}
