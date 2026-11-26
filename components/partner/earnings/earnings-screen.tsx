'use client';

import { useQueryClient } from '@tanstack/react-query';
import { CircleAlert, CircleCheck, FlaskConical, Info, WifiOff } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import type {
  EarningsDayGroup,
  EarningsRow,
  EarningsSummary,
  EarningsWeekBlock,
  IsoDate,
} from '@/server/modules/earnings/schema';
import type { PartnerState } from '@/server/modules/partners/schema';
import { FormAlert } from '@/components/forms/form-alert';
import { Button } from '@/components/ui/button';
import { announce } from '@/lib/announce';
import { useMotion } from '@/lib/motion';
import { holdingNotice } from '@/lib/partner/delivery-text';
import { offlineLine, periodAnnouncement, weekTitle } from '@/lib/partner/earnings-text';
import { useOnline } from '@/lib/use-online';
import { PinnedConnectionBanner, usePartnerSession } from '../home/partner-home';
import { SuspensionCover } from '../home/home-parts';
import { OfferLayer, useOfferOpen } from '../offers/offer-layer';
import { DispatchNoticeSlot } from '../offers/offer-notices';
import {
  IconDisc,
  PartnerFrame,
  PartnerNotice,
  PartnerTabBar,
  PlainHeader,
  StatusHeader,
} from '../shell';
import { CashCard } from './cash-card';
import {
  earningsKeys,
  useEarningsLive,
  useEarningsSummary,
  useEarningsWeek,
} from './earnings-data';
import { EarningsList, type EarningsListHandle, ListSkeleton, useSkeleton } from './earnings-list';
import { DeliverySheet } from './delivery-sheet';
import { GoalSheet, type SaveGoal } from './goal-sheet';
import { MoneyNoticeSlot } from './money-notices';
import { type Period, PeriodBar } from './period-bar';
import { TodayBlock } from './today-block';
import { WeekBlock, WeekSkeleton } from './week-block';

/*
 * The Earnings tab (F9 design 1): the cash card first, Today (the ring against his own goal) or
 * the week (seven bars), then every delivery and payment, with the period bar under his thumb.
 * Approved partners get it inside the app's shell, with offers still running over it; a
 * suspended partner gets the same figures read-only, without the tab bar or a goal (P61).
 */

type Home = Extract<PartnerState, { screen: 'home' }>;

const PRACTICE_GOAL_KEY = 'foodz.partner-demo-goal';
let memoryGoal: number | null = null;

function readPracticeGoal(): number | null {
  try {
    const value = window.sessionStorage.getItem(PRACTICE_GOAL_KEY);
    const cents = value === null ? null : Number(value);
    return cents !== null && Number.isSafeInteger(cents) && cents > 0 ? cents : null;
  } catch {
    return memoryGoal;
  }
}

function writePracticeGoal(cents: number | null) {
  memoryGoal = cents;
  try {
    if (cents === null) window.sessionStorage.removeItem(PRACTICE_GOAL_KEY);
    else window.sessionStorage.setItem(PRACTICE_GOAL_KEY, String(cents));
  } catch {
    // Storage blocked: the goal lives in memory for this page.
  }
}

/** `/partner/earnings`, or `?view=week&week=2026-11-09`: reload and Back keep the view. */
function writeAddress(period: Period, week: IsoDate) {
  const url = period === 'week' ? `/partner/earnings?view=week&week=${week}` : '/partner/earnings';
  window.history.replaceState(window.history.state, '', url);
}

export interface EarningsView {
  period: Period;
  week: IsoDate;
}

/** The approved (and demo) partner's tab, in the app shell with offers running. */
export function EarningsScreen({
  state,
  userId,
  asOf,
  summary,
  view,
}: {
  state: Home;
  userId: string;
  asOf: string;
  summary: EarningsSummary | null;
  view: EarningsView;
}) {
  const { sharing, online, holding } = usePartnerSession(state, asOf);
  const offerOpen = useOfferOpen();
  const frame: FrameParts = {
    header: (
      <StatusHeader
        online={online || Boolean(holding)}
        name={state.partner.name}
        photoUrl={state.partner.photo?.url ?? null}
      />
    ),
    pinned: <PinnedConnectionBanner pinned={sharing.pinned} />,
    tabBar: <PartnerTabBar current="earnings" />,
    heading: 'Earnings',
    lead: null,
    notices: (
      <>
        <MoneyNoticeSlot userId={userId} onEarnings />
        <DispatchNoticeSlot />
      </>
    ),
    after: holding ? (
      <PartnerNotice
        tone="muted"
        icon={Info}
        action={
          <Button asChild variant="outline" size="kitchen" className="bg-card text-strong">
            <Link href="/partner">Back to the delivery</Link>
          </Button>
        }
      >
        {holdingNotice(holding.orderNumber)}
      </PartnerNotice>
    ) : null,
  };
  return (
    <>
      <div inert={sharing.suspended || offerOpen ? true : undefined}>
        {summary ? (
          <EarningsBody
            partnerKey={state.partner.id}
            initial={summary}
            view={view}
            live
            frame={frame}
          />
        ) : (
          <EarningsErrorFrame frame={frame} />
        )}
      </div>
      <OfferLayer />
      {sharing.suspended ? <SuspensionCover how={sharing.suspended} /> : null}
    </>
  );
}

