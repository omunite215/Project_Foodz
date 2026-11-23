'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { listOrdersAction } from '@/server/modules/orders/actions';
import type { OrderSummary, OrdersPage } from '@/server/modules/orders/schema';
import { useSlowPending } from '@/components/forms/submit-button';
import { EmptyState } from '@/components/states/empty-state';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { callAction } from '@/lib/action-result';
import { announce } from '@/lib/announce';
import { useMotion } from '@/lib/motion';
import { freshenRows } from '@/lib/order-text';
import { channels } from '@/lib/realtime/channels';
import { useChannelEvent } from '@/lib/realtime/client';
import { useHydrated } from '@/lib/use-hydrated';
import { useOnline } from '@/lib/use-online';
import { OrderRow } from './order-row';

/*
 * /account/orders (F4 design 4, S12.1 to S12.4): "In progress" first, then "Past orders", newest
 * first, 20 at a time. Failed attempts never show.
 */

/** Changes that land together (a move and its payment) are read with one fetch. */
const FRESHEN_WAIT_MS = 400;

/**
 * Keeps the open list current (F5 design 7.3): a status change of any of her orders (on her
 * user channel), the tab shown again, the window focused, Back from an order, or coming back
 * online fetches the first page again, and the rows held take it in place.
 */
function useFreshRows(userId: string, freshen: () => void) {
  const hydrated = useHydrated();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestFreshen = useRef(freshen);
  useEffect(() => {
    latestFreshen.current = freshen;
  });
  const soon = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => latestFreshen.current(), FRESHEN_WAIT_MS);
  }, []);
  useChannelEvent(hydrated ? channels.user(userId) : null, 'order.status-changed', soon);
  useEffect(() => {
    // On arrival too: Back can show the list the router kept from earlier (S7.4).
    soon();
    const onVisible = () => {
      if (document.visibilityState === 'visible') soon();
    };
    const onShow = (event: PageTransitionEvent) => {
      if (event.persisted) soon();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', soon);
    window.addEventListener('online', soon);
    window.addEventListener('pageshow', onShow);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', soon);
      window.removeEventListener('online', soon);
      window.removeEventListener('pageshow', onShow);
    };
  }, [soon]);
}

export function OrdersList({
  page,
  timeZone,
  now,
  userId,
}: {
  page: OrdersPage;
  timeZone: string;
  /** The server's clock, so the first HTML and the browser agree on "Today". */
  now: string;
  /** Her user channel carries every status change of her orders (S7.2). */
  userId: string;
}) {
  const online = useOnline();
  const [inProgress, setInProgress] = useState<OrderSummary[]>(page.inProgress);
  const [past, setPast] = useState<OrderSummary[]>(page.past);
  const [cursor, setCursor] = useState<string | null>(page.nextCursor);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [firstNew, setFirstNew] = useState<string | null>(null);
  const slow = useSlowPending(loading);
  const firstNewRef = useRef<HTMLAnchorElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const clock = new Date(now);

  useEffect(() => {
    if (firstNew) firstNewRef.current?.focus();
  }, [firstNew]);

  const freshening = useRef(false);
  const latest = useRef({ inProgress, past });
  useEffect(() => {
    latest.current = { inProgress, past };
  });
  async function freshen() {
    if (freshening.current || !navigator.onLine) return;
    freshening.current = true;
    const outcome = await callAction(() => listOrdersAction({}));
    freshening.current = false;
    if (!outcome.ok) return;
    const fresh = [...outcome.data.inProgress, ...outcome.data.past];
    const current = freshenRows(latest.current.inProgress, fresh);
    const older = freshenRows(latest.current.past, fresh);
    setInProgress(current.rows);
    setPast(older.rows);
    for (const sentence of [...current.spoken, ...older.spoken]) announce(sentence);
  }
  useFreshRows(userId, () => void freshen());

  useMotion(
    (motion) => {
      if (!firstNew || !listRef.current) return;
      const rows = [...listRef.current.querySelectorAll('[data-new-row]')].slice(0, 6);
      motion.from(rows, {
        y: 8,
        opacity: 0,
        duration: motion.reduced ? 0.15 : 0.2,
        ease: 'power2.out',
        stagger: 0.03,
      });
    },
    { scope: listRef, dependencies: [firstNew] },
  );

  async function more() {
    if (!cursor || loading) return;
    setLoading(true);
    setFailed(false);
    const outcome = await callAction(() => listOrdersAction({ cursor }));
    setLoading(false);
    if (!outcome.ok) {
      setFailed(true);
      return;
    }
    const next = outcome.data.past;
    setPast((current) => [...current, ...next]);
    setCursor(outcome.data.nextCursor);
    setFirstNew(next[0]?.id ?? null);
  }

  if (inProgress.length === 0 && past.length === 0) {
    return (
      <div className="mt-8 rounded-2xl border border-neutral-6 bg-white px-5 py-12 md:px-6">
        <EmptyState
          illustration="orderFood"
          title="No orders yet"
          description="Your past orders will show up here."
          action={
            <Button asChild size="touch" className="uppercase">
              <Link href="/menu">Browse the menu</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const firstNewIndex = firstNew ? past.findIndex((order) => order.id === firstNew) : -1;
  const newIds = new Set(
    firstNewIndex < 0 ? [] : past.slice(firstNewIndex).map((order) => order.id),
  );

  return (
    <div className="mt-8 space-y-10">
      {inProgress.length > 0 ? (
        <section aria-labelledby="orders-in-progress">
          <h2 id="orders-in-progress" className="text-body-2 font-semibold text-neutral-1">
            In progress
          </h2>
          <ul className="mt-4 space-y-3">
            {inProgress.map((order) => (
              <li key={order.id}>
                <OrderRow order={order} now={clock} timeZone={timeZone} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {past.length > 0 ? (
        <section aria-labelledby="orders-past">
          <h2 id="orders-past" className="text-body-2 font-semibold text-neutral-1">
            Past orders
          </h2>
          <ul ref={listRef} className="mt-4 space-y-3">
            {past.map((order) => (
              <li key={order.id} data-new-row={newIds.has(order.id) || undefined}>
                <OrderRow
                  order={order}
                  now={clock}
                  timeZone={timeZone}
                  linkRef={order.id === firstNew ? firstNewRef : undefined}
                />
              </li>
            ))}
          </ul>
          {cursor ? (
            <div className="mt-6 flex flex-col items-center gap-2">
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="touch"
                  aria-disabled={loading || !online || undefined}
                  aria-describedby={online ? undefined : 'orders-offline'}
                  onClick={() => {
                    if (online) void more();
                  }}
                  className="bg-white"
                >
                  {slow ? (
                    <>
                      <Spinner className="size-4 motion-reduce:animate-none" aria-hidden />
                      Loading…
                    </>
                  ) : (
                    'Show more orders'
                  )}
                </Button>
                {online ? null : (
                  <span id="orders-offline" className="text-body-5 text-neutral-3">
                    You&apos;re offline.
                  </span>
                )}
              </div>
              {failed ? (
                <p className="text-body-5 text-destructive">
                  We couldn&apos;t load more orders.{' '}
                  <button
                    type="button"
                    onClick={() => void more()}
                    className="inline-flex h-11 items-center font-medium text-neutral-1 underline underline-offset-4"
                  >
                    Try again
                  </button>
                </p>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
