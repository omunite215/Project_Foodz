import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { type ReactNode, useEffect, useState } from 'react';
import type { PartnerDeliveryF8 } from '@/server/modules/tracking/schema';
import { setDispatchStateForPreview } from '@/lib/partner/dispatch';
import { releaseNotice } from '@/lib/partner/offer-text';
import type { PartnerTheme } from '@/lib/partner/text';
import { OfferNotice } from '../offers/offer-notices';
import { AT_KITCHEN, DELIVERING, PICK_UP } from '../offers/offers.fixtures';
import { SlideToConfirm } from '../offers/slide-to-accept';
import { PartnerRoot } from '../partner-root';
import { CodeBoxes, CodeSheet } from './code-sheet';
import { DeliverScreen, ProblemOutcome, WaitingCard } from './deliver-screen';
import { PartnerMapCard } from './partner-map';
import { CounterCard, OpenInMapsButton, PickUpScreen } from './pick-up-screen';
import { ProblemSheet } from './problem-sheet';

/*
 * F8's courier screens (design 2) in light and dark: the pick-up screen with the map, the
 * counter card, the pickup slider's states, the deliver screen, the code boxes and sheet
 * (wrong tries, locked), the problem sheet, each problem outcome, the waiting clock and the
 * staff endings.
 */

const NOW = Date.parse('2026-11-21T00:42:00.000Z');
const noop = () => undefined;

function Frame({ theme, children }: { theme: PartnerTheme; children: ReactNode }) {
  return (
    <div className="relative h-[844px] w-[390px] overflow-auto rounded-xl border border-neutral-6 [transform:translateZ(0)]">
      <PartnerRoot initialTheme={theme}>
        <div className="min-h-full bg-background px-4 pt-4 pb-6 text-foreground">{children}</div>
      </PartnerRoot>
    </div>
  );
}

function Both({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap gap-6 p-4">
      <Frame theme="light">{children}</Frame>
      <Frame theme="dark">{children}</Frame>
    </div>
  );
}

