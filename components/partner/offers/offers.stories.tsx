import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { type ReactNode, useState } from 'react';
import type { PartnerTheme } from '@/lib/partner/text';
import {
  deliveredNotice,
  endedNotice,
  missedNotice,
  releaseNotice,
} from '@/lib/partner/offer-text';
import { DeliverScreen, PickUpScreen } from '../delivery/pick-up-screen';
import { GiveBackSheet, LeavingDialog } from '../delivery/give-back-sheet';
import { PartnerRoot } from '../partner-root';
import { LocationLine } from '../home/home-parts';
import {
  HowOffersWorkLink,
  HowOffersWorkSheet,
  OfferAlertsSection,
  PracticeOfferCard,
} from './idle-parts';
import { OfferCardView } from './offer-card';
import { OfferNotice, SoundUnlockBanner } from './offer-notices';
import {
  AUTO_OFFER,
  cardFor,
  DELIVERING,
  PICK_UP,
  PRACTICE_OFFER,
  STAFF_OFFER,
} from './offers.fixtures';
import { type SlideState, SlideToAccept } from './slide-to-accept';

/*
 * F7's partner screens (design 1) in light and dark: the offer card in each variant and state,
 * the slider, the notices, the pick-up and interim screens, the give-back sheet, the leaving
 * dialog, "How offers work", the practice card and Profile's offer alerts. The card is fixed
 * to the screen in the app; here each frame holds it (a transform makes the frame its box).
 */

function Frame({
  theme,
  height = 760,
  width = 390,
  children,
}: {
  theme: PartnerTheme;
  height?: number;
  width?: number;
  children: ReactNode;
}) {
  return (
    <div
      style={{ height, width }}
      className="relative overflow-auto rounded-xl border border-neutral-6 [transform:translateZ(0)]"
    >
      <PartnerRoot initialTheme={theme}>{children}</PartnerRoot>
    </div>
  );
}

function Both({
  children,
  height,
  width,
}: {
  children: ReactNode;
  height?: number;
  width?: number;
}) {
  return (
    <div className="flex flex-wrap gap-6 p-4">
      <Frame theme="light" height={height} width={width}>
        {children}
      </Frame>
      <Frame theme="dark" height={height} width={width}>
        {children}
      </Frame>
    </div>
  );
}

const noop = () => undefined;
const cardProps = {
  offset: 0,
  noConnection: false,
  onAccept: noop,
  onDecline: noop,
  onBackToWaiting: noop,
  onTouch: noop,
};

