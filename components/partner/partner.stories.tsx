import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Eye, Info, Navigation, PowerOff, TriangleAlert, WifiOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import type { PartnerTheme } from '@/lib/partner/text';
import { IdExamples, VehicleTiles } from './apply/fields';
import { UploadField } from './apply/upload-field';
import {
  ApprovedSignedOut,
  PendingScreen,
  RejectedScreen,
  SentBackScreen,
  SuspendedScreen,
  WelcomeScreen,
} from './application-screens';
import { ApplyGate } from './apply-gate';
import { DeliverLanding } from './deliver-landing';
import { KitchenChip, LocationHelpCard, LocationLine, SuspensionCover } from './home/home-parts';
import { ANA, ANA_EMAIL, JONAS, KWAME_SENT_BACK, MEI, TZ, USER_ID } from './partner.fixtures';
import { PartnerRoot } from './partner-root';
import {
  Dock,
  DockButton,
  PartnerFrame,
  PartnerNotice,
  PartnerTabBar,
  PinnedBanner,
  PlainHeader,
  StatusHeader,
} from './shell';

/*
 * The partner app (F6 design 2 to 6) in light and dark side by side: every partner story is
 * drawn in both themes, because the app is used in sun and at night (P13).
 */

function Themed({ theme, children }: { theme: PartnerTheme; children: ReactNode }) {
  return (
    <div className="h-[760px] w-[390px] overflow-auto rounded-xl border border-neutral-6">
      <PartnerRoot initialTheme={theme}>{children}</PartnerRoot>
    </div>
  );
}

function Both({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap gap-6 p-4">
      <Themed theme="light">{children}</Themed>
      <Themed theme="dark">{children}</Themed>
    </div>
  );
}

