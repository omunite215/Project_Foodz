import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useRef, useState } from 'react';
import type {
  MoneyDialogKind,
  MoneyDialogOpening,
  PartnerEarningsPage,
} from '@/server/modules/earnings/schema';
import type { PartnerListResult } from '@/server/modules/partners/review-schema';
import { listQueryFromSearch } from '@/server/modules/partners/review-schema';
import type {
  PartnerRatingsPage,
  StaffOrderFeedback,
  StaffRatingRow,
} from '@/server/modules/ratings/schema';
import { AdminPage } from '@/components/admin/admin-page';
import { AdminShell } from '@/components/admin/admin-shell';
import type { StaffShellValue } from '@/components/admin/staff-shell-context';
import { CustomerFeedbackSection } from '@/components/board/detail/customer-feedback';
import type { PartnerSection } from '@/lib/admin/earnings-text';
import {
  APPROVED_LIST,
  AS_OF,
  COUNTED_ROW,
  DEMO_LIST,
  DIEGO_EARNINGS,
  DIEGO_UNDER_LIMITS,
  DISH_ROW,
  EMPTY_OWES_LIST,
  EXCLUDE_ROW,
  FEEDBACK_PARTLY,
  FEEDBACK_RATED,
  FEEDBACK_STATES,
  GRACE_RATINGS,
  HIDDEN_EARNINGS,
  HIDDEN_RATINGS,
  KAI_RATINGS,
  LENA_EARNINGS,
  LIST_ROWS,
  LUIS_EARNINGS,
  NO_RATINGS,
  OMAR_RATINGS,
  OPENINGS,
  OWES_LIST,
  RILEY_DEMO_EARNINGS,
  RILEY_DEMO_RATINGS,
  TZ,
} from './earnings.fixtures';
import { PartnerEarningsPanel } from './earnings-panel';
import { MoneyDialog, type MoneyDialogStart, moneyDialogKey } from './money-dialogs';
import { CashBlock, RatingCell, WeekCell } from './money-parts';
import { PartnerSectionsNav } from './partner-sections';
import { PartnersList } from './partners-list';
import { partnerKeys } from './queries';
import { ExcludeRatingDialog } from './rating-moderation';
import { PartnerRatingsPanel } from './ratings-panel';

/*
 * F9's staff screens (design 3.2 to 3.11, 3.16): the Partners list's money columns, the partner
 * page's sections, the Earnings and Ratings panels, each money dialog and the exclude dialog,
 * and the order's customer feedback. The server's answers are already in the cache, so nothing
 * asks the server; dialogs that show an answer open in that state.
 */

const VIEWPORTS = {
  w375: { name: '375 phone', styles: { width: '375px', height: '812px' } },
  w1024: { name: '1024 tablet', styles: { width: '1024px', height: '768px' } },
  w1280: { name: '1280 laptop', styles: { width: '1280px', height: '800px' } },
  w1440: { name: '1440 desktop', styles: { width: '1440px', height: '900px' } },
};

const at = (value: keyof typeof VIEWPORTS) => ({ viewport: { value, isRotated: false } });

const meta = {
  title: 'Admin/Partner earnings',
  parameters: {
    layout: 'fullscreen',
    viewport: { options: VIEWPORTS },
    nextjs: { appDirectory: true, navigation: { pathname: '/admin/partners' } },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const noop = () => undefined;
const yes = () => true;
const NOW = new Date(AS_OF);

function shellOf(role: 'support' | 'admin' | 'demo'): StaffShellValue {
  return {
    frame: 'sidebar',
    user:
      role === 'demo'
        ? { name: 'Demo Admin', role: 'admin', isDemo: true }
        : role === 'admin'
          ? { name: 'Daniel Okafor', role: 'admin', isDemo: false }
          : { name: 'Morgan Diaz', role: 'support', isDemo: false },
    screens: ['orderBoard', 'liveMap', 'partners'],
    readOnly: role === 'demo',
    sessionExpiresAt: null,
    timeZone: TZ,
  };
}

function Frame({
  children,
  viewer = 'admin',
  seed,
}: {
  children: ReactNode;
  viewer?: 'support' | 'admin' | 'demo';
  seed?: (client: QueryClient) => void;
}) {
  const [client] = useState(() => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { staleTime: Number.POSITIVE_INFINITY, retry: false, refetchOnMount: false },
      },
    });
    queryClient.setQueryData(partnerKeys.badge, { toReview: 2 });
    seed?.(queryClient);
    return queryClient;
  });
  return (
    <QueryClientProvider client={client}>
      <AdminShell shell={shellOf(viewer)} sidebarOpen={false}>
        {children}
      </AdminShell>
    </QueryClientProvider>
  );
}