const meta = {
  title: 'Partner/Offers',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const AutomaticOffer: Story = {
  render: () => (
    <Both>
      <OfferCardView card={cardFor(AUTO_OFFER, 27)} {...cardProps} />
    </Both>
  ),
};

export const StaffOffer: Story = {
  render: () => (
    <Both>
      <OfferCardView card={cardFor(STAFF_OFFER, 52)} {...cardProps} />
    </Both>
  ),
};

export const PracticeOffer: Story = {
  render: () => (
    <Both>
      <OfferCardView card={cardFor(PRACTICE_OFFER, 30)} {...cardProps} />
    </Both>
  ),
};

/** The frame and countdown from the event alone; accepting waits for the details (P35.6). */
export const Loading: Story = {
  render: () => (
    <Both>
      <OfferCardView card={cardFor(null, 29)} {...cardProps} />
    </Both>
  ),
};

export const DetailsFailed: Story = {
  render: () => (
    <Both>
      <OfferCardView card={cardFor(null, 22, { detailFailed: true })} {...cardProps} />
    </Both>
  ),
};

export const LastTenSeconds: Story = {
  render: () => (
    <Both>
      <OfferCardView card={cardFor(AUTO_OFFER, 8)} {...cardProps} />
    </Both>
  ),
};

export const Accepting: Story = {
  render: () => (
    <Both>
      <OfferCardView card={cardFor(AUTO_OFFER, 20, { phase: 'accepting' })} {...cardProps} />
    </Both>
  ),
};

/** Accept pressed with no connection; the pinned banner shows inside the card (P28.1). */
export const WaitingForConnection: Story = {
  render: () => (
    <Both>
      <OfferCardView
        card={cardFor(AUTO_OFFER, 14, { phase: 'accepting', waitingForConnection: true })}
        {...cardProps}
        noConnection
      />
    </Both>
  ),
};

export const Accepted: Story = {
  render: () => (
    <Both>
      <OfferCardView
        card={cardFor(AUTO_OFFER, 18, { phase: 'accepted', orderNumber: '1042' })}
        {...cardProps}
      />
    </Both>
  ),
};

export const OfflineExpired: Story = {
  render: () => (
    <Both>
      <OfferCardView card={cardFor(AUTO_OFFER, 0, { phase: 'offlineExpired' })} {...cardProps} />
    </Both>
  ),
};

export const PracticeAccepted: Story = {
  render: () => (
    <Both>
      <OfferCardView
        card={cardFor(PRACTICE_OFFER, 12, { phase: 'practiceAccepted' })}
        {...cardProps}
      />
    </Both>
  ),
};

/** 320 × 568: on a short viewport the countdown sits beside the pay (D3). */
export const Compact: Story = {
  render: () => (
    <Both width={320} height={568}>
      <OfferCardView card={cardFor(AUTO_OFFER, 27)} {...cardProps} />
    </Both>
  ),
};

const SLIDES: SlideState[] = ['ready', 'blocked', 'accepting', 'waiting', 'accepted'];

export const SlideStates: Story = {
  render: () => (
    <Both height={520}>
      <div className="space-y-4 bg-card p-4">
        {SLIDES.map((state) => (
          <SlideToAccept
            key={state}
            state={state}
            name="Accept order, earn $7.64"
            describedBy="none"
            acceptedLabel="Order 1042 is yours"
            onAccept={noop}
            onTouch={noop}
          />
        ))}
      </div>
    </Both>
  ),
};

export const Notices: Story = {
  render: () => {
    const words = [
      endedNotice('expired'),
      endedNotice('withdrawn-order'),
      endedNotice('withdrawn-staff'),
      endedNotice('taken'),
      missedNotice(2, 3),
      releaseNotice('takenOff', '1042'),
      releaseNotice('cancelled', '1042'),
      releaseNotice('handedOver', '1042'),
      releaseNotice('movedBack', '1042'),
      deliveredNotice('1042'),
    ].filter((item) => item !== null);
    return (
      <Both height={1100}>
        <div className="space-y-3 bg-background p-4">
          <SoundUnlockBanner />
          {words.map((item) => (
            <OfferNotice key={item.text} words={item} onDismiss={noop} />
          ))}
        </div>
      </Both>
    );
  },
};

export const IdleAdditions: Story = {
  render: () => (
    <Both>
      <div className="bg-background p-4">
        <div className="divide-y divide-border rounded-2xl border border-border bg-card">
          <LocationLine state={{ kind: 'shared', secondsAgo: 50 }} offersPaused />
          <LocationLine state={{ kind: 'stale', minutes: 2 }} offersPaused />
        </div>
        <HowOffersWorkLink />
      </div>
    </Both>
  ),
};

function Screen({ children }: { children: ReactNode }) {
  return <div className="min-h-full bg-background px-4 pt-4 pb-6">{children}</div>;
}

const screenProps = {
  locationOff: false,
  onGiveBack: noop,
  onGoOffline: noop,
  onRetryLocation: noop,
};

export const PickUpOnTheWay: Story = {
  render: () => (
    <Both>
      <Screen>
        <PickUpScreen
          delivery={PICK_UP}
          distance={{ atKitchen: false, km: 0.9 }}
          {...screenProps}
        />
      </Screen>
    </Both>
  ),
};

export const PickUpAtTheKitchen: Story = {
  render: () => (
    <Both>
      <Screen>
        <PickUpScreen
          delivery={{ ...PICK_UP, payment: { kind: 'card', text: 'Paid by card' } }}
          distance={{ atKitchen: true, km: 0 }}
          {...screenProps}
        />
      </Screen>
    </Both>
  ),
};

export const PickUpLocationOff: Story = {
  render: () => (
    <Both height={900}>
      <Screen>
        <PickUpScreen
          delivery={PICK_UP}
          distance={null}
          {...screenProps}
          locationOff
          notices={<OfferNotice words={releaseNotice('movedBack', '1042')} onDismiss={noop} />}
        />
      </Screen>
    </Both>
  ),
};

export const InterimDeliver: Story = {
  render: () => (
    <Both>
      <Screen>
        <DeliverScreen delivery={DELIVERING} />
      </Screen>
    </Both>
  ),
};

function GiveBackOpen() {
  const [open, setOpen] = useState(true);
  return (
    <GiveBackSheet
      open={open}
      orderNumber="1042"
      onOpenChange={setOpen}
      onDone={noop}
      returnFocus={noop}
    />
  );
}

export const GiveBack: Story = {
  render: () => (
    <Both>
      <GiveBackOpen />
    </Both>
  ),
};

export const GoOfflineWhileAssigned: Story = {
  render: () => (
    <Both>
      <LeavingDialog
        open
        how="offline"
        orderNumber="1042"
        onKeep={noop}
        onConfirm={() => Promise.resolve(null)}
        returnFocus={noop}
      />
    </Both>
  ),
};

function HowOffersWorkOpen() {
  const [open, setOpen] = useState(true);
  return <HowOffersWorkSheet open={open} onOpenChange={setOpen} returnFocus={noop} />;
}

export const HowOffersWork: Story = {
  render: () => (
    <Both>
      <HowOffersWorkOpen />
    </Both>
  ),
};

export const PracticeAndAlerts: Story = {
  render: () => (
    <Both>
      <div className="space-y-6 bg-background p-4">
        <PracticeOfferCard />
        <OfferAlertsSection />
      </div>
    </Both>
  ),
};