/** A suspended partner's earnings, read-only (P61.1): no status header, tab bar or goal. */
export function SuspendedEarnings({
  userId,
  summary,
  view,
}: {
  userId: string;
  summary: EarningsSummary | null;
  view: EarningsView;
}) {
  const frame: FrameParts = {
    header: <PlainHeader title="Your earnings" start={{ kind: 'back', href: '/partner' }} />,
    pinned: null,
    tabBar: null,
    heading: 'Your earnings',
    lead: (
      <PartnerNotice tone="muted" icon={Info}>
        Your partner account is suspended. You can still see what Foodz owes you.
      </PartnerNotice>
    ),
    notices: <MoneyNoticeSlot userId={userId} onEarnings />,
    after: null,
  };
  return summary ? (
    <EarningsBody partnerKey="self" initial={summary} view={view} live={false} frame={frame} />
  ) : (
    <EarningsErrorFrame frame={frame} />
  );
}

export interface FrameParts {
  header: ReactNode;
  pinned: ReactNode;
  tabBar: ReactNode;
  /** The sr-only h1. */
  heading: string;
  /** Before the notice slot: the suspended partner's line. */
  lead: ReactNode;
  /** The notice slot's other notices (staff money, F7's offer notices). */
  notices: ReactNode;
  /** After the notice slot: the order he holds. */
  after: ReactNode;
}

function Heading({ text }: { text: string }) {
  return (
    <h1 data-partner-h1="" tabIndex={-1} className="sr-only">
      {text}
    </h1>
  );
}

function RetryButton({ onPress }: { onPress: () => void }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="kitchen"
      className="bg-card text-strong"
      onClick={onPress}
    >
      Try again
    </Button>
  );
}

const LOAD_FAILED = "Couldn't load your earnings.";

/** P59.4: the summary failed. The cash card is never drawn from a guess. */
export function EarningsErrorFrame({ frame }: { frame: FrameParts }) {
  const router = useRouter();
  return (
    <PartnerFrame
      header={frame.header}
      pinned={frame.pinned}
      tabBar={frame.tabBar}
      mainClassName="space-y-5"
    >
      <Heading text={frame.heading} />
      {frame.lead}
      <div className="space-y-3 empty:hidden">{frame.notices}</div>
      <div className="pt-6 text-center">
        <IconDisc icon={CircleAlert} tone="error" />
        <h2 className="mt-4 font-heading text-title-1 text-strong">{LOAD_FAILED}</h2>
        <div className="mt-4 flex justify-center">
          <RetryButton onPress={() => router.refresh()} />
        </div>
      </div>
    </PartnerFrame>
  );
}

/** The phone's zone differs from the store's: "Times are Boston time." (P52.4). */
function useZoneDiffers(storeZone: string): boolean {
  const [differs, setDiffers] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        setDiffers(Intl.DateTimeFormat().resolvedOptions().timeZone !== storeZone);
      } catch {
        setDiffers(false);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [storeZone]);
  return differs;
}

/** Rows that weren't there when this week was first shown: they get a short wash (1.10). */
function useNewRows(week: IsoDate, groups: EarningsDayGroup[] | undefined): ReadonlySet<string> {
  const seen = useRef(new Map<IsoDate, Set<string>>());
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    if (!groups) return undefined;
    const ids = groups.flatMap((group) => group.rows.map((row) => row.id));
    const known = seen.current.get(week);
    if (!known) {
      seen.current.set(week, new Set(ids));
      return undefined;
    }
    const added = ids.filter((id) => !known.has(id));
    if (added.length === 0) return undefined;
    for (const id of added) known.add(id);
    const timer = setTimeout(() => setFresh(new Set(added)), 0);
    return () => clearTimeout(timer);
  }, [week, groups]);
  return fresh;
}

/** The demo partner's goal for this browser session (P62.2). */
function usePracticeGoal(practice: boolean) {
  const [goal, setGoal] = useState<number | null>(null);
  useEffect(() => {
    if (!practice) return undefined;
    const timer = setTimeout(() => setGoal(readPracticeGoal()), 0);
    return () => clearTimeout(timer);
  }, [practice]);
  return [goal, setGoal] as const;
}

