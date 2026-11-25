import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLayoutEffect } from 'react';
import { opsMapAction } from '@/server/modules/tracking/actions';
import type { OpsMapSnapshot } from '@/server/modules/tracking/schema';
import { applyPosition, type OpsMapData, type PositionEvent } from '@/lib/live-map/model';

export type { OpsMapData, PositionEvent };
import { type ActionFailure, callAction } from '@/lib/action-result';
import { midpoint } from '@/lib/board/clock';

/*
 * The live map's data (F8 L3.3, A46.3): the server's snapshot in the first HTML, then
 * `courier.position` on the pool's map channel moving one courier at a time, and a fresh
 * snapshot on `delivery.changed`, on reconnect and every 30 s. Positions never come from
 * anywhere but the server.
 */

export const OPS_MAP_KEY = ['tracking', 'ops-map'] as const;
const REFRESH_MS = 30_000;

export class OpsMapReadError extends Error {
  constructor(readonly failure: ActionFailure) {
    super(failure.message);
    this.name = 'OpsMapReadError';
  }
}

async function readOpsMap(): Promise<OpsMapData> {
  const sentAt = Date.now();
  const outcome = await callAction(() => opsMapAction());
  if (!outcome.ok) throw new OpsMapReadError(outcome.error);
  return { ...outcome.data, receivedAt: midpoint(sentAt, Date.now()) };
}

export function useOpsMap(initial: OpsMapSnapshot) {
  const queryClient = useQueryClient();
  useLayoutEffect(() => {
    const held = queryClient.getQueryData<OpsMapData>(OPS_MAP_KEY);
    if (held && Date.parse(held.asOf) >= Date.parse(initial.asOf)) return;
    queryClient.setQueryData<OpsMapData>(OPS_MAP_KEY, { ...initial, receivedAt: Date.now() });
  }, [queryClient, initial]);
  return useQuery({
    queryKey: OPS_MAP_KEY,
    queryFn: readOpsMap,
    initialData: () => ({ ...initial, receivedAt: Date.now() }),
    staleTime: REFRESH_MS,
    refetchInterval: REFRESH_MS,
    refetchOnWindowFocus: true,
    retry: false,
  });
}

export function useOpsMapWriter() {
  const queryClient = useQueryClient();
  return {
    position(event: PositionEvent): boolean {
      const held = queryClient.getQueryData<OpsMapData>(OPS_MAP_KEY);
      if (!held) return false;
      const next = applyPosition(held, event);
      if (!next) return false;
      queryClient.setQueryData(OPS_MAP_KEY, next);
      return true;
    },
    refresh: () => queryClient.refetchQueries({ queryKey: OPS_MAP_KEY }),
  };
}