const meta = {
  title: 'Partner/App',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Headers: Story = {
  render: () => (
    <Both>
      <div className="space-y-6">
        <StatusHeader online name="Diego Alvarez" photoUrl={null} />
        <StatusHeader online={false} name="Diego Alvarez" photoUrl={null} />
        <PlainHeader />
        <PlainHeader title="Apply to deliver" start={{ kind: 'back', onBack: () => {} }} />
      </div>
    </Both>
  ),
};

export const BannersAndNotices: Story = {
  render: () => (
    <Both>
      <div className="space-y-3 p-4">
        <PinnedBanner tone="warning" icon={WifiOff}>
          No connection. You&apos;re still online. We&apos;ll send your location when you&apos;re
          back.
        </PinnedBanner>
        <PartnerNotice tone="muted" icon={Eye}>
          Demo partner: we use a pretend location near the kitchen, never your real one.
        </PartnerNotice>
        <PartnerNotice tone="warning" icon={TriangleAlert} onDismiss={() => {}}>
          You went offline at 6:42 pm because we hadn&apos;t had your location for 10 minutes.
        </PartnerNotice>
        <PartnerNotice tone="success" icon={Info} onDismiss={() => {}}>
          Changes saved
        </PartnerNotice>
        <PartnerNotice tone="error" icon={TriangleAlert}>
          We couldn&apos;t take you online. Try again.
        </PartnerNotice>
        <KitchenChip open line="Foodz Kitchen is open · closes 11 pm" />
        <KitchenChip open={false} line="Foodz Kitchen is closed · opens 11 am tomorrow" />
      </div>
    </Both>
  ),
};

export const DockButtons: Story = {
  render: () => (
    <Both>
      <div className="space-y-4 p-4">
        <Dock withTabBar>
          <DockButton icon={Navigation}>Go online</DockButton>
        </Dock>
        <Dock withTabBar>
          <DockButton variant="stop" icon={PowerOff}>
            Go offline
          </DockButton>
        </Dock>
        <Dock reason="You need a connection to go online." reasonIcon={WifiOff} reasonId="r1">
          <DockButton blocked blockedReason="You need a connection to go online." reasonId="r1">
            Go online
          </DockButton>
        </Dock>
        <PartnerTabBar current="home" />
      </div>
    </Both>
  ),
};

function Vehicles() {
  const [value, setValue] = useState<'BICYCLE' | 'SCOOTER' | 'MOTORBIKE' | 'CAR' | ''>('SCOOTER');
  return <VehicleTiles value={value} error={null} onChange={setValue} />;
}

export const ApplyFields: Story = {
  render: () => (
    <Both>
      <div className="space-y-8 p-4">
        <Vehicles />
        <VehicleTiles value="" error="Choose what you'll deliver with." onChange={() => {}} />
        <IdExamples />
        <UploadField
          kind="photo"
          documentType="DRIVER_LICENSE"
          value={null}
          error={null}
          onChange={() => {}}
          onError={() => {}}
        />
        <UploadField
          kind="id"
          documentType="DRIVER_LICENSE"
          value={null}
          error="Add a photo of the front of your license."
          onChange={() => {}}
          onError={() => {}}
        />
      </div>
    </Both>
  ),
};

export const Gates: Story = {
  render: () => (
    <Both>
      <ApplyGate
        state={{
          screen: 'gate',
          gate: 'emailNotConfirmed',
          email: { masked: 'jor…@…', full: 'unconfirmed.customer@foodz.example' },
        }}
      />
    </Both>
  ),
};

export const Pending: Story = {
  render: () => (
    <Both>
      <PendingScreen application={ANA} email={ANA_EMAIL} userId={USER_ID} timeZone={TZ} />
    </Both>
  ),
};

export const SentBack: Story = {
  render: () => (
    <Both>
      <SentBackScreen
        application={{ ...ANA, vehicleWords: 'Bicycle or e-bike' }}
        sentBack={KWAME_SENT_BACK}
        userId={USER_ID}
        timeZone={TZ}
      />
    </Both>
  ),
};

export const RejectedWithReason: Story = {
  render: () => (
    <Both>
      <RejectedScreen state={JONAS} />
    </Both>
  ),
};

export const RejectedCanReapply: Story = {
  render: () => (
    <Both>
      <RejectedScreen state={MEI} />
    </Both>
  ),
};

export const Approved: Story = {
  render: () => (
    <Both>
      <ApprovedSignedOut email="approved.partner@foodz.example" />
    </Both>
  ),
};

export const Welcome: Story = {
  render: () => (
    <Both>
      <WelcomeScreen firstName="Luis" />
    </Both>
  ),
};

export const Suspended: Story = {
  render: () => (
    <Both>
      <SuspendedScreen
        since="2026-11-19T21:00:00Z"
        reason="Repeated late deliveries (test account)"
        timeZone={TZ}
      />
    </Both>
  ),
};

export const LocationHelp: Story = {
  render: () => (
    <Both>
      <div className="space-y-4 p-4">
        <LocationHelpCard card="blocked" onRetry={() => {}} />
        <LocationHelpCard card="approximate" onRetry={() => {}} />
        <LocationHelpCard card="notFound" onRetry={() => {}} />
      </div>
    </Both>
  ),
};

export const LocationLines: Story = {
  render: () => (
    <Both>
      <div className="divide-y divide-border bg-card">
        <LocationLine state={{ kind: 'shared', secondsAgo: 20 }} />
        <LocationLine state={{ kind: 'weak', secondsAgo: 20 }} />
        <LocationLine state={{ kind: 'looking', secondsAgo: 40 }} />
        <LocationLine state={{ kind: 'stale', minutes: 2 }} />
        <LocationLine state={{ kind: 'queued', secondsAgo: 40 }} />
        <LocationLine state={{ kind: 'demo' }} />
      </div>
    </Both>
  ),
};

export const SuspensionCoverStory: Story = {
  name: 'Suspension cover',
  render: () => (
    <Both>
      <PartnerFrame header={<StatusHeader online name="Diego Alvarez" photoUrl={null} />}>
        <p>Behind the cover.</p>
      </PartnerFrame>
      <SuspensionCover how="event" />
    </Both>
  ),
};

export const Landing: Story = {
  render: () => (
    <div className="bg-neutral-8">
      <DeliverLanding visitor="guest" />
    </div>
  ),
};

export const LandingForStaff: Story = {
  render: () => (
    <div className="bg-neutral-8">
      <DeliverLanding visitor="staff" />
    </div>
  ),
};