const meta = {
  title: 'Partner/Delivery',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const fix = { lat: 42.3554, lng: -71.0532, accuracy: 12, speed: 0, at: NOW };

function mapCard(delivery: PartnerDeliveryF8) {
  const afterPickup = delivery.status === 'PICKED_UP';
  return (
    <PartnerMapCard
      delivery={delivery}
      fix={fix}
      fixes={[fix]}
      dark={false}
      now={NOW}
      serverNow={NOW}
      openInMaps={
        <OpenInMapsButton
          deliveryId={delivery.deliveryId}
          point={afterPickup && delivery.dropoff ? delivery.dropoff.point : delivery.kitchen.point}
          bicycle={false}
          customerFirst={afterPickup ? (delivery.dropoff?.firstName ?? null) : null}
        />
      }
      locationRow={null}
    />
  );
}

const screen = {
  locationOff: false,
  onGiveBack: noop,
  onGoOffline: noop,
  onRetryLocation: noop,
};

export const PickUpOnTheWay: Story = {
  render: () => (
    <Both>
      <PickUpScreen
        delivery={PICK_UP}
        distance={{ atKitchen: false, km: 0.9 }}
        mapCard={mapCard(PICK_UP)}
        atKitchenAtLoad
        {...screen}
      />
    </Both>
  ),
};

export const PickUpAtTheKitchen: Story = {
  render: () => (
    <Both>
      <PickUpScreen
        delivery={AT_KITCHEN}
        distance={{ atKitchen: true, km: 0 }}
        mapCard={mapCard(AT_KITCHEN)}
        atKitchenAtLoad
        {...screen}
      />
    </Both>
  ),
};

export const PickUpMovedBackAndLocationOff: Story = {
  render: () => (
    <Both>
      <PickUpScreen
        delivery={{ ...PICK_UP, orderReady: false }}
        distance={null}
        mapCard={mapCard(PICK_UP)}
        atKitchenAtLoad
        {...screen}
        locationOff
        notices={<OfferNotice words={releaseNotice('movedBack', '1042')} onDismiss={noop} />}
      />
    </Both>
  ),
};

const SLIDE = {
  slide: 'Slide when you have the food',
  tapAgain: 'Tap again to confirm',
  blocked: 'Slide when you have the food',
  busy: 'Confirming pickup…',
  busyOffline: 'Confirming pickup… waiting for a connection',
};

export const PickupSlider: Story = {
  render: () => (
    <Both>
      <div className="space-y-4">
        {(['ready', 'blocked', 'accepting', 'waiting', 'accepted'] as const).map((state) => (
          <SlideToConfirm
            key={state}
            state={state}
            name="picked up order 1042"
            acceptedLabel="Picked up"
            copy={SLIDE}
            onAccept={noop}
          />
        ))}
      </div>
    </Both>
  ),
};

export const CounterCardAlone: Story = {
  render: () => (
    <Both>
      <CounterCard orderNumber="1042" live={false} />
    </Both>
  ),
};

const deliverProps = {
  locationOff: false,
  askedToWaitAt: null,
  onRetryLocation: noop,
  onOpenProblems: noop,
};

export const Deliver: Story = {
  render: () => (
    <Both>
      <DeliverScreen
        delivery={DELIVERING}
        mapCard={mapCard(DELIVERING)}
        serverNow={NOW}
        {...deliverProps}
      />
    </Both>
  ),
};

export const DeliverCardNoPhone: Story = {
  render: () => (
    <Both>
      <DeliverScreen
        delivery={{
          ...DELIVERING,
          payment: { kind: 'card', text: 'Paid by card' },
          dropoff: DELIVERING.dropoff
            ? { ...DELIVERING.dropoff, phone: null, apt: null, instructions: null }
            : null,
        }}
        mapCard={mapCard(DELIVERING)}
        serverNow={NOW}
        {...deliverProps}
      />
    </Both>
  ),
};

const waiting = (patch: Partial<NonNullable<PartnerDeliveryF8['noAnswer']>>) => ({
  ...DELIVERING,
  noAnswer: {
    since: new Date(NOW - 48_000).toISOString(),
    reportable: false,
    told: false,
    waitRestartedAt: null,
    ...patch,
  },
});

export const WaitingClock: Story = {
  render: () => (
    <Both>
      <div className="space-y-4">
        <WaitingCard delivery={waiting({})} serverNow={NOW} askedToWait={false} />
        <WaitingCard delivery={waiting({ reportable: true })} serverNow={NOW} askedToWait={false} />
        <WaitingCard
          delivery={waiting({ reportable: true, told: true })}
          serverNow={NOW}
          askedToWait={false}
        />
        <WaitingCard delivery={waiting({})} serverNow={NOW} askedToWait />
      </div>
    </Both>
  ),
};

export const ProblemOutcomes: Story = {
  render: () => (
    <Both>
      <div className="space-y-4">
        {(['address', 'refused', 'cant-finish', 'other'] as const).map((kind) => (
          <ProblemOutcome key={kind} delivery={{ ...DELIVERING, problem: { kind } }} />
        ))}
      </div>
    </Both>
  ),
};

export const StaffEndings: Story = {
  render: () => {
    const extra = {
      pay: '$7.64',
      kitchen: { phone: '+16175550142', address: 'Foodz Kitchen · 88 Harbor Street' },
    };
    return (
      <Both>
        <div className="space-y-3">
          {(['confirmed', 'cancelledBringBack', 'markedDelivered'] as const).map((kind) => (
            <OfferNotice key={kind} words={releaseNotice(kind, '1042', extra)} onDismiss={noop} />
          ))}
        </div>
      </Both>
    );
  },
};

function Boxes({ value, disabled }: { value: string; disabled?: boolean }) {
  const [digits, setDigits] = useState(value);
  return (
    <CodeBoxes
      value={digits}
      onChange={setDigits}
      disabled={Boolean(disabled)}
      invalid={false}
      describedBy="story-message"
    />
  );
}

export const CodeBoxStates: Story = {
  render: () => (
    <Both>
      <div className="space-y-6">
        <Boxes value="" />
        <Boxes value="48" />
        <Boxes value="4821" />
        <Boxes value="" disabled />
      </div>
    </Both>
  ),
};

function SheetWith({
  delivery,
  problems = false,
}: {
  delivery: PartnerDeliveryF8;
  problems?: boolean;
}) {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    setDispatchStateForPreview({ delivery, delivered: null, card: null });
  }, [delivery]);
  return problems ? (
    <ProblemSheet open={open} onOpenChange={setOpen} returnFocus={noop} />
  ) : (
    <CodeSheet open={open} onOpenChange={setOpen} position={null} returnFocus={noop} />
  );
}

export const CodeSheetCash: Story = {
  render: () => (
    <Frame theme="light">
      <SheetWith delivery={DELIVERING} />
    </Frame>
  ),
};

export const CodeSheetLocked: Story = {
  render: () => (
    <Frame theme="dark">
      <SheetWith delivery={{ ...DELIVERING, otp: { locked: true, triesLeft: 0 } }} />
    </Frame>
  ),
};

export const ProblemSheetOpen: Story = {
  render: () => (
    <Frame theme="light">
      <SheetWith delivery={DELIVERING} problems />
    </Frame>
  ),
};