// ------------------------------------------------------------------ the Partners list (3.2)

function List({
  result,
  viewer = 'admin',
}: {
  result: PartnerListResult;
  viewer?: 'admin' | 'demo';
}) {
  return (
    <Frame
      viewer={viewer}
      seed={(client) => client.setQueryData(partnerKeys.list(result.query), result)}
    >
      <PartnersList initial={result} />
    </Frame>
  );
}

const listParams = (query: Record<string, string>) => ({
  nextjs: { appDirectory: true, navigation: { pathname: '/admin/partners', query } },
});

export const ListApproved1440: Story = {
  globals: at('w1440'),
  parameters: listParams({ tab: 'approved' }),
  render: () => <List result={APPROVED_LIST} />,
};

/** 1024: the vehicle joins the partner cell and "Partner since" goes. */
export const ListApproved1024: Story = {
  globals: at('w1024'),
  parameters: listParams({ tab: 'approved' }),
  render: () => <List result={APPROVED_LIST} />,
};

/** Below 1024: cards, the rating, this week and the cash block in the key line, the menu on top. */
export const ListApproved375: Story = {
  globals: at('w375'),
  parameters: listParams({ tab: 'approved' }),
  render: () => <List result={APPROVED_LIST} />,
};

export const ListOwesCash: Story = {
  globals: at('w1440'),
  parameters: listParams({ tab: 'approved', owes: '1' }),
  render: () => <List result={OWES_LIST} />,
};

export const ListNobodyOwes: Story = {
  globals: at('w1440'),
  parameters: listParams({ tab: 'suspended', owes: '1' }),
  render: () => <List result={EMPTY_OWES_LIST} />,
};

/** The demo admin: one "Hidden for demo staff" over the three money columns of a real partner. */
export const ListDemoMasked: Story = {
  globals: at('w1440'),
  parameters: listParams({ tab: 'approved' }),
  render: () => <List result={DEMO_LIST} viewer="demo" />,
};

export const MoneyCells: Story = {
  render: () => {
    const now = NOW;
    return (
      <div className="grid max-w-3xl gap-4 p-6 text-body-5 text-neutral-1">
        {LIST_ROWS.map((row) =>
          row.money ? (
            <div key={row.partnerId} className="grid grid-cols-4 items-start gap-4">
              <span className="font-medium">{row.name}</span>
              <RatingCell rating={row.money.rating} />
              <WeekCell week={row.money.week} />
              <CashBlock cash={row.money.cash} now={now} timeZone={TZ} />
            </div>
          ) : null,
        )}
      </div>
    );
  },
};

// ------------------------------------------------------------------ the partner page (3.3, 3.4)

function Page({
  section,
  name,
  children,
  viewer = 'admin',
}: {
  section: PartnerSection;
  name: string;
  children: ReactNode;
  viewer?: 'support' | 'admin' | 'demo';
}) {
  return (
    <Frame viewer={viewer}>
      <AdminPage title="Partners" titleAs="p">
        <div className="mx-auto w-full max-w-[1200px] px-4 pb-12 lg:px-6">
          <h1 className="pt-6 font-heading text-title-1 text-neutral-2 xl:text-h4">{name}</h1>
          <PartnerSectionsNav
            partnerId="01937c4a-0000-7000-8000-00000000e001"
            list={listQueryFromSearch({ tab: 'approved' })}
            current={section}
          />
          <div className="mt-6">{children}</div>
        </div>
      </AdminPage>
    </Frame>
  );
}

