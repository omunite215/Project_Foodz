import { queryCollectionOptions } from '@tanstack/query-db-collection';
import { collectionOptions, type DbClient, useDbClient, useLiveQuery } from '@tanstack/react-db';
import { type QueryClient, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLayoutEffect, useMemo } from 'react';
import { boardCardsAction, boardSnapshotAction } from '@/server/modules/board/actions';
import {
  BOARD_REFRESH_MS,
  type BoardCard,
  type BoardGone,
  type BoardSnapshot,
} from '@/server/modules/board/schema';
import { type ActionFailure, callAction } from '@/lib/action-result';
import {
  applyEvent,
  type BoardDiff,
  diffCards,
  eventVerdict,
  mergeCards,
  onBoardFor,
} from '@/lib/board/model';
import type { OrderChangedEvent } from '@/lib/realtime/events';
import { useHydrated } from '@/lib/use-hydrated';
import { midpoint } from '@/lib/board/clock';

/*
 * The order board's data (F5 design 2, 2.12): a TanStack DB collection of cards fed by
 * `boardSnapshotAction` (the 60-second refresh, the 10-second polling without realtime, the
 * refresh on returning to the tab) and written directly from `order.board-changed` events,
 * with `boardCardsAction` only for orders the board doesn't know yet, orders that left it and
 * money changes. The snapshot's other parts (clock, store, thresholds, sold out, abilities)
 * live next to it in the Query cache.
 *
 * The first HTML comes from the server's snapshot (A2.8); the collection takes over after
 * hydration, seeded from the same snapshot, so nothing is fetched twice.
 *
 * Components use the hooks here, never TanStack DB directly (architecture rule).
 */

export const BOARD_CARDS_KEY = ['board', 'cards'] as const;
export const BOARD_META_KEY = ['board', 'meta'] as const;

export type BoardMeta = Omit<BoardSnapshot, 'cards'> & {
  /** The device's clock when the snapshot arrived, for the server clock offset (B14). */
  receivedAt: number;
};

/** A read the board couldn't make: the code tells signed out from a network hiccup. */
export class BoardReadError extends Error {
  constructor(readonly failure: ActionFailure) {
    super(failure.message);
    this.name = 'BoardReadError';
  }
}

// ------------------------------------------------------------------ refresh cadence and errors

/** Read by the collection's query on every schedule: 60 s live, 10 s without realtime. */
let refreshEvery: number | false = BOARD_REFRESH_MS;

type FailureListener = (failure: ActionFailure) => void;
const failureListeners = new Set<FailureListener>();
const reportFailure = (failure: ActionFailure) => {
  for (const listener of failureListeners) listener(failure);
};

/** Hears every failed board read (UNAUTHENTICATED turns into the signed-out state). */
export function onBoardReadFailure(listener: FailureListener): () => void {
  failureListeners.add(listener);
  return () => {
    failureListeners.delete(listener);
  };
}

function metaOf(snapshot: BoardSnapshot, receivedAt: number): BoardMeta {
  const { cards: _cards, ...meta } = snapshot;
  return { ...meta, receivedAt };
}

async function readSnapshot(queryClient: QueryClient): Promise<BoardCard[]> {
  const sentAt = Date.now();
  const outcome = await callAction(() => boardSnapshotAction({}));
  if (!outcome.ok) {
    reportFailure(outcome.error);
    throw new BoardReadError(outcome.error);
  }
  queryClient.setQueryData(BOARD_META_KEY, metaOf(outcome.data, midpoint(sentAt, Date.now())));
  // An event that arrived while this copy was on its way may hold a newer version (A12.5).
  const held = queryClient.getQueryData<BoardCard[]>(BOARD_CARDS_KEY) ?? [];
  return mergeCards(held, outcome.data.cards);
}

export const boardCardsCollection = collectionOptions('boardCards', (client) => {
  const queryClient = client.requireDependency<QueryClient>('queryClient');
  return queryCollectionOptions({
    id: 'boardCards',
    queryKey: BOARD_CARDS_KEY,
    queryFn: (): Promise<BoardCard[]> => readSnapshot(queryClient),
    queryClient,
    getKey: (card: BoardCard) => card.id,
    staleTime: BOARD_REFRESH_MS,
    refetchInterval: () => refreshEvery,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    // A refused read keeps the cards on screen; the connection banner says what happened.
    retry: false,
  });
});

/** Puts the server's snapshot in the cache unless a newer copy is already there. */
function seedBoard(queryClient: QueryClient, snapshot: BoardSnapshot) {
  const meta = queryClient.getQueryData<BoardMeta>(BOARD_META_KEY);
  if (meta && Date.parse(meta.asOf) > Date.parse(snapshot.asOf)) return;
  const held = queryClient.getQueryData<BoardCard[]>(BOARD_CARDS_KEY);
  queryClient.setQueryData(
    BOARD_CARDS_KEY,
    held ? mergeCards(held, snapshot.cards) : snapshot.cards,
  );
  queryClient.setQueryData(BOARD_META_KEY, metaOf(snapshot, Date.now()));
}

