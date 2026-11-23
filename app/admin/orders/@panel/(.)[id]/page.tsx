import { DetailPanel } from '@/components/board/detail/detail-panel';
import { boardAccess } from '../../../staff-access';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * An order opened from the board: the detail as a panel over it (F5 design 5.1). The panel
 * loads the order itself, so it opens at once with what the card already knows.
 */
export default async function OrderPanel({ params }: { params: Promise<{ id: string }> }) {
  const access = await boardAccess();
  if (access.kind !== 'allowed') return null;
  const { id } = await params;
  return <DetailPanel key={id} orderId={UUID.test(id) ? id.toLowerCase() : id} />;
}