/** The tab inside a given frame; exported for stories, which seed its reads. */
export function EarningsBody({
  partnerKey,
  initial,
  view,
  live,
  frame,
}: {
  partnerKey: string;
  initial: EarningsSummary;
  view: EarningsView;
  live: boolean;
  frame: FrameParts;
}) {
  const queryClient = useQueryClient();
  const online = useOnline();
  const summaryQuery = useEarningsSummary(partnerKey, initial);
  const summary = summaryQuery.data;
  const tz = summary.storeTimeZone;
  const currentWeek = summary.week.start;
  const firstWeek = summary.firstWeekStart ?? currentWeek;
  const readOnly = summary.readOnly;
  const practice = summary.practice;
  useEarningsLive(partnerKey, currentWeek, summary.today.nextDayAt, live);
  const zoneDiffers = useZoneDiffers(tz);

  const [period, setPeriod] = useState<Period>(view.period);
  const [pickedWeek, setPickedWeek] = useState<IsoDate>(view.week);
  // A week from the address that isn't his (before his first, after this one) shows this week.
  const week = pickedWeek > currentWeek || pickedWeek < firstWeek ? currentWeek : pickedWeek;
  const shownWeek = period === 'week' ? week : currentWeek;
  const isCurrentWeek = shownWeek === currentWeek;
  const weekQuery = useEarningsWeek(partnerKey, shownWeek, isCurrentWeek);
  const groups = weekQuery.data?.groups;
  const newIds = useNewRows(shownWeek, groups);
  const listSkeleton = useSkeleton(weekQuery.isPending);

  const [practiceGoal, setPracticeGoal] = usePracticeGoal(practice);
  const goalCents = practice ? practiceGoal : summary.today.goalCents;
  const [goalOpen, setGoalOpen] = useState(false);
  const [goalSaved, setGoalSaved] = useState(false);
  const goalButtonRef = useRef<HTMLButtonElement>(null);
  const [opened, setOpened] = useState<{ row: EarningsRow; date: IsoDate } | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<EarningsListHandle>(null);
  const blockRef = useRef<HTMLDivElement>(null);
  const pendingAnnouncement = useRef<string | null>(null);

  const shownBlock: EarningsWeekBlock | undefined = isCurrentWeek ? summary.week : weekQuery.data;
  const title = period === 'today' ? 'Today' : weekTitle(shownWeek, currentWeek);
  const announced = period === 'today' ? summary.today.earnedCents : shownBlock?.earnedCents;

  // The new heading is read once after his own switch, as soon as its figure is known.
  useEffect(() => {
    if (pendingAnnouncement.current !== title || announced === undefined) return;
    pendingAnnouncement.current = null;
    announce(periodAnnouncement(title, announced));
  }, [title, announced]);

  useEffect(() => {
    if (!goalSaved) return undefined;
    const timer = setTimeout(() => setGoalSaved(false), 4_000);
    return () => clearTimeout(timer);
  }, [goalSaved]);

  // The period block crossfades on a switch (150 ms; a plain swap under reduced motion).
  const blockKey = period === 'today' ? 'today' : shownWeek;
  const firstBlock = useRef(true);
  useMotion(
    (motion) => {
      if (firstBlock.current) {
        firstBlock.current = false;
        return;
      }
      if (motion.reduced || !blockRef.current) return;
      motion.from(blockRef.current, { opacity: 0, duration: 0.15, ease: 'power1.out' });
    },
    { scope: blockRef, dependencies: [blockKey] },
  );

  const showPeriod = (nextPeriod: Period, nextWeek: IsoDate) => {
    setPeriod(nextPeriod);
    setPickedWeek(nextWeek);
    writeAddress(nextPeriod, nextWeek);
    pendingAnnouncement.current =
      nextPeriod === 'today' ? 'Today' : weekTitle(nextWeek, currentWeek);
    // A content swap, not travel: the window jumps to the block.
    requestAnimationFrame(() =>
      document.getElementById('period')?.scrollIntoView({ block: 'start', behavior: 'auto' }),
    );
  };

  const saveGoal: SaveGoal = async (cents) => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return 'offline';
    if (practice) {
      writePracticeGoal(cents);
      setPracticeGoal(cents);
    } else {
      try {
        const response = await fetch('/api/v1/partner/earnings/goal', {
          method: 'PUT',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ cents }),
        });
        if (!response.ok) return 'failed';
      } catch {
        return 'offline';
      }
      queryClient.setQueryData<EarningsSummary>(earningsKeys.summary(partnerKey), (current) =>
        current ? { ...current, today: { ...current.today, goalCents: cents } } : current,
      );
      void queryClient.invalidateQueries({ queryKey: earningsKeys.summary(partnerKey) });
    }
    setGoalSaved(true);
    announce('Goal saved.');
    return 'saved';
  };

  const todayGroups = useMemo(
    () => (groups ?? []).filter((group) => group.date === summary.today.date),
    [groups, summary.today.date],
  );
  const listGroups = period === 'today' ? todayGroups : (groups ?? []);

  let list: ReactNode = null;
  if (!summary.hasEntries) {
    list = null;
  } else if (weekQuery.isError && !groups) {
    list = (
      <FormAlert
        variant="error"
        tone="partner"
        action={<RetryButton onPress={() => void weekQuery.refetch()} />}
      >
        {LOAD_FAILED}
      </FormAlert>
    );
  } else if (!groups) {
    list =
      listSkeleton.show || listSkeleton.reserve ? (
        <div className={listSkeleton.show ? undefined : 'invisible'}>
          <ListSkeleton />
        </div>
      ) : null;
  } else if (listGroups.length === 0) {
    list =
      period === 'today' ? (
        <p className="text-body-4 text-muted-foreground">No deliveries today yet.</p>
      ) : null;
  } else {
    list = (
      <EarningsList
        groups={listGroups}
        today={summary.today.date}
        timeZone={tz}
        newIds={newIds}
        onOpen={(row, opener) => {
          openerRef.current = opener;
          const date = listGroups.find((group) => group.rows.includes(row))?.date ?? '';
          setOpened({ row, date });
          setSheetOpen(true);
        }}
        handleRef={listRef}
      />
    );
  }

  let block: ReactNode;
  if (period === 'today') {
    block = (
      <TodayBlock
        today={summary.today}
        goalCents={goalCents}
        readOnly={readOnly}
        neverDelivered={!summary.hasEntries}
        onGoal={() => setGoalOpen(true)}
        goalButtonRef={goalButtonRef}
      />
    );
  } else if (shownBlock) {
    block = (
      <WeekBlock
        week={shownBlock}
        currentWeekStart={currentWeek}
        zoneDiffers={zoneDiffers}
        onDay={(date) => listRef.current?.showDay(date)}
      />
    );
  } else if (weekQuery.isError) {
    block = (
      <FormAlert
        variant="error"
        tone="partner"
        action={<RetryButton onPress={() => void weekQuery.refetch()} />}
      >
        {LOAD_FAILED}
      </FormAlert>
    );
  } else {
    block = <WeekSkeleton />;
  }

  const figuresAt = new Date(summaryQuery.dataUpdatedAt || Date.parse(summary.asOf)).toISOString();

  return (
    <>
      <PartnerFrame
        header={frame.header}
        pinned={frame.pinned}
        tabBar={frame.tabBar}
        dock={
          <PeriodBar
            period={period}
            onPeriod={(next) => showPeriod(next, next === 'week' ? week : currentWeek)}
            weekStart={week}
            isFirstWeek={week <= firstWeek}
            isCurrentWeek={week >= currentWeek}
            onWeek={(next) => showPeriod('week', next)}
            withTabBar={Boolean(frame.tabBar)}
          />
        }
        mainClassName="space-y-5"
      >
        <Heading text={frame.heading} />
        {frame.lead}
        <div className="space-y-3 empty:hidden">
          {frame.notices}
          {goalSaved ? (
            <PartnerNotice tone="success" icon={CircleCheck}>
              Goal saved.
            </PartnerNotice>
          ) : null}
          {online ? null : (
            <p className="flex min-h-6 items-center gap-2 text-body-5 font-medium text-strong tabular-nums">
              <WifiOff className="size-4 shrink-0 text-warning-mark" aria-hidden />
              {offlineLine(figuresAt, tz)}
            </p>
          )}
        </div>
        {frame.after}
        {practice ? (
          <PartnerNotice tone="muted" icon={FlaskConical}>
            Practice data. These aren&apos;t real earnings.
          </PartnerNotice>
        ) : null}
        <CashCard cash={summary.cash} timeZone={tz} />
        <div id="period" ref={blockRef} className="scroll-mt-16">
          {block}
        </div>
        {list}
      </PartnerFrame>
      {readOnly ? null : (
        <GoalSheet
          open={goalOpen}
          onOpenChange={setGoalOpen}
          goalCents={goalCents}
          practice={practice}
          onSave={saveGoal}
          returnFocus={() => requestAnimationFrame(() => goalButtonRef.current?.focus())}
        />
      )}
      <DeliverySheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        row={opened?.row ?? null}
        date={opened?.date ?? summary.today.date}
        partnerId={partnerKey}
        timeZone={tz}
        practice={practice}
        returnFocus={() => openerRef.current?.focus()}
      />
    </>
  );
}
