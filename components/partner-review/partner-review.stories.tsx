import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { PartnerVersion, PartnerReview } from '@/server/modules/partners/review-schema';
import type { ReviewAction } from '@/server/modules/partners/review-schema';
import { ApplicationHistory } from './application-history';
import { DecisionDialog, EMPTY_DRAFT } from './decision-dialogs';
import { DocumentViewer } from './document-viewer';
import { DIEGO, HISTORY, SAM, SAMPLE_ID_IMAGE, TZ } from './partner-review.fixtures';
import {
  BannedChip,
  ChangedChip,
  DemoChip,
  FlagChips,
  OnlineLine,
  StatusChip,
  WaitingBlock,
} from './parts';

/*
 * The staff review (F6 design 7 to 10): the chips and tone blocks of the list and the page, the
 * history, the document viewer and each decision dialog, with the version check already
 * answered so they open as they would on the page.
 */

const meta = {
  title: 'Admin/Partners',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const noop = () => undefined;

export const Chips: Story = {
  render: () => (
    <div className="flex flex-col items-start gap-3 p-6">
      <div className="flex flex-wrap gap-2">
        <StatusChip tab="review" />
        <StatusChip tab="waiting" />
        <StatusChip tab="approved" />
        <StatusChip tab="suspended" />
        <StatusChip tab="rejected" />
      </div>
      <div className="flex flex-wrap gap-2">
        <BannedChip />
        <DemoChip />
        <ChangedChip />
      </div>
      <FlagChips flags={['samePlate', 'sameIdNumber', 'expiresSoon']} compact="belowXl" />
      <FlagChips flags={['samePlate', 'sameIdNumber', 'expiresSoon']} compact="always" />
    </div>
  ),
};

export const WaitingTones: Story = {
  render: () => (
    <div className="flex flex-col items-start gap-3 p-6">
      <WaitingBlock waiting={{ tone: 'normal', words: 'Waiting 9 h', detail: null }} />
      <WaitingBlock waiting={{ tone: 'amber', words: 'Waiting 1 day', detail: null }} />
      <WaitingBlock
        waiting={{ tone: 'red', words: 'Over 2 working days', detail: 'waiting 3 days' }}
      />
    </div>
  ),
};

export const OnlineStates: Story = {
  render: () => (
    <div className="flex flex-col items-start gap-3 p-6">
      <OnlineLine state="online" words="Online since 6:00 pm · location shared 20 s ago" />
      <OnlineLine
        state="stale"
        words="Online · no location for 3 min, so they aren't offered orders"
      />
      <OnlineLine state="offline" words="Offline · last seen Fri, Nov 20 · 5:12 pm" />
      <OnlineLine
        state="takenOffline"
        words="Offline · taken offline at 6:01 pm because we had no location for 10 minutes"
      />
    </div>
  ),
};

export const History: Story = {
  render: () => (
    <div className="max-w-xl p-6">
      <ApplicationHistory entries={HISTORY} timeZone={TZ} headingId="history" />
    </div>
  ),
};

export const Viewer: Story = {
  render: () => (
    <DocumentViewer
      open
      title="Front of Sam Rivera's driver's license"
      alt="Front of Sam Rivera's driver's license"
      link={{ url: SAMPLE_ID_IMAGE, expiresAt: null }}
      onFreshLink={async () => ({ url: SAMPLE_ID_IMAGE, expiresAt: null })}
      onClose={noop}
    />
  ),
};

export const ViewerExpired: Story = {
  render: () => (
    <DocumentViewer
      open
      title="Front of Sam Rivera's driver's license"
      alt="Front of Sam Rivera's driver's license"
      link={null}
      onFreshLink={async () => null}
      onClose={noop}
    />
  ),
};

function WithVersion({ review, children }: { review: PartnerReview; children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  const version: PartnerVersion = {
    partnerId: review.partnerId,
    version: review.version,
    status: review.status,
    online: review.online?.state.kind === 'online',
    lastChange: null,
    assignedOrderNumber: null,
  };
  for (const action of ['approve', 'sendBack', 'reject', 'suspend', 'reinstate', 'reopen']) {
    client.setQueryData(['partners', 'version', review.partnerId, action], version);
  }
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function Dialog({ action, review }: { action: ReviewAction; review: PartnerReview }) {
  return (
    <WithVersion review={review}>
      <DecisionDialog
        action={action}
        review={review}
        timeZone={TZ}
        offline={false}
        draft={EMPTY_DRAFT}
        onDraft={noop}
        onClose={noop}
        onFinished={noop}
        onSignedOut={noop}
        onCheckChanges={noop}
        onBackToList={noop}
        onSendBackInstead={noop}
      />
    </WithVersion>
  );
}

export const ApproveWithFlags: Story = { render: () => <Dialog action="approve" review={SAM} /> };
export const SendBack: Story = { render: () => <Dialog action="sendBack" review={SAM} /> };
export const Reject: Story = { render: () => <Dialog action="reject" review={SAM} /> };
export const Suspend: Story = { render: () => <Dialog action="suspend" review={DIEGO} /> };
export const Reinstate: Story = {
  render: () => (
    <Dialog
      action="reinstate"
      review={{ ...DIEGO, name: 'Victor Hale', firstName: 'Victor', status: 'SUSPENDED' }}
    />
  ),
};
export const Reopen: Story = {
  render: () => (
    <Dialog
      action="reopen"
      review={{ ...SAM, name: 'Jonas Weber', firstName: 'Jonas', status: 'REJECTED', flags: [] }}
    />
  ),
};
