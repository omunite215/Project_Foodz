import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Info } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';
import type {
  EarningsDeliveryDetail,
  EarningsRow,
  EarningsSummary,
  EarningsWeek,
} from '@/server/modules/earnings/schema';
import { setDispatchStateForPreview } from '@/lib/partner/dispatch';
import type { PartnerTheme } from '@/lib/partner/text';
import { CodeSheet } from '../delivery/code-sheet';
import { PartnerRoot } from '../partner-root';
import { PartnerNotice, PartnerTabBar, PlainHeader, StatusHeader } from '../shell';
import { CashCard, WorkedOutSheet } from './cash-card';
import { earningsKeys } from './earnings-data';
import { EarningsList, ListSkeleton } from './earnings-list';
import { DeliverySheet } from './delivery-sheet';
import {
  BIG_DAY_SUMMARY,
  BUSY_WEEK,
  CANCELLED_NO_TIP,
  CARRIED_CASH,
  DETAILS,
  DIEGO_CASH,
  EARLIER_WEEK_BLOCK,
  EMPTY_WEEK_BLOCK,
  GOAL_REACHED_SUMMARY,
  LAST_WEEK_BLOCK,
  LENA_SUMMARY,
  LUIS_CASH,
  LUIS_ID,
  LUIS_SUMMARY,
  LUIS_WEEK,
  LUIS_WEEK_BLOCK,
  NO_GOAL_SUMMARY,
  QUIET_TODAY_SUMMARY,
  RATINGS,
  RILEY_SUMMARY,
  SQUARE_CASH,
  TZ,
  VICTOR_SUMMARY,
} from './earnings.fixtures';
import { EarningsBody, EarningsErrorFrame, type FrameParts } from './earnings-screen';
import { GoalSheet } from './goal-sheet';
import { MoneyNoticeList } from './money-notices';
import { RatingsBody } from './ratings-screen';
import { TodayLinkView } from './today-link';
import { WeekBlock, WeekSkeleton } from './week-block';

/*
 * The partner's Earnings tab and ratings (F9 design 1) in light and dark side by side, at the
 * design's phone widths (320, 390, 412) and in the 1440 frame. Reads are seeded into a query
 * client, so nothing here calls the server.
 */

const noop = () => {};
const NO_WEEKS: EarningsWeek[] = [];
const NO_DETAILS: EarningsDeliveryDetail[] = [];
const LUIS_WEEKS: EarningsWeek[] = [LUIS_WEEK];

function Phone({
  theme,
  width = 390,
  height = 844,
  children,
}: {
  theme: PartnerTheme;
  width?: number;
  height?: number;
  children: ReactNode;
}) {
  return (
    <div
      style={{ width, height }}
      className="shrink-0 overflow-auto rounded-xl border border-neutral-6"
    >
      <PartnerRoot initialTheme={theme}>{children}</PartnerRoot>
    </div>
  );
}

function Both({
  width,
  height,
  children,
}: {
  width?: number;
  height?: number;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap gap-6 p-4">
      <Phone theme="light" width={width} height={height}>
        {children}
      </Phone>
      <Phone theme="dark" width={width} height={height}>
        {children}
      </Phone>
    </div>
  );
}

/** A query client holding the given weeks and delivery details, never refetching. */
function Seeded({
  weeks = NO_WEEKS,
  details = NO_DETAILS,
  children,
}: {
  weeks?: EarningsWeek[];
  details?: EarningsDeliveryDetail[];
  children: ReactNode;
}) {
  const [client] = useState(() => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY, retry: false } },
    });
    for (const week of weeks)
      queryClient.setQueryData(earningsKeys.week(LUIS_ID, week.start), week);
    for (const detail of details) {
      queryClient.setQueryData(earningsKeys.delivery(LUIS_ID, detail.deliveryId), detail);
    }
    return queryClient;
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const appFrame: FrameParts = {
  header: <StatusHeader online name="Luis Moreno" photoUrl={null} />,
  pinned: null,
  tabBar: <PartnerTabBar current="earnings" />,
  heading: 'Earnings',
  lead: null,
  notices: null,
  after: null,
};

const suspendedFrame: FrameParts = {
  header: <PlainHeader title="Your earnings" start={{ kind: 'back', href: '/partner' }} />,
  pinned: null,
  tabBar: null,
  heading: 'Your earnings',
  lead: (
    <PartnerNotice tone="muted" icon={Info}>
      Your partner account is suspended. You can still see what Foodz owes you.
    </PartnerNotice>
  ),
  notices: null,
  after: null,
};