// ------------------------------------------------------------------ reading

export interface BoardData {
  cards: BoardCard[];
  meta: BoardMeta;
  /** The live collection has taken over from the server's HTML. */
  live: boolean;
}

/**
 * The board's cards and meta. In the server's HTML and while the page hydrates they are the
 * server's snapshot; then the live collection, seeded with the same snapshot.
 */
export function useBoard(initial: BoardSnapshot): BoardData {
  const queryClient = useQueryClient();
  const hydrated = useHydrated();

  // Before the live query is enabled (the render after hydration), so it starts from the cache.
  useLayoutEffect(() => {
    seedBoard(queryClient, initial);
  }, [queryClient, initial]);

  const { data, isReady } = useLiveQuery({
    query: (q) => (hydrated ? q.from({ card: boardCardsCollection }) : undefined),
  });
  const { data: meta } = useQuery({
    queryKey: BOARD_META_KEY,
    queryFn: () =>
      queryClient.getQueryData<BoardMeta>(BOARD_META_KEY) ?? metaOf(initial, Date.now()),
    initialData: () => metaOf(initial, Date.now()),
    staleTime: Infinity,
    enabled: false,
  });

  const live = hydrated && isReady && Array.isArray(data);
  return { cards: live ? data : initial.cards, meta, live };
}

// ------------------------------------------------------------------ writing

export interface CardsFetch {
  cards: BoardCard[];
  gone: BoardGone[];
  /** Cards the board didn't hold before: new orders (A3.1). */
  added: BoardCard[];
}

/**
 * Versions the person's own changes reached, per order, before the confirmed card lands: the
 * realtime echo of that change must not overwrite it (it would drop the Undo row).
 */
const confirmedVersions = new WeakMap<DbClient, Map<string, number>>();

