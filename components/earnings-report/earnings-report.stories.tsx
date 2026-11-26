import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import type { EarningsReport, EarningsReportQuery } from '@/server/modules/earnings/schema';
import { AdminPage } from '@/components/admin/admin-page';
import { AdminShell } from '@/components/admin/admin-shell';
import type { StaffShellValue } from '@/components/admin/staff-shell-context';
import { partnerKeys } from '@/components/partner-review/queries';
import { REPORT_COPY } from '@/lib/admin/report-text';
import {
  DEMO_REPORT,
  EMPTY_RANGE,
  FILTERED_EMPTY,
  PAGED,
  REPORT,
  THIS_WEEK,
  TODAY,
  WITH_DELETED,
} from './earnings-report.fixtures';
import { ReportNoAccess } from './report-gate';
import { ReportView, type ReportViewProps } from './report-view';

/*
 * The payouts report (F9 design 3.12 to 3.15) at the widths the design names: 1440 (expanded
 * sidebar), 1280, 1024 (the rail, the table scrolling in its own region) and 375 (cards, the
 * range sheet), with its empty, filtered, masked, loading and CSV states. The address is kept
 * in the story's own state, so the range, filter and sort controls work.
 */

const VIEWPORTS = {
  w375: { name: '375 phone', styles: { width: '375px', height: '812px' } },
  w1024: { name: '1024 tablet', styles: { width: '1024px', height: '768px' } },
  w1280: { name: '1280 laptop', styles: { width: '1280px', height: '800px' } },
  w1440: { name: '1440 desktop', styles: { width: '1440px', height: '900px' } },
};

const at = (value: keyof typeof VIEWPORTS) => ({ viewport: { value, isRotated: false } });

const meta = {
  title: 'Admin/Earnings report',
  parameters: {
    layout: 'fullscreen',
    viewport: { options: VIEWPORTS },
    nextjs: { appDirectory: true, navigation: { pathname: '/admin/partners/earnings' } },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function shellOf(demo: boolean): StaffShellValue {
  return {
    frame: 'sidebar',
    user: demo
      ? { name: 'Demo Admin', role: 'admin', isDemo: true }
      : { name: 'Daniel Okafor', role: 'admin', isDemo: false },
    screens: ['orderBoard', 'liveMap', 'partners'],
    readOnly: demo,
    sessionExpiresAt: null,
    timeZone: 'America/New_York',
  };
}

/** The sidebar's badge count is already known, so nothing asks the server. */
function client() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY, retry: false } },
  });
  queryClient.setQueryData(partnerKeys.badge, { toReview: 0 });
  return queryClient;
}

function Frame({
  children,
  demo = false,
  sidebarOpen,
}: {
  children: ReactNode;
  demo?: boolean;
  sidebarOpen: boolean;
}) {
  const [queryClient] = useState(client);
  return (
    <QueryClientProvider client={queryClient}>
      <AdminShell shell={shellOf(demo)} sidebarOpen={sidebarOpen}>
        {children}
      </AdminShell>
    </QueryClientProvider>
  );
}

const noop = () => undefined;

function Report({
  result,
  query = result.query,
  demo = false,
  sidebarOpen = false,
  ...props
}: Partial<Omit<ReportViewProps, 'result' | 'query' | 'navigate' | 'today'>> & {
  result: EarningsReport;
  query?: EarningsReportQuery;
  demo?: boolean;
  sidebarOpen?: boolean;
}) {
  const [address, setAddress] = useState(query);
  return (
    <Frame demo={demo} sidebarOpen={sidebarOpen}>
      <AdminPage title={REPORT_COPY.title}>
        <ReportView
          query={address}
          result={result}
          today={TODAY}
          navigate={setAddress}
          busy={false}
          skeleton={false}
          failed={false}
          onRetry={noop}
          csv={{ pending: false, error: null, onPress: noop }}
          {...props}
        />
      </AdminPage>
    </Frame>
  );
}

export const Desktop1440: Story = {
  globals: at('w1440'),
  render: () => <Report result={REPORT} sidebarOpen />,
};

export const Laptop1280: Story = {
  globals: at('w1280'),
  render: () => <Report result={WITH_DELETED} />,
};

/** 1024 to 1279: the rail, and the table scrolling inside its own region (D25). */
export const Tablet1024: Story = {
  globals: at('w1024'),
  render: () => <Report result={REPORT} />,
};

export const Phone375Cards: Story = {
  globals: at('w375'),
  render: () => <Report result={REPORT} />,
};

export const Phone375RangeSheet: Story = {
  globals: at('w375'),
  render: () => <Report result={REPORT} initialSheetOpen />,
};

export const CustomDates: Story = {
  globals: at('w1440'),
  render: () => (
    <Report
      result={{ ...REPORT, query: { ...THIS_WEEK, from: '2026-11-03', to: '2026-11-12' } }}
      initialCustomOpen
      sidebarOpen
    />
  ),
};

export const SortedByClosing: Story = {
  globals: at('w1440'),
  render: () => (
    <Report
      result={{ ...REPORT, query: { ...THIS_WEEK, sort: 'closing', dir: 'desc' } }}
      sidebarOpen
    />
  ),
};

export const EmptyRange: Story = {
  globals: at('w1440'),
  render: () => <Report result={EMPTY_RANGE} sidebarOpen />,
};

export const FilteredToNothing: Story = {
  globals: at('w1440'),
  render: () => <Report result={FILTERED_EMPTY} sidebarOpen />,
};

export const FilteredToNothing375: Story = {
  globals: at('w375'),
  render: () => <Report result={FILTERED_EMPTY} />,
};

/** The demo admin (A66): real partners masked, one "Hidden for demo staff" cell each. */
export const DemoAdminMasked: Story = {
  globals: at('w1440'),
  render: () => <Report result={DEMO_REPORT} demo sidebarOpen />,
};

export const DemoAdminMasked375: Story = {
  globals: at('w375'),
  render: () => <Report result={DEMO_REPORT} demo />,
};

export const ChangingRange: Story = {
  globals: at('w1440'),
  render: () => <Report result={REPORT} busy sidebarOpen />,
};

export const ChangingPage: Story = {
  globals: at('w1440'),
  render: () => <Report result={PAGED} skeleton sidebarOpen />,
};

export const Paged: Story = {
  globals: at('w1440'),
  render: () => <Report result={PAGED} sidebarOpen />,
};

export const LoadFailed: Story = {
  globals: at('w1440'),
  render: () => <Report result={REPORT} failed sidebarOpen />,
};

export const CsvPreparing: Story = {
  globals: at('w1440'),
  render: () => (
    <Report result={REPORT} csv={{ pending: true, error: null, onPress: noop }} sidebarOpen />
  ),
};

export const CsvRefused: Story = {
  globals: at('w1440'),
  render: () => (
    <Report
      result={REPORT}
      csv={{
        pending: false,
        error: "You've exported a lot of reports. Try again in 14 minutes.",
        onPress: noop,
      }}
      sidebarOpen
    />
  ),
};

export const CsvRefused375: Story = {
  globals: at('w375'),
  render: () => (
    <Report
      result={REPORT}
      csv={{ pending: false, error: "Couldn't prepare the CSV. Try again.", onPress: noop }}
    />
  ),
};

/** SUPPORT at the report's address (design 3.1). */
export const NoAccessSupport: Story = {
  globals: at('w1440'),
  render: () => (
    <Frame sidebarOpen>
      <AdminPage>
        <ReportNoAccess back="partners" />
      </AdminPage>
    </Frame>
  ),
};