function Screen({
  summary,
  weeks = LUIS_WEEKS,
  period = 'today',
  week,
  frame = appFrame,
}: {
  summary: EarningsSummary;
  weeks?: EarningsWeek[];
  period?: 'today' | 'week';
  week?: string;
  frame?: FrameParts;
}) {
  return (
    <Seeded weeks={weeks}>
      <EarningsBody
        partnerKey={LUIS_ID}
        initial={summary}
        view={{ period, week: week ?? summary.week.start }}
        live={false}
        frame={frame}
      />
    </Seeded>
  );
}

const meta = {
  title: 'Partner/Earnings',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// ------------------------------------------------------------------ Today (1.4, 1.5)

export const TodayWithGoal: Story = {
  render: () => (
    <Both>
      <Screen summary={LUIS_SUMMARY} />
    </Both>
  ),
};

export const TodayAt320: Story = {
  render: () => (
    <Both width={320} height={568}>
      <Screen summary={LUIS_SUMMARY} />
    </Both>
  ),
};

export const TodayAt412: Story = {
  render: () => (
    <Both width={412} height={915}>
      <Screen summary={LUIS_SUMMARY} />
    </Both>
  ),
};

/** The 1440 frame: the 448 column on its backdrop (F6 2.1). */
export const TodayFramed1440: Story = {
  render: () => (
    <div className="min-h-dvh w-[1440px] bg-neutral-7">
      <PartnerRoot initialTheme="light">
        <Screen summary={LUIS_SUMMARY} />
      </PartnerRoot>
    </div>
  ),
};

export const TodayWithoutGoal: Story = {
  render: () => (
    <Both>
      <Screen summary={NO_GOAL_SUMMARY} />
    </Both>
  ),
};

export const GoalReached: Story = {
  render: () => (
    <Both>
      <Screen summary={GOAL_REACHED_SUMMARY} />
    </Both>
  ),
};

export const ThousandDollarDay: Story = {
  render: () => (
    <Both width={320} height={700}>
      <Screen summary={BIG_DAY_SUMMARY} />
    </Both>
  ),
};

export const NoDeliveriesToday: Story = {
  render: () => (
    <Both>
      <Screen
        summary={QUIET_TODAY_SUMMARY}
        weeks={[{ ...LUIS_WEEK, groups: LUIS_WEEK.groups.slice(1) }]}
      />
    </Both>
  ),
};

export const NeverDelivered: Story = {
  render: () => (
    <Both>
      <Screen summary={LENA_SUMMARY} weeks={[{ ...LUIS_WEEK, ...LENA_SUMMARY.week, groups: [] }]} />
    </Both>
  ),
};

// ------------------------------------------------------------------ the week (1.6)

export const WeekCurrent: Story = {
  render: () => (
    <Both>
      <Screen summary={LUIS_SUMMARY} period="week" />
    </Both>
  ),
};

export const WeekFirst: Story = {
  render: () => (
    <Both>
      <Screen
        summary={LUIS_SUMMARY}
        period="week"
        week="2026-11-09"
        weeks={[LUIS_WEEK, { ...LAST_WEEK_BLOCK, practice: false, groups: [] }]}
      />
    </Both>
  ),
};

export const WeekBlocks: Story = {
  render: () => (
    <Both height={1400}>
      <div className="space-y-10 p-4">
        <WeekBlock
          week={LUIS_WEEK_BLOCK}
          currentWeekStart="2026-11-16"
          zoneDiffers={false}
          onDay={noop}
        />
        <WeekBlock
          week={EARLIER_WEEK_BLOCK}
          currentWeekStart="2026-11-16"
          zoneDiffers
          onDay={noop}
        />
        <WeekBlock
          week={EMPTY_WEEK_BLOCK}
          currentWeekStart="2026-11-16"
          zoneDiffers={false}
          onDay={noop}
        />
      </div>
    </Both>
  ),
};

export const Loading: Story = {
  render: () => (
    <Both height={600}>
      <div className="space-y-5 p-4">
        <WeekSkeleton />
        <ListSkeleton />
      </div>
    </Both>
  ),
};

// ------------------------------------------------------------------ the list (1.7)

export const ListEveryKind: Story = {
  render: () => (
    <Both height={1600}>
      <div className="p-4">
        <EarningsList
          groups={LUIS_WEEK.groups}
          today="2026-11-20"
          timeZone={TZ}
          newIds={new Set([LUIS_WEEK.groups[0]?.rows[0]?.id ?? ''])}
          onOpen={noop}
          handleRef={null}
        />
      </div>
    </Both>
  ),
};

/** 60 rows: virtualized on the window with the current day's header pinned (P55.3). */
export const ListLongWeek: Story = {
  render: () => (
    <PartnerRoot initialTheme="dark">
      <Screen summary={LUIS_SUMMARY} period="week" weeks={[BUSY_WEEK]} />
    </PartnerRoot>
  ),
};

// ------------------------------------------------------------------ sheets (1.5, 1.8, 1.9)

const rowFor = (detail: EarningsDeliveryDetail): EarningsRow => ({
  id: detail.deliveryId,
  kind: detail.how === 'cancelled-after-pickup' ? 'cancelledAfterPickup' : 'delivery',
  at: detail.steps.at(-1)?.at ?? '2026-11-21T00:46:00.000Z',
  deliveryId: detail.deliveryId,
  orderNumber: detail.orderNumber,
  areaWords: detail.areaWords,
  amountCents: detail.totalCents,
  tipCents: detail.tipCents || null,
  cashCents: detail.cashCents,
  message: null,
  method: null,
  reference: null,
});

function DeliveryStory({
  detail,
  theme = 'light',
}: {
  detail: EarningsDeliveryDetail;
  theme?: PartnerTheme;
}) {
  return (
    <Phone theme={theme}>
      <Seeded details={[detail]}>
        <DeliverySheet
          open
          onOpenChange={noop}
          row={rowFor(detail)}
          date={detail.date}
          partnerId={LUIS_ID}
          timeZone={TZ}
          practice={false}
          returnFocus={noop}
        />
      </Seeded>
    </Phone>
  );
}

export const DeliveryWithTheCode: Story = { render: () => <DeliveryStory detail={DETAILS.code} /> };
export const DeliveryConfirmedByStaff: Story = {
  render: () => <DeliveryStory detail={DETAILS.staff} theme="dark" />,
};
export const DeliveryMarkedByFoodz: Story = {
  render: () => <DeliveryStory detail={DETAILS.override} />,
};
export const DeliveryCancelledAfterPickup: Story = {
  render: () => <DeliveryStory detail={DETAILS.cancelled} theme="dark" />,
};
export const DeliveryCancelledWithoutTip: Story = {
  render: () => <DeliveryStory detail={CANCELLED_NO_TIP} />,
};
export const DeliveryNotAvailable: Story = {
  render: () => (
    <Phone theme="light">
      <Seeded>
        <DeliverySheet
          open
          onOpenChange={noop}
          row={{ ...rowFor(DETAILS.code), deliveryId: 'someone-elses' }}
          date="2026-11-20"
          partnerId={LUIS_ID}
          timeZone={TZ}
          practice={false}
          returnFocus={noop}
        />
      </Seeded>
    </Phone>
  ),
};

function GoalStory({
  goalCents,
  practice = false,
  theme = 'light',
}: {
  goalCents: number | null;
  practice?: boolean;
  theme?: PartnerTheme;
}) {
  return (
    <Phone theme={theme}>
      <GoalSheet
        open
        onOpenChange={noop}
        goalCents={goalCents}
        practice={practice}
        onSave={() => Promise.resolve('saved')}
        returnFocus={noop}
      />
    </Phone>
  );
}

export const GoalSheetNoGoal: Story = { render: () => <GoalStory goalCents={null} /> };
export const GoalSheetCustom: Story = { render: () => <GoalStory goalCents={4000} theme="dark" /> };
export const GoalSheetDemo: Story = { render: () => <GoalStory goalCents={10_000} practice /> };
export const GoalSheetCustomError: Story = {
  render: () => <GoalStory goalCents={4000} />,
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    const field = await page.findByLabelText('Goal in dollars');
    await userEvent.clear(field);
    await userEvent.type(field, '5');
    await userEvent.click(page.getByRole('button', { name: 'Save' }));
    await expect(await page.findByText('Enter whole dollars from $10 to $1,000.')).toBeVisible();
    await expect(field).toHaveAttribute('aria-invalid', 'true');
  },
};