function writer(client: DbClient, queryClient: QueryClient) {
  const collection = () => client.collection(boardCardsCollection);
  let ownVersions = confirmedVersions.get(client);
  if (!ownVersions) {
    ownVersions = new Map();
    confirmedVersions.set(client, ownVersions);
  }
  const own = ownVersions;
  const echoOfOwn = (event: OrderChangedEvent) => event.version <= (own.get(event.orderId) ?? -1);
  const metaNow = () => queryClient.getQueryData<BoardMeta>(BOARD_META_KEY);

  return {
    /** The card as the board holds it now (optimistic changes included). */
    card(id: string): BoardCard | undefined {
      return collection().get(id);
    },

    /** Every card the board holds now. */
    cards(): BoardCard[] {
      return [...collection().values()];
    },

    /** What an event means for the card held (A12.5). */
    verdict(event: OrderChangedEvent) {
      if (echoOfOwn(event)) return 'ignore';
      const view = metaNow()?.view ?? 'kitchen';
      return eventVerdict(collection().get(event.orderId), event, view);
    },

    /** A status change taken from the event itself. */
    apply(event: OrderChangedEvent): BoardCard | null {
      const held = collection().get(event.orderId);
      if (!held || echoOfOwn(event)) return null;
      const next = applyEvent(held, event);
      void collection().utils.writeUpdate(next);
      return next;
    },

    /**
     * Fetches named cards (new orders, orders that left, money changes) through the authorized
     * data layer; names never travel over the WebSocket (A12.7).
     */
    async fetch(ids: string[]): Promise<CardsFetch> {
      const unique = [...new Set(ids)].slice(0, 50);
      if (unique.length === 0) return { cards: [], gone: [], added: [] };
      const outcome = await callAction(() => boardCardsAction({ orderIds: unique }));
      if (!outcome.ok) {
        reportFailure(outcome.error);
        throw new BoardReadError(outcome.error);
      }
      const view = metaNow()?.view ?? 'kitchen';
      const target = collection();
      const held = new Map([...target.values()].map((card) => [card.id, card]));
      const cards = outcome.data.cards.filter((card) => onBoardFor(view, card.status));
      const fresh = cards.filter((card) => (held.get(card.id)?.version ?? -1) < card.version);
      const added = cards.filter((card) => !held.has(card.id));
      const goneIds = outcome.data.gone.map((gone) => gone.id).filter((id) => held.has(id));
      if (fresh.length || goneIds.length) {
        void target.utils.writeBatch(() => {
          if (fresh.length) void target.utils.writeUpsert(fresh);
          if (goneIds.length) void target.utils.writeDelete(goneIds);
        });
      }
      return { cards, gone: outcome.data.gone, added };
    },

    /**
     * F7 (A34.4): a delivery changed. Its order's version didn't move, so the cards are read
     * again and their courier lines replace the held ones; newer cards replace older ones.
     * Returns the cards as they were before, for the board's notices.
     */
    async refreshCouriers(ids: string[]): Promise<{ before: BoardCard[]; after: BoardCard[] }> {
      const unique = [...new Set(ids)].slice(0, 50);
      if (unique.length === 0) return { before: [], after: [] };
      const outcome = await callAction(() => boardCardsAction({ orderIds: unique }));
      if (!outcome.ok) {
        reportFailure(outcome.error);
        throw new BoardReadError(outcome.error);
      }
      const target = collection();
      const before: BoardCard[] = [];
      const after: BoardCard[] = [];
      for (const fresh of outcome.data.cards) {
        const held = target.get(fresh.id);
        if (!held) continue;
        before.push(held);
        const next =
          fresh.version >= held.version
            ? fresh
            : Object.assign(structuredClone(held), { courier: fresh.courier ?? null });
        after.push(next);
      }
      if (after.length) void target.utils.writeUpsert(after);
      return { before, after };
    },

    /** A fresh copy now (reconnects, polling, Find), with what it changed (A12.3). */
    async refresh(): Promise<BoardDiff> {
      const target = collection();
      const before = [...target.values()];
      await target.utils.refetch({ throwOnError: true });
      return diffCards(before, [...target.values()]);
    },

    /** How often the board refreshes itself (60 s live, 10 s without realtime, A12.6). */
    setRefreshEvery(ms: number | false) {
      if (refreshEvery === ms) return;
      refreshEvery = ms;
      // The next schedule picks the new interval up; refetching now applies it at once.
      if (ms !== false) void collection().utils.refetch();
    },

    /** A confirmed change from the person's own action, written straight to the board. */
    put(card: BoardCard) {
      own.set(card.id, card.version);
      void collection().utils.writeUpsert(card);
    },

    remove(ids: string[]) {
      const target = collection();
      const held = ids.filter((id) => target.has(id));
      if (held.length) void target.utils.writeDelete(held);
    },

    /**
     * An optimistic change (design 2.8, D16): the card shows `optimistic` at once; `persist`
     * talks to the server and returns the confirmed card (or null to drop it). A failure puts
     * the card back where it was and is rethrown for the caller to explain.
     */
    async optimistic(
      id: string,
      optimistic: (draft: BoardCard) => void,
      persist: () => Promise<BoardCard | null>,
    ): Promise<void> {
      const target = collection();
      const transaction = client.createTransaction({
        mutationFn: async () => {
          const confirmed = await persist();
          // Not awaited: the write applies as this transaction settles, so the card never
          // flashes back between the optimistic and the confirmed state.
          if (confirmed) {
            own.set(id, confirmed.version);
            void target.utils.writeUpsert(confirmed);
          } else void target.utils.writeDelete(id);
        },
      });
      transaction.mutate(() => {
        target.update(id, optimistic);
      });
      await transaction.when('settled');
    },

    /** Sold-out flags on every card line for a dish (design 4.4). */
    markDish(dishId: string, soldOut: boolean) {
      const target = collection();
      const changed: BoardCard[] = [];
      for (const card of target.values()) {
        if (!card.lines.some((line) => line.dishId === dishId && line.soldOut !== soldOut))
          continue;
        const lines = card.lines.map((line) =>
          line.dishId === dishId ? Object.assign(structuredClone(line), { soldOut }) : line,
        );
        changed.push(Object.assign(structuredClone(card), { lines }));
      }
      if (changed.length) void target.utils.writeUpsert(changed);
    },

    meta: metaNow,

    /** Updates the snapshot's other parts (sold-out list after "86 it"). */
    updateMeta(change: (meta: BoardMeta) => BoardMeta) {
      const meta = metaNow();
      if (meta) queryClient.setQueryData(BOARD_META_KEY, change(meta));
    },
  };
}

export type BoardWriter = ReturnType<typeof writer>;

/** Writes to the board: events, fetched cards, optimistic moves and refreshes. */
export function useBoardWriter(): BoardWriter {
  const client = useDbClient();
  const queryClient = useQueryClient();
  return useMemo(() => writer(client, queryClient), [client, queryClient]);
}

/**
 * One card as the board holds it, without starting the board's sync (the detail panel reads
 * what the card already knows while the rest loads, design 5.1).
 */
export function useBoardCard(id: string): BoardCard | null {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: BOARD_CARDS_KEY,
    queryFn: () => queryClient.getQueryData<BoardCard[]>(BOARD_CARDS_KEY) ?? [],
    enabled: false,
    staleTime: Infinity,
    select: (cards: BoardCard[]) => cards.find((card) => card.id === id) ?? null,
  });
  return data ?? null;
}
