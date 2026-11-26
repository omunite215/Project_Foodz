import type { Metadata } from 'next';
import { getOpsMap } from '@/server/modules/tracking/service';
import { STORE_TIME_ZONE } from '@/lib/order-text';
import { AdminPage } from '@/components/admin/admin-page';
import { StaffGate } from '@/components/admin/staff-gate';
import { LiveMapPage } from '@/components/live-map/live-map-page';
import { firstParam } from '@/lib/search-params';
import { liveMapAccess, liveMapPageMetadata } from '../staff-access';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function generateMetadata(): Promise<Metadata> {
  return liveMapPageMetadata('Live map');
}

/**
 * The live map (F8 design 3.1 to 3.7, A46): every online courier and active delivery of the
 * viewer's pool, the list in the first HTML and the markers as soon as the map's style loads.
 * KITCHEN and CONTENT_EDITOR get the no-access page (A47.2); customers and couriers never reach
 * here (the layout's 404).
 */
export default async function LiveMap({ searchParams }: { searchParams: SearchParams }) {
  const access = await liveMapAccess();
  if (access.kind === 'handledByLayout') return null;
  if (access.kind === 'noAccess') {
    return (
      <AdminPage>
        <StaffGate kind="liveMapNoAccess" />
      </AdminPage>
    );
  }
  const params = await searchParams;
  const courier = firstParam(params.courier);
  const tab = firstParam(params.tab);
  const snapshot = await getOpsMap(access.actor);
  const selected =
    courier && UUID.test(courier) && snapshot.couriers.some((item) => item.partnerId === courier)
      ? ({ kind: 'courier', id: courier } as const)
      : null;
  return (
    <LiveMapPage
      initial={snapshot}
      timeZone={STORE_TIME_ZONE}
      initialSelection={selected}
      initialTab={tab === 'deliveries' ? 'deliveries' : tab === 'couriers' ? 'couriers' : null}
    />
  );
}