export const CashCards: Story = {
  render: () => (
    <Both height={900}>
      <div className="space-y-4 p-4">
        <CashCard cash={LUIS_CASH} timeZone={TZ} />
        <CashCard cash={{ ...LUIS_CASH, balanceCents: 9640, holdingCents: 0 }} timeZone={TZ} />
        <CashCard cash={DIEGO_CASH} timeZone={TZ} />
        <CashCard cash={SQUARE_CASH} timeZone={TZ} />
      </div>
    </Both>
  ),
};

function WorkedOutStory({
  cash,
  theme = 'light',
}: {
  cash: typeof LUIS_CASH;
  theme?: PartnerTheme;
}) {
  return (
    <Phone theme={theme}>
      <WorkedOutSheet open onOpenChange={noop} cash={cash} timeZone={TZ} returnFocus={noop} />
    </Phone>
  );
}

export const WorkedOutFromPayout: Story = { render: () => <WorkedOutStory cash={LUIS_CASH} /> };
export const WorkedOutCarriedOver: Story = {
  render: () => <WorkedOutStory cash={CARRIED_CASH} theme="dark" />,
};
export const WorkedOutFirstDelivery: Story = { render: () => <WorkedOutStory cash={DIEGO_CASH} /> };

// ------------------------------------------------------------------ notices, states, modes