function Earnings({
  page,
  viewer = 'admin',
}: {
  page: PartnerEarningsPage;
  viewer?: 'support' | 'admin' | 'demo';
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  return (
    <Page section="earnings" name={page.name} viewer={viewer}>
      <PartnerEarningsPanel
        initial={page}
        partnerId={page.partnerId}
        partnerName={page.name}
        timeZone={TZ}
        offline={false}
        enabled={false}
        headingRef={heading}
        onSignedOut={noop}
      />
    </Page>
  );
}

export const EarningsAdmin1440: Story = {
  globals: at('w1440'),
  render: () => <Earnings page={LUIS_EARNINGS} />,
};

export const EarningsAdmin1280: Story = {
  globals: at('w1280'),
  render: () => <Earnings page={LUIS_EARNINGS} />,
};

export const EarningsAdmin1024: Story = {
  globals: at('w1024'),
  render: () => <Earnings page={LUIS_EARNINGS} />,
};

/** Below 1024 the ledger is one card per entry. */
export const EarningsAdmin375: Story = {
  globals: at('w375'),
  render: () => <Earnings page={LUIS_EARNINGS} />,
};

/** Morgan (SUPPORT) on Diego: owed since Tuesday, amber; only "Record cash handed in". */
export const EarningsOwedAmberSupport: Story = {
  globals: at('w1440'),
  render: () => <Earnings page={DIEGO_EARNINGS} viewer="support" />,
};

export const EarningsOwedUnderLimits: Story = {
  globals: at('w1440'),
  render: () => <Earnings page={DIEGO_UNDER_LIMITS} viewer="support" />,
};

/** All square, no payouts, no entries: each missing action leaves its sentence. */
export const EarningsSquare: Story = {
  globals: at('w1440'),
  render: () => <Earnings page={LENA_EARNINGS} />,
};

export const EarningsDemoReadOnly: Story = {
  globals: at('w1440'),
  render: () => <Earnings page={RILEY_DEMO_EARNINGS} viewer="demo" />,
};

export const EarningsHiddenForDemo: Story = {
  globals: at('w1440'),
  render: () => <Earnings page={HIDDEN_EARNINGS} viewer="demo" />,
};

// ------------------------------------------------------------------ money dialogs (3.6 to 3.9)

function Dialog({
  kind,
  opening,
  start,
  offline = false,
}: {
  kind: MoneyDialogKind;
  opening: MoneyDialogOpening;
  start?: MoneyDialogStart;
  offline?: boolean;
}) {
  return (
    <Frame seed={(client) => client.setQueryData(moneyDialogKey(opening.partnerId, kind), opening)}>
      <MoneyDialog
        kind={kind}
        partnerId={opening.partnerId}
        partnerName={opening.partnerName}
        timeZone={TZ}
        offline={offline}
        onClose={noop}
        onCloseFocus={yes}
        onDone={noop}
        onSignedOut={noop}
        start={start}
      />
    </Frame>
  );
}

export const RecordCash: Story = {
  render: () => <Dialog kind="cash" opening={OPENINGS.cashDiego} />,
};

/** Luis owes nothing but holds cash: the amount starts empty; sent empty, it says so. */
export const RecordCashErrors: Story = {
  render: () => <Dialog kind="cash" opening={OPENINGS.cashLuis} start={{ submit: true }} />,
};

export const RecordCashFiguresChanged: Story = {
  render: () => (
    <Dialog
      kind="cash"
      opening={OPENINGS.cashDiego}
      start={{
        alert: {
          tone: 'warning',
          text: 'The figures changed after you opened this: Morgan Diaz recorded $50.00 in cash from Diego at 10:02 am. Check the amount.',
        },
      }}
    />
  ),
};

export const RecordCashLimit: Story = {
  render: () => (
    <Dialog
      kind="cash"
      opening={OPENINGS.cashDiego}
      start={{
        alert: {
          tone: 'error',
          text: "You've recorded a lot of cash hand-ins. Try again in 12 minutes.",
        },
      }}
    />
  ),
};

export const RecordCashOffline: Story = {
  render: () => <Dialog kind="cash" opening={OPENINGS.cashDiego} offline />,
};

/** ADMIN, step-up due: the code field shows from the start. */
export const AdjustWithStepUp: Story = {
  render: () => <Dialog kind="adjust" opening={OPENINGS.adjustLuis} />,
};

export const AdjustErrors: Story = {
  render: () => <Dialog kind="adjust" opening={OPENINGS.adjustLuis} start={{ submit: true }} />,
};

export const AdjustLimit: Story = {
  render: () => (
    <Dialog
      kind="adjust"
      opening={{ ...OPENINGS.adjustLuis, stepUpRequired: false }}
      start={{
        alert: {
          tone: 'error',
          text: "You've made a lot of adjustments. Try again in 12 minutes.",
        },
      }}
    />
  ),
};

export const RecordPayout: Story = {
  render: () => <Dialog kind="payout" opening={OPENINGS.payoutLuis} />,
};

export const PayoutErrors: Story = {
  render: () => (
    <Dialog
      kind="payout"
      opening={{ ...OPENINGS.payoutLuis, defaultAmountCents: null }}
      start={{ submit: true }}
    />
  ),
};

/** Two admins at once: the second gets one "Close" and who recorded it first (A62.3). */
export const PayoutRace: Story = {
  render: () => (
    <Dialog
      kind="payout"
      opening={OPENINGS.payoutLuis}
      start={{
        closeOnly:
          "Foodz Admin recorded a payout of $67.05 for Luis at 10:02 am. Luis's balance is now $0.00.",
      }}
    />
  ),
};

export const PayoutNothingOwed: Story = {
  render: () => <Dialog kind="payout" opening={OPENINGS.payoutDiego} />,
};

// ------------------------------------------------------------------ ratings (3.10, 3.11)

function Ratings({
  page,
  name,
  viewer = 'support',
}: {
  page: PartnerRatingsPage;
  name: string;
  viewer?: 'support' | 'admin' | 'demo';
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  return (
    <Page section="ratings" name={name} viewer={viewer}>
      <PartnerRatingsPanel
        initial={page}
        partnerId={page.partnerId}
        partnerName={name}
        timeZone={TZ}
        offline={false}
        enabled={false}
        headingRef={heading}
        onSignedOut={noop}
      />
    </Page>
  );
}

export const RatingsGrace1440: Story = {
  globals: at('w1440'),
  render: () => <Ratings page={GRACE_RATINGS} name="Grace Okafor" />,
};

export const RatingsGrace375: Story = {
  globals: at('w375'),
  render: () => <Ratings page={GRACE_RATINGS} name="Grace Okafor" />,
};

/** Omar's 31 sample ratings: the baseline line and no rated deliveries. */
export const RatingsBaseline: Story = {
  globals: at('w1440'),
  render: () => <Ratings page={OMAR_RATINGS} name="Omar Haddad" />,
};

export const RatingsUnderFive: Story = {
  globals: at('w1440'),
  render: () => <Ratings page={KAI_RATINGS} name="Kai Nakamura" />,
};

export const RatingsNone: Story = {
  globals: at('w1440'),
  render: () => <Ratings page={NO_RATINGS} name="Lena Fischer" />,
};

export const RatingsDemoReadOnly: Story = {
  globals: at('w1440'),
  render: () => <Ratings page={RILEY_DEMO_RATINGS} name="Riley Park" viewer="demo" />,
};

export const RatingsHiddenForDemo: Story = {
  globals: at('w1440'),
  render: () => <Ratings page={HIDDEN_RATINGS} name="L•••" viewer="demo" />,
};

function Exclude({
  row,
  start,
}: {
  row: StaffRatingRow;
  start?: { race?: string; submit?: boolean };
}) {
  return (
    <Frame viewer="support">
      <ExcludeRatingDialog
        row={row}
        timeZone={TZ}
        offline={false}
        onClose={noop}
        onCloseFocus={yes}
        onDone={noop}
        onRace={noop}
        onSignedOut={noop}
        start={start}
      />
    </Frame>
  );
}

export const ExcludePartnerRating: Story = { render: () => <Exclude row={COUNTED_ROW} /> };
export const ExcludeDishRating: Story = { render: () => <Exclude row={DISH_ROW} /> };
export const ExcludeErrors: Story = {
  render: () => <Exclude row={COUNTED_ROW} start={{ submit: true }} />,
};
export const ExcludeRace: Story = {
  render: () => (
    <Exclude
      row={EXCLUDE_ROW ?? COUNTED_ROW}
      start={{ race: 'Morgan Diaz excluded this rating a moment ago.' }}
    />
  ),
};

// ------------------------------------------------------------------ the order's feedback (3.16)

function Feedback({ feedback }: { feedback: readonly StaffOrderFeedback[] }) {
  return (
    <Frame viewer="support">
      <div className="max-w-[480px] space-y-6 bg-white px-6 py-5">
        {feedback.map((item) => (
          <CustomerFeedbackSection
            key={item.state}
            feedback={item}
            level="h3"
            timeZone={TZ}
            now={NOW}
            offline={false}
            onChanged={noop}
            onSignedOut={noop}
          />
        ))}
      </div>
    </Frame>
  );
}

export const FeedbackRated: Story = { render: () => <Feedback feedback={[FEEDBACK_RATED]} /> };

/** Partly rated while the window is open, and the courier's rating excluded. */
export const FeedbackPartlyRated: Story = {
  render: () => <Feedback feedback={[FEEDBACK_PARTLY]} />,
};

export const FeedbackStateLines: Story = {
  render: () => <Feedback feedback={FEEDBACK_STATES} />,
};
