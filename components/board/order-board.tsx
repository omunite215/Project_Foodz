'use client';

import { Batcher, Throttler } from '@tanstack/react-pacer';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { findOrderAction } from '@/server/modules/board/actions';
import { restartSearchAction } from '@/server/modules/delivery/actions';
import { askToWaitAction } from '@/server/modules/tracking/actions';
import {
  type BoardCard,
  type BoardColumn as Column,
  type BoardSnapshot,
  CHIME_REPEAT_AFTER_MINUTES,
  COLUMN_OF,
  WAITING_BANNER_MINUTES,
} from '@/server/modules/board/schema';
import type { CardMenuItem } from '@/server/modules/board/state';
import { AdminPage, useSessionPhase } from '@/components/admin/admin-page';
import { showBoardNotice } from '@/components/admin/board-notices';
import { SignedOutOverlay } from '@/components/admin/signed-out-overlay';
import { useStaffShell } from '@/components/admin/staff-shell-context';
import { LiveChip, StoreChip } from '@/components/admin/status-chips';
import { callAction } from '@/lib/action-result';
import { announce } from '@/lib/announce';
import { serverNow, serverOffset, TIMER_TICK_MS } from '@/lib/board/clock';
import { connectionBanner, liveChipState } from '@/lib/board/connection';
import {
  type CourierMenuItem,
  courierLinesToRead,
  courierMenuFor,
  courierReadKey,
  didNotTakeNotice,
  HELD,
  LOOKING_AGAIN,
  nobodyOnline,
  noCourierOrders,
} from '@/lib/board/courier-text';
import {
  columnFromHash,
  diffCount,
  filtersQuery,
  groupByColumn,
  hasFilters,
  lateNow,
  isStepBack,
  matchesFilters,
  neighbourAfterLeaving,
  parseFilters,
  waitedMinutes,
  waitingOver,
} from '@/lib/board/model';
import {
  isCollapsed,
  readCollapsed,
  toggleCollapsed,
  writeCollapsed,
} from '@/lib/board/preferences';
import { CHIME_REPEAT_MS } from '@/lib/board/sound';
import {
  askedToWaitLine,
  askedToWaitNotice,
  type StuckAction,
  stuckActionsFor,
} from '@/lib/board/tracking-text';
import {
  COLUMN_HASHES,
  type ColumnCount,
  goneAnnouncement,
  goneNotice,
  movedAnnouncement,
  movedBackAnnouncement,
  newOrdersAnnouncement,
  titleWithUnseen,
  waitingBannerText,
} from '@/lib/board/text';
import { addUnseen, clearUnseen, useUnseen } from '@/lib/board/unseen';
import { onBoardReadFailure, useBoard, useBoardWriter } from '@/lib/data/board';
import { useChannelEvent } from '@/lib/realtime/client';
import { isSitePath } from '@/lib/navigation';
import { useMediaQuery } from '@/lib/use-media-query';
import { cn } from '@/lib/utils';
import {
  BackOnlineBanner,
  ConnectionBannerRow,
  HiddenByFiltersBanner,
  WaitingBanner,
} from './board-banners';
import { BoardColumn, columnHeadingId } from './board-column';
import { NobodyOnlineBanner, NoCourierBanner, useNoCourierChime } from './courier-banners';
import { StuckBanners, useStuckChime } from './stuck-banners';
import { CouriersChip } from './courier-parts';
import { BoardEmpty } from './board-empty';
import {
  BoardFiltersBar,
  BoardToolbar,
  FindOrder,
  type FindOutcome,
  SoldOutButton,
} from './board-toolbar';
import { BoardDialogs, type DialogKind, type DialogState } from './dialogs/board-dialogs';
import { type CardHighlight, OrderCard, orderHeadingId, orderHref } from './order-card';
import { SoundButton, useSound, useWakeLock, WakeLockSwitch } from './sound-controls';
import { SoldOutSheet, SoldOutStrip } from './sold-out';
import { StatusTabs } from './status-tabs';
import { useBoardConnection } from './use-board-connection';
import { useBoardFlip } from './use-board-flip';
import { useCardMoves } from './use-card-moves';

/*
 * The order board (F5 design 2): every live order in columns, kept current by realtime events
 * on `private-ops`, with one-tap moves, Undo, dialogs, "86 it", find and filters. The server
 * renders the first copy (A2.8); after hydration the TanStack DB collection takes over.
 */

const BASE_TITLE = 'Order board | Foodz Admin';
const BACK_ONLINE_MS = 8_000;
const WAKE_LOCK_REFUSED = "This device didn't allow keeping the screen on.";

type Highlights = Record<string, CardHighlight>;