export const StaffNotices: Story = {
  render: () => (
    <Both height={760}>
      <div className="p-4">
        <MoneyNoticeList
          onEarnings={false}
          items={[
            { id: 'n1', kind: 'cash', text: 'Foodz recorded $142.70 in cash from you.' },
            {
              id: 'n2',
              kind: 'added',
              text: 'Foodz added $3.00: Waited 20 min at the kitchen for order 1050.',
            },
            {
              id: 'n3',
              kind: 'takenOff',
              text: 'Foodz took off $2.00: Wrong tip entered on order 1046.',
            },
            { id: 'n4', kind: 'payout', text: 'Foodz paid you $67.05 · Bank transfer' },
          ]}
        />
      </div>
    </Both>
  ),
};

export const LoadFailed: Story = {
  render: () => (
    <Both>
      <EarningsErrorFrame frame={appFrame} />
    </Both>
  ),
};

export const PracticeWeek: Story = {
  render: () => (
    <Both>
      <Screen summary={RILEY_SUMMARY} weeks={[{ ...LUIS_WEEK, practice: true }]} />
    </Both>
  ),
};

export const SuspendedReadOnly: Story = {
  render: () => (
    <Both>
      <Screen summary={VICTOR_SUMMARY} frame={suspendedFrame} />
    </Both>
  ),
};

export const HomeTodayLine: Story = {
  render: () => (
    <Both height={320}>
      <div className="space-y-3 p-4">
        <TodayLinkView today={{ earnedCents: 1957, deliveries: 3 }} />
        <TodayLinkView today={{ earnedCents: 764, deliveries: 1 }} />
        <TodayLinkView today={{ earnedCents: 0, deliveries: 0 }} />
        <TodayLinkView today={{ earnedCents: 300, deliveries: 0 }} />
      </div>
    </Both>
  ),
};

function DeliveredStory() {
  useEffect(() => {
    setDispatchStateForPreview({
      delivery: null,
      card: null,
      delivered: { orderNumber: '1042', pay: '$7.64', today: { earnedCents: 1957, deliveries: 3 } },
    });
  }, []);
  return <CodeSheet open onOpenChange={noop} position={null} returnFocus={noop} />;
}

export const DeliveredTodayLine: Story = {
  render: () => (
    <Phone theme="light">
      <DeliveredStory />
    </Phone>
  ),
};

// ------------------------------------------------------------------ Your ratings (1.12)

export const RatingsFivePlus: Story = {
  render: () => (
    <Both height={900}>
      <div className="space-y-6 p-4">
        <RatingsBody summary={RATINGS.grace} />
      </div>
    </Both>
  ),
};

export const RatingsNothingMentioned: Story = {
  render: () => (
    <Both height={900}>
      <div className="space-y-6 p-4">
        <RatingsBody summary={RATINGS.graceNothingMentioned} />
      </div>
    </Both>
  ),
};

export const RatingsBaselineOnly: Story = {
  render: () => (
    <Both height={500}>
      <div className="space-y-6 p-4">
        <RatingsBody summary={RATINGS.omar} />
      </div>
    </Both>
  ),
};

export const RatingsUnderFive: Story = {
  render: () => (
    <Both height={500}>
      <div className="space-y-6 p-4">
        <RatingsBody summary={RATINGS.underFive} />
      </div>
    </Both>
  ),
};

export const RatingsNone: Story = {
  render: () => (
    <Both height={300}>
      <div className="space-y-6 p-4">
        <RatingsBody summary={RATINGS.none} />
      </div>
    </Both>
  ),
};

export const RatingsPractice: Story = {
  render: () => (
    <Both height={900}>
      <div className="space-y-6 p-4">
        <RatingsBody summary={RATINGS.riley} />
      </div>
    </Both>
  ),
};