/** Focus a card's heading link, or a column's heading when the card is gone (A16.4). */
function focusCardOrColumn(cardId: string | null, column: Column) {
  requestAnimationFrame(() => {
    const link = cardId
      ? document.querySelector<HTMLElement>(`#${CSS.escape(orderHeadingId(cardId))} a`)
      : null;
    (link ?? document.getElementById(columnHeadingId(column)))?.focus();
  });
}

function scrollToCard(cardId: string) {
  document
    .querySelector(`[data-card-id="${CSS.escape(cardId)}"]`)
    ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

export function OrderBoard({ initial }: { initial: BoardSnapshot }) {
  const shell = useStaffShell();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const writer = useBoardWriter();
  const { cards, meta } = useBoard(initial);
  const timeZone = meta.store.timeZone;
  const offset = useMemo(
    () => serverOffset(meta.asOf, meta.receivedAt),
    [meta.asOf, meta.receivedAt],
  );
  const boardRef = useRef<HTMLDivElement>(null);

  // ---------------------------------------------------------------- the server's clock (B14)
  const [now, setNow] = useState(() => new Date(initial.asOf));
  useEffect(() => {
    const tick = () => setNow(serverNow(offset));
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, TIMER_TICK_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [offset]);
  const serverIso = useCallback(() => serverNow(offset).toISOString(), [offset]);
  // F7 (A34.3): the courier line's seconds refresh every 5 s while an offer is open.
  const anyOpenOffer = cards.some(
    (card) => card.courier?.state === 'offered' || card.courier?.state === 'staffOffered',
  );
  const [courierNow, setCourierNow] = useState(() => new Date(initial.asOf));
  useEffect(() => {
    if (!anyOpenOffer) return undefined;
    const tick = () => setCourierNow(serverNow(offset));
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 5_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [offset, anyOpenOffer]);

  // ---------------------------------------------------------------- signed out (A1.7, A12.9)
  const [signedOutByServer, setSignedOutByServer] = useState(false);
  const sessionEnded = useSessionPhase(shell.sessionExpiresAt) === 'ended';
  const signedOut = signedOutByServer || sessionEnded;
  useEffect(
    () =>
      onBoardReadFailure((failure) => {
        if (failure.code === 'UNAUTHENTICATED') setSignedOutByServer(true);
      }),
    [],
  );
  useEffect(() => {
    if (signedOut) announce("You've been signed out. Sign in again to keep the board live.");
  }, [signedOut]);

  // ---------------------------------------------------------------- filters (A11.2)
  const filters = parseFilters(searchParams);
  // Two taps can land before the address changes: each builds on the last one asked for, so
  // "Late only" then "Cash" keeps both (A11.2). A request the address never reached is
  // forgotten after 2 s (Back, or a refused navigation).
  const shownFilters = useRef(filters);
  useEffect(() => {
    shownFilters.current = filters;
  });
  const askedFilters = useRef<{ filters: typeof filters; at: number } | null>(null);
  const filtersKey = filtersQuery(filters);
  useEffect(() => {
    const asked = askedFilters.current;
    if (asked && filtersQuery(asked.filters) === filtersKey) askedFilters.current = null;
  }, [filtersKey]);
  const setFilters = useCallback(
    (next: typeof filters | ((current: typeof filters) => typeof filters)) => {
      const asked = askedFilters.current;
      const base = asked && Date.now() - asked.at < 2_000 ? asked.filters : shownFilters.current;
      const value = typeof next === 'function' ? next(base) : next;
      askedFilters.current = { filters: value, at: Date.now() };
      const query = filtersQuery(value);
      const href = `${pathname}${query ? `?${query}` : ''}${window.location.hash}`;
      router.replace(isSitePath(href) ? href : '/admin/orders', { scroll: false });
    },
    [pathname, router],
  );

  // ---------------------------------------------------------------- columns and phone tabs
  const isPhone = useMediaQuery('(max-width: 47.98rem)');
  const [selectedTab, setSelectedTab] = useState<Column>('new');
  useEffect(() => {
    const fromHash = columnFromHash(window.location.hash, meta.columns, COLUMN_HASHES);
    if (!fromHash) return undefined;
    const timer = setTimeout(() => setSelectedTab(fromHash), 0);
    return () => clearTimeout(timer);
  }, [meta.columns]);
  const selectTab = useCallback((column: Column) => {
    setSelectedTab(column);
    window.history.replaceState(window.history.state, '', `#${COLUMN_HASHES[column]}`);
  }, []);

  const [collapsedPrefs, setCollapsedPrefs] = useState<ReturnType<typeof readCollapsed>>(null);
  const [narrow, setNarrow] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setCollapsedPrefs(readCollapsed()), 0);
    const board = boardRef.current;
    const observer = new ResizeObserver(([entry]) => {
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      if (entry) setNarrow(entry.contentRect.width / rem < 76.5);
    });
    if (board) observer.observe(board);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, []);
  const collapsed = (column: Column) =>
    !isPhone && isCollapsed(column, collapsedPrefs, narrow && meta.view === 'full');
  const toggleColumn = (column: Column) => {
    const next = toggleCollapsed(column, collapsedPrefs, narrow && meta.view === 'full');
    setCollapsedPrefs(next);
    writeCollapsed(next);
    requestAnimationFrame(() => {
      const target = isCollapsed(column, next, narrow)
        ? document.querySelector<HTMLElement>(`#column-${column} button[aria-expanded]`)
        : document.querySelector<HTMLElement>(`#column-${column} header button[aria-expanded]`);
      target?.focus();
    });
  };

  const grouped = useMemo(() => groupByColumn(cards, meta.columns), [cards, meta.columns]);
  const lateIds = useMemo(
    () =>
      new Set(cards.filter((card) => lateNow(card, now, meta.thresholds)).map((card) => card.id)),
    [cards, now, meta.thresholds],
  );
  const filtered = hasFilters(filters);
  const shown = (card: BoardCard) => matchesFilters(card, filters, lateIds.has(card.id));
  const countOf = (column: Column): ColumnCount => {
    const all = meta.columns.includes(column) ? grouped[column] : [];
    const visible = all.filter(shown);
    return {
      shown: visible.length,
      total: all.length,
      late: visible.filter((card) => lateIds.has(card.id)).length,
      filtered,
    };
  };
  const counts: Record<Column, ColumnCount> = {
    new: countOf('new'),
    accepted: countOf('accepted'),
    preparing: countOf('preparing'),
    ready: countOf('ready'),
    outForDelivery: countOf('outForDelivery'),
  };

  // ---------------------------------------------------------------- sound and wake lock
  const sound = useSound();
  const wakeLockRefused = useCallback(() => showBoardNotice(WAKE_LOCK_REFUSED), []);
  const wakeLock = useWakeLock(shell.user.role === 'kitchen', wakeLockRefused);

  // ---------------------------------------------------------------- highlights and arrivals
  const [highlights, setHighlights] = useState<Highlights>({});
  const highlightKey = useRef(1);
  const highlight = useCallback((ids: string[], kind: CardHighlight['kind']) => {
    if (ids.length === 0) return;
    setHighlights((current) => {
      const next = { ...current };
      for (const id of ids) next[id] = { key: highlightKey.current++, kind };
      return next;
    });
  }, []);
  // Reduced motion: nothing travels, so a card that changed column gets the 2 s outline (D20).
  const outlineMoved = useCallback((ids: string[]) => highlight(ids, 'flash'), [highlight]);
  const capture = useBoardFlip(boardRef, outlineMoved);
  const [newIds, setNewIds] = useState<string[]>([]);
  const [hiddenNew, setHiddenNew] = useState<string[]>([]);
  const unseen = useUnseen();

  const arrive = useCallback(
    (added: BoardCard[]) => {
      if (added.length === 0) return;
      highlight(
        added.map((card) => card.id),
        'arrival',
      );
      setNewIds((current) => [...current, ...added.map((card) => card.id)]);
      announce(newOrdersAnnouncement(added));
      sound.chime();
      if (document.visibilityState === 'hidden') addUnseen(added.length);
      const hidden = added.filter(
        (card) => !matchesFilters(card, filters, lateNow(card, serverNow(offset), meta.thresholds)),
      );
      if (hidden.length) setHiddenNew((current) => [...current, ...hidden.map((card) => card.id)]);
    },
    [filters, highlight, meta.thresholds, offset, sound],
  );

  // A3.1: "(1) Order board | Foodz Admin" until the tab is seen again. Anything that writes the
  // page's title meanwhile (a refresh of the page's metadata) gets the count put back.
  useEffect(() => {
    const apply = () => {
      const wanted = titleWithUnseen(document.title || BASE_TITLE, unseen);
      if (document.title !== wanted) document.title = wanted;
    };
    apply();
    if (unseen === 0) return undefined;
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [unseen]);
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') clearUnseen();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  // A3.3: while any order has waited over 2 minutes in New, the chime repeats every 60 s.
  const waitingLong = cards.some(
    (card) => card.status === 'PLACED' && waitedMinutes(card, now) >= CHIME_REPEAT_AFTER_MINUTES,
  );
  // The timer depends only on whether it should run: the board draws again every few seconds,
  // and restarting it each time meant it never reached 60 s.
  const repeatChime = sound.chime;
  const soundOn = sound.state === 'on';
  useEffect(() => {
    if (!waitingLong || !soundOn) return undefined;
    const timer = setInterval(repeatChime, CHIME_REPEAT_MS);
    return () => clearInterval(timer);
  }, [waitingLong, soundOn, repeatChime]);

  // ---------------------------------------------------------------- cards that left (A3.7)
  const focusAfterLeaving = useCallback(
    (card: BoardCard) => {
      const article = document.querySelector(`[data-card-id="${CSS.escape(card.id)}"]`);
      if (!article?.contains(document.activeElement)) return;
      const column = COLUMN_OF[card.status];
      const ids = grouped[column].map((item) => item.id);
      focusCardOrColumn(neighbourAfterLeaving(ids, card.id), column);
    },
    [grouped],
  );

  // ---------------------------------------------------------------- moves (design 2.8)
  const onSignedOut = useCallback(() => setSignedOutByServer(true), []);
  const onLeft = useCallback(
    (card: BoardCard, text: string) => {
      focusAfterLeaving(card);
      showBoardNotice(text);
    },
    [focusAfterLeaving],
  );
  const moves = useCardMoves({
    writer,
    serverNow: serverIso,
    timeZone,
    capture,
    onSignedOut,
    onLeft,
  });

  // ---------------------------------------------------------------- realtime (A12)
  const [lastUpdate, setLastUpdate] = useState<string | null>(initial.asOf);
  const [backOnline, setBackOnline] = useState<{ changed: number; key: number } | null>(null);

  const fetchNamed = useCallback(
    async (ids: string[]) => {
      try {
        const before = writer.cards();
        const result = await writer.fetch(ids);
        setLastUpdate(serverNow(offset).toISOString());
        arrive(result.added);
        for (const gone of result.gone) {
          const held = before.find((card) => card.id === gone.id);
          if (held) focusAfterLeaving(held);
          const notice = goneNotice(gone);
          if (notice) {
            // A staff cancellation is read at once (assertive); others politely.
            showBoardNotice(notice, { assertive: gone.by?.kind === 'staff' });
          } else announce(goneAnnouncement(gone));
        }
      } catch {
        // The 60-second refresh and the connection banner cover a failed fetch.
      }
    },
    [arrive, focusAfterLeaving, offset, writer],
  );

  const batcher = useMemo(
    () =>
      new Batcher<string>((ids) => void fetchNamed(ids), {
        wait: 120,
        maxSize: 50,
      }),
    [fetchNamed],
  );

  const refreshAndReport = useCallback(
    async (report: boolean) => {
      try {
        const diff = await writer.refresh();
        setLastUpdate(serverNow(offset).toISOString());
        const after = writer.cards();
        if (report) {
          // A12.3: changed cards flash, new ones arrive with one chime, cancelled ones leave
          // with a notice.
          highlight(diff.changed, 'flash');
          arrive(after.filter((card) => diff.added.includes(card.id)));
          if (diff.removed.length) void fetchNamed(diff.removed);
          setBackOnline({ changed: diffCount(diff), key: Date.now() });
        }
      } catch {
        // Kept as they were; the banner already says the board may be behind.
      }
    },
    [arrive, fetchNamed, highlight, offset, writer],
  );

  const connection = useBoardConnection({
    configured: meta.realtime.configured,
    signedOut,
    onFirstLive: () => void refreshAndReport(false),
    onReconnected: () => refreshAndReport(true),
  });

  useEffect(() => {
    writer.setRefreshEvery(connection.refreshEvery);
  }, [connection.refreshEvery, writer]);

  useEffect(() => {
    if (!backOnline) return undefined;
    const timer = setTimeout(() => setBackOnline(null), BACK_ONLINE_MS);
    return () => clearTimeout(timer);
  }, [backOnline]);

  useChannelEvent(connection.channel, 'order.board-changed', (event) => {
    setLastUpdate(event.at);
    const verdict = writer.verdict(event);
    if (verdict === 'ignore') return;
    if (verdict === 'fetch') {
      batcher.addItem(event.orderId);
      return;
    }
    const before = writer.card(event.orderId);
    const hadFocus = before
      ? document
          .querySelector(`[data-card-id="${CSS.escape(before.id)}"]`)
          ?.contains(document.activeElement)
      : false;
    capture();
    const next = writer.apply(event);
    if (!before || !next) return;
    // Moves by anyone are announced (A16.5); several within 50 ms are read together.
    if (next.status !== before.status) {
      announce(
        isStepBack(before.status, next.status)
          ? movedBackAnnouncement(next.number, next.status)
          : movedAnnouncement(next.number, next.status),
      );
    }
    // The card still exists: if it held focus, focus follows it to its new column.
    if (hadFocus) focusCardOrColumn(next.id, COLUMN_OF[next.status]);
  });

  useChannelEvent(connection.channel, 'menu.availability-changed', (event) => {
    writer.markDish(event.dishId, !event.available);
    void soldOutSync.current?.();
  });
  const soldOutSync = useRef<(() => Promise<void>) | null>(null);

  // ---------------------------------------------------------------- couriers (F7 A34.4, A35)
  // A delivery change names its order: the card's courier line is read again. The couriers
  // count comes with the board's snapshot, at once and then at most every 5 s.
  const courierChanges = useCallback(
    async (ids: string[]) => {
      try {
        const { before, after } = await writer.refreshCouriers(ids);
        if (meta.view !== 'full') return;
        for (const next of after) {
          const previous = before.find((card) => card.id === next.id)?.courier;
          const current = next.courier;
          // A37.4: a staff offer that ended without an accept.
          if (
            previous?.state === 'staffOffered' &&
            previous.shortName &&
            current &&
            current.state !== 'staffOffered' &&
            !HELD.has(current.state)
          ) {
            showBoardNotice(didNotTakeNotice(previous.shortName, next.number));
          }
        }
      } catch {
        // The 60-second refresh covers a failed read.
      }
    },
    [meta.view, writer],
  );
  const courierBatcher = useMemo(
    () => new Batcher<string>((ids) => void courierChanges(ids), { wait: 250, maxSize: 50 }),
    [courierChanges],
  );
  const countThrottler = useMemo(
    () =>
      // At once on the first change, then at most every 5 s (A35.1): a courier who takes an
      // order stops counting as free on the same refresh (review P5).
      new Throttler(() => void writer.refresh().catch(() => undefined), {
        wait: 5_000,
        leading: true,
        trailing: true,
      }),
    [writer],
  );
  useChannelEvent(connection.channel, 'delivery.changed', (event) => {
    setLastUpdate(event.at);
    if (writer.card(event.orderId)) courierBatcher.addItem(event.orderId);
    countThrottler.maybeExecute();
  });
  // A35.1: a partner went online or offline; the chip reads the count at once, and a burst
  // of changes costs one read a second at most.
  const couriersCountThrottler = useMemo(
    () =>
      new Throttler(() => void writer.refreshCouriersCount().catch(() => undefined), {
        wait: 1_000,
        leading: true,
        trailing: true,
      }),
    [writer],
  );
  useChannelEvent(connection.channel, 'couriers.changed', (event) => {
    setLastUpdate(event.at);
    couriersCountThrottler.maybeExecute();
  });
  // A34.1: a card that just became Ready reads its line at once ("Finding a courier…").
  const courierAsked = useRef(new Set<string>());
  useEffect(() => {
    for (const id of courierLinesToRead(cards, courierAsked.current)) {
      const card = cards.find((item) => item.id === id);
      if (card) courierAsked.current.add(courierReadKey(card));
      courierBatcher.addItem(id);
    }
  }, [cards, courierBatcher]);

  // ---------------------------------------------------------------- find (A11.1)
  const showCard = useCallback(
    (card: BoardCard) => {
      const column = COLUMN_OF[card.status];
      if (filtered && !matchesFilters(card, filters, lateIds.has(card.id))) {
        setFilters({ late: false, pay: null });
      }
      if (collapsed(column)) toggleColumn(column);
      selectTab(column);
      requestAnimationFrame(() => {
        scrollToCard(card.id);
        highlight([card.id], 'flash');
        focusCardOrColumn(card.id, column);
      });
    },
    // `collapsed` and `toggleColumn` read the current preferences.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [filtered, filters, lateIds, highlight, selectTab, setFilters],
  );

  const onFind = useCallback(
    async (number: string): Promise<FindOutcome> => {
      const outcome = await callAction(() => findOrderAction({ query: number }));
      if (!outcome.ok) {
        if (outcome.error.code === 'UNAUTHENTICATED') setSignedOutByServer(true);
        return { kind: 'error', message: outcome.error.message };
      }
      const found = outcome.data;
      if (found.kind === 'none') return { kind: 'none', message: `No order ${found.number}.` };
      const card = writer.card(found.orderId);
      if (found.kind === 'onBoard' && card) {
        showCard(card);
        return { kind: 'shown' };
      }
      router.push(orderHref(found.orderId), { scroll: false });
      return { kind: 'shown' };
    },
    [router, showCard, writer],
  );

  // ---------------------------------------------------------------- dialogs and the menu
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const openDialog = (
    kind: DialogKind,
    card: BoardCard,
    opener: Element | null = document.activeElement,
  ) => {
    setDialog({
      kind,
      cardId: card.id,
      card,
      opener: opener instanceof HTMLElement ? opener : null,
    });
  };

  const onMenu = (card: BoardCard, item: CardMenuItem) => {
    if (item === 'details') {
      router.push(orderHref(card.id), { scroll: false });
      return;
    }
    if (meta.can.readOnly) return;
    // The menu's button is the opener: Escape or Cancel goes back to it (3.1). The menu may
    // still be closing when the dialog opens, so it is found rather than read from focus.
    const trigger = document.querySelector(
      `[data-card-id="${CSS.escape(card.id)}"] [data-card-menu]`,
    );
    setTimeout(() => openDialog(item, card, trigger), 0);
  };

  const focusAfter = useCallback(
    (card: BoardCard, next: BoardCard | null) => {
      if (next) {
        focusCardOrColumn(next.id, COLUMN_OF[next.status]);
        return;
      }
      const column = COLUMN_OF[card.status];
      const ids = grouped[column].map((item) => item.id);
      focusCardOrColumn(neighbourAfterLeaving(ids, card.id), column);
    },
    [grouped],
  );

  // F7 (design 2.6, 2.10): the courier items. "Find a courier" acts at once, no dialog.
  const onCourier = (card: BoardCard, item: CourierMenuItem) => {
    if (meta.can.readOnly) return;
    if (item === 'findCourier') {
      void (async () => {
        const outcome = await callAction(() =>
          restartSearchAction({
            orderId: card.id,
            expectedVersion: card.courier?.deliveryVersion ?? 0,
          }),
        );
        if (outcome.ok) {
          showBoardNotice(LOOKING_AGAIN);
          void courierChanges([card.id]);
          return;
        }
        if (outcome.error.code === 'UNAUTHENTICATED') {
          setSignedOutByServer(true);
          return;
        }
        showBoardNotice(outcome.error.message, { variant: 'error' });
        void courierChanges([card.id]);
      })();
      return;
    }
    const trigger = document.querySelector(
      `[data-card-id="${CSS.escape(card.id)}"] [data-card-menu]`,
    );
    setTimeout(() => openDialog(item, card, trigger), 0);
  };

  // F8 (design 3.10): "Ask to wait" acts at once (nothing is lost); the others open dialogs.
  const [asking, setAsking] = useState<string | null>(null);
  const onStuck = (card: BoardCard, item: StuckAction) => {
    if (meta.can.readOnly) return;
    if (item !== 'askToWait') {
      const trigger = document.querySelector(
        `[data-card-id="${CSS.escape(card.id)}"] [data-card-menu]`,
      );
      setTimeout(() => openDialog(item, card, trigger), 0);
      return;
    }
    if (asking) return;
    setAsking(card.id);
    void (async () => {
      const outcome = await callAction(() =>
        askToWaitAction({
          orderId: card.id,
          expectedVersion: card.courier?.deliveryVersion ?? 0,
        }),
      );
      setAsking(null);
      if (outcome.ok) {
        showBoardNotice(
          askedToWaitNotice(
            card.courier?.shortName ?? 'the courier',
            card.masked.firstName ? null : card.firstName,
          ),
        );
        writer.setDelivery(
          card.id,
          askedToWaitLine(card.courier?.shortName ?? 'The courier', card.firstName),
        );
        void courierChanges([card.id]);
        void writer.refresh().catch(() => undefined);
        return;
      }
      if (outcome.error.code === 'UNAUTHENTICATED') {
        setSignedOutByServer(true);
        return;
      }
      showBoardNotice(outcome.error.message, { variant: 'error' });
    })();
  };

  const onPrimary = (card: BoardCard) => {
    if (card.status === 'READY' && meta.can.handOver) {
      openDialog('pickUp', card);
      return;
    }
    if (card.status === 'PICKED_UP' && meta.can.handOver) {
      openDialog('deliver', card);
      return;
    }
    const column = COLUMN_OF[card.status];
    const ids = grouped[column].filter(shown).map((item) => item.id);
    const nextFocus = neighbourAfterLeaving(ids, card.id);
    const to =
      card.status === 'PLACED' ? 'ACCEPTED' : card.status === 'ACCEPTED' ? 'PREPARING' : 'READY';
    // A16.4: focus to the next card in the same column, or its heading when it is empty.
    focusCardOrColumn(nextFocus, column);
    void moves.move(card, to);
  };

  const onUndo = async (card: BoardCard) => {
    await moves.undo(card);
    // Focus stays on the card, now in its old column (design 2.8).
    const current = writer.card(card.id);
    if (current) focusCardOrColumn(current.id, COLUMN_OF[current.status]);
  };

  // ---------------------------------------------------------------- "86 it" (design 4)
  const [sheetOpen, setSheetOpen] = useState(false);
  const canSeeSheet = meta.can.setAvailability;

  // ---------------------------------------------------------------- banners
  const waiting = waitingOver(cards, now, WAITING_BANNER_MINUTES);
  const waitingText = waitingBannerText(
    waiting.map((card) => ({ number: card.number, minutes: waitedMinutes(card, now) })),
    WAITING_BANNER_MINUTES,
  );
  const hiddenStill = hiddenNew.filter((id) => {
    const card = cards.find((item) => item.id === id);
    return card && !shown(card);
  });
  const filterKey = filtersQuery(filters);
  useEffect(() => {
    const timer = setTimeout(() => setHiddenNew([]), 0);
    return () => clearTimeout(timer);
  }, [filterKey]);

  // F7 (A39): orders with no courier after 5 minutes, and nobody online at all.
  const noCourier = noCourierOrders(cards);
  const nobody = nobodyOnline(cards);
  useNoCourierChime(
    [...noCourier.map((card) => card.id), ...(nobody ? ['nobody'] : [])],
    sound.state === 'on',
  );
  const couriers = meta.couriers ?? null;
  // F8 (A49): stuck deliveries, with F7's chime once per new case.
  const attention = meta.attention ?? [];
  useStuckChime(attention, sound.state === 'on');
  // A48.1: distances and times on Out-for-delivery lines at least every 30 s.
  const outForDelivery = cards.some((card) => card.status === 'PICKED_UP');
  useEffect(() => {
    if (!outForDelivery || meta.view !== 'full') return undefined;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void writer.refresh().catch(() => undefined);
    }, 30_000);
    return () => clearInterval(timer);
  }, [outForDelivery, meta.view, writer]);

  // A48.1 (QA): a line that turns by time alone ("no location for 2 min") is read again when it
  // does, in step with the customer's page, not at the next 30 s refresh.
  const nextLineChange = useMemo(() => {
    const times = cards.flatMap((card) =>
      card.status === 'PICKED_UP' && card.delivery?.changesAt
        ? [Date.parse(card.delivery.changesAt)]
        : [],
    );
    return times.length ? Math.min(...times) : null;
  }, [cards]);
  useEffect(() => {
    if (nextLineChange === null || meta.view !== 'full') return undefined;
    const wait = Math.max(2_000, nextLineChange - serverNow(offset).getTime() + 500);
    const timer = setTimeout(() => void writer.refresh().catch(() => undefined), wait);
    return () => clearTimeout(timer);
  }, [nextLineChange, meta.view, offset, writer]);

  const banner = connectionBanner(connection.kind);
  const offline = connection.kind === 'offline';
  const blocked = meta.can.readOnly ? 'demo' : offline ? 'offline' : null;
  const totalCards = cards.length;
  const shownCards = cards.filter(shown).length;
  const empty = totalCards === 0 ? 'board' : shownCards === 0 ? 'filtered' : null;

  const columnClass =
    'md:w-[calc((100%-0.75rem)/2)] md:shrink-0 md:snap-start lg:w-auto lg:h-full lg:min-h-0';
  const boardCols = meta.columns
    .map((column) => (collapsed(column) ? '3.5rem' : 'minmax(12.5rem,1fr)'))
    .join(' ');

  return (
    <AdminPage
      title="Order board"
      className="lg:h-dvh lg:min-h-0 lg:overflow-hidden"
      mainClassName="lg:min-h-0"
      status={
        <>
          <StoreChip store={meta.store} className="max-md:hidden" />
          {couriers ? <CouriersChip count={couriers} className="max-xl:hidden" /> : null}
          <LiveChip state={liveChipState(connection.kind)} />
        </>
      }
      end={
        <>
          <SoundButton state={sound.state} onToggle={() => void sound.toggle()} />
          {wakeLock.supported ? (
            <WakeLockSwitch on={wakeLock.on} onChange={wakeLock.change} className="max-md:hidden" />
          ) : null}
        </>
      }
      banners={
        <>
          {banner ? (
            <ConnectionBannerRow banner={banner} lastUpdate={lastUpdate} timeZone={timeZone} />
          ) : backOnline ? (
            <BackOnlineBanner
              key={backOnline.key}
              changed={backOnline.changed}
              onDismiss={() => setBackOnline(null)}
            />
          ) : null}
          {waitingText && waiting[0] ? (
            <WaitingBanner
              key="waiting"
              text={waitingText.text}
              action={waitingText.action}
              onShow={() => waiting[0] && showCard(waiting[0])}
            />
          ) : null}
          {nobody ? <NobodyOnlineBanner key="nobody-online" /> : null}
          {noCourier.length > 0 ? (
            <NoCourierBanner
              key="no-courier"
              orders={noCourier}
              viewer={meta.view}
              readOnly={meta.can.readOnly}
              onAssign={(orderId) => {
                const card = cards.find((item) => item.id === orderId);
                if (card) openDialog('assignCourier', card);
              }}
              onShowOldest={() => noCourier[0] && showCard(noCourier[0])}
            />
          ) : null}
          {attention.length > 0 ? (
            <StuckBanners
              items={attention}
              onOpen={(orderId) => router.push(orderHref(orderId), { scroll: false })}
            />
          ) : null}
          {hiddenStill.length > 0 ? (
            <HiddenByFiltersBanner
              count={hiddenStill.length}
              onShow={() => {
                const first = cards.find((card) => card.id === hiddenStill[0]);
                setFilters({ late: false, pay: null });
                setHiddenNew([]);
                if (first) requestAnimationFrame(() => showCard(first));
              }}
            />
          ) : null}
        </>
      }
    >
      <BoardToolbar
        phoneRow={
          <>
            <StoreChip store={meta.store} />
            {couriers ? <CouriersChip count={couriers} /> : null}
            {wakeLock.supported && shell.user.role === 'kitchen' ? (
              <WakeLockSwitch on={wakeLock.on} onChange={wakeLock.change} />
            ) : null}
          </>
        }
      >
        {couriers ? <CouriersChip count={couriers} className="max-md:hidden xl:hidden" /> : null}
        <FindOrder onFind={onFind} offline={offline} />
        <BoardFiltersBar filters={filters} onChange={setFilters} />
        {canSeeSheet ? (
          <SoldOutButton count={meta.soldOut.length} onOpen={() => setSheetOpen(true)} />
        ) : null}
      </BoardToolbar>
      <SoldOutStrip
        dishes={meta.soldOut}
        canManage={canSeeSheet}
        onManage={() => setSheetOpen(true)}
      />
      <StatusTabs
        columns={meta.columns}
        counts={counts}
        selected={selectedTab}
        onSelect={selectTab}
      />
      <div className="relative flex min-h-0 flex-1 flex-col">
        {/* The overlay stays outside the inert block, or "Sign in again" can't be reached. */}
        <div className="flex min-h-0 flex-1 flex-col" inert={signedOut || undefined}>
          <div
            ref={boardRef}
            id="board"
            style={{ '--board-cols': boardCols }}
            onFocus={(event) => {
              // Keyboard focus only: scrolling under a mouse press would move the card away
              // from the pointer before the click lands.
              if (!event.target.matches(':focus-visible')) return;
              const target = event.target.closest('article, section');
              target?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            }}
            className={cn(
              'flex flex-col gap-3 px-4 pt-2 pb-4 md:flex-row md:snap-x md:snap-mandatory md:overflow-x-auto lg:grid lg:min-h-0 lg:flex-1 lg:grid-cols-(--board-cols) lg:overflow-y-hidden xl:gap-4 xl:px-6 xl:pb-6',
              empty === 'board' && 'lg:flex-none',
              signedOut && 'opacity-40',
            )}
          >
            {meta.columns.map((column) => {
              const visible = grouped[column].filter(shown);
              return (
                <BoardColumn
                  key={column}
                  column={column}
                  count={counts[column]}
                  collapsed={collapsed(column)}
                  collapsible={!isPhone}
                  hiddenOnPhone={column !== selectedTab}
                  tabPanel={isPhone && column === selectedTab}
                  newIds={newIds.filter((id) => visible.some((card) => card.id === id))}
                  empty={empty === 'board' ? 'board' : visible.length === 0 ? 'column' : null}
                  onToggle={() => toggleColumn(column)}
                  onShowNew={(id) => {
                    scrollToCard(id);
                    focusCardOrColumn(id, column);
                    setNewIds((current) => current.filter((item) => item !== id));
                  }}
                  className={columnClass}
                >
                  {visible.map((card) => (
                    <li key={card.id} data-card-id={card.id} data-flip-id={card.id}>
                      <OrderCard
                        card={card}
                        now={now}
                        offset={offset}
                        timeZone={timeZone}
                        thresholds={meta.thresholds}
                        can={meta.can}
                        progress={moves.progress[card.id] ?? null}
                        reason={moves.reasonFor(card)}
                        blocked={blocked}
                        highlight={highlights[card.id] ?? null}
                        onPrimary={onPrimary}
                        onMenu={onMenu}
                        onUndo={(undone) => void onUndo(undone)}
                        courierNow={courierNow}
                        courierItems={courierMenuFor(card, meta.view)}
                        onCourier={onCourier}
                        stuckItems={stuckActionsFor(card, meta.view)}
                        onStuck={onStuck}
                      />
                    </li>
                  ))}
                </BoardColumn>
              );
            })}
          </div>
          {empty ? (
            <BoardEmpty
              kind={empty === 'board' ? 'board' : 'filtered'}
              soundOn={sound.state === 'on'}
              onTurnOnSound={() => void sound.toggle()}
              onClearFilters={() => setFilters({ late: false, pay: null })}
            />
          ) : null}
        </div>
        {signedOut ? <SignedOutOverlay /> : null}
      </div>
      <BoardDialogs
        dialog={dialog}
        current={dialog ? (cards.find((card) => card.id === dialog.cardId) ?? null) : null}
        can={meta.can}
        timeZone={timeZone}
        offline={offline}
        writer={writer}
        onSignedOut={onSignedOut}
        onClose={() => setDialog(null)}
        focusAfter={focusAfter}
        onChain={(kind) => setDialog((current) => (current ? { ...current, kind } : current))}
      />
      {canSeeSheet || meta.can.readOnly ? (
        <SoldOutSheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          canChange={meta.can.setAvailability && !meta.can.readOnly}
          readOnly={meta.can.readOnly}
          offline={offline}
          timeZone={timeZone}
          writer={writer}
          syncRef={soldOutSync}
          onSignedOut={onSignedOut}
        />
      ) : null}
    </AdminPage>
  );
}
