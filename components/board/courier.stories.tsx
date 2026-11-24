import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { COURIER_STATES } from '@/server/modules/delivery/schema';
import { fullCard, NOW, seed, TZ } from './board.fixtures';
import { NobodyOnlineBanner, NoCourierBanner } from './courier-banners';
import {
  ASSIGNABLE,
  COURIER_LINES,
  DEMO_SECTION,
  KITCHEN_SECTION,
  OFFERS,
  PICKED_UP_SECTION,
  SEARCHING_SECTION,
  SUPPORT_SECTION,
} from './courier.fixtures';
import { CourierLine, CouriersChip, CourierSection, OffersList } from './courier-parts';
import {
  assignableKey,
  AssignCourierDialog,
  TakeOffCourierDialog,
} from './dialogs/courier-dialogs';
import { HandoverDialog, MoveBackDialog } from './dialogs/status-dialogs';

/*
 * F7 on the staff side (design 2): the courier line in its nine states at the 1024 card width
 * (239 px) and wider, the couriers chip, the detail's courier section per role, the offers list
 * with every outcome, the assign and take-off dialogs, the no-courier banners and F5's dialogs
 * with a courier on the order.
 */

const now = new Date(NOW);
const noop = () => undefined;

function WithAssignable({
  data,
  loading = false,
  children,
}: {
  data?: typeof ASSIGNABLE;
  loading?: boolean;
  children: ReactNode;
}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  const orderId = seed('S1105').id;
  if (data) client.setQueryData(assignableKey(orderId), data);
  if (loading) {
    void client.prefetchQuery({
      queryKey: assignableKey(orderId),
      queryFn: () => new Promise<never>(() => undefined),
    });
  }
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const meta = {
  title: 'Board/Couriers',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const CourierLines: Story = {
  render: () => (
    <div className="flex flex-wrap gap-8 bg-neutral-7 p-6">
      {[239, 400].map((width) => (
        <div key={width} style={{ width }} className="space-y-2 rounded-xl bg-white p-3">
          {COURIER_STATES.map((state) => (
            <CourierLine key={state} courier={COURIER_LINES[state]} now={now} />
          ))}
          <CourierLine courier={COURIER_LINES.assigned} now={now} orderStatus="PICKED_UP" />
        </div>
      ))}
    </div>
  ),
};

export const CouriersChips: Story = {
  render: () => (
    <div className="flex gap-3 bg-white p-6">
      <CouriersChip count={{ online: 4, free: 2 }} />
      <CouriersChip count={{ online: 0, free: 0 }} />
    </div>
  ),
};

function Panel({ children }: { children: ReactNode }) {
  return <div className="w-[480px] max-w-full bg-white px-6 py-5">{children}</div>;
}

export const SectionSupport: Story = {
  render: () => (
    <Panel>
      <CourierSection
        section={SUPPORT_SECTION}
        orderNumber="1042"
        orderStatus="READY"
        now={now}
        timeZone={TZ}
        level="h3"
      />
    </Panel>
  ),
};

export const SectionSearching: Story = {
  render: () => (
    <Panel>
      <CourierSection
        section={SEARCHING_SECTION}
        orderNumber="1042"
        orderStatus="READY"
        now={now}
        timeZone={TZ}
        level="h3"
      />
    </Panel>
  ),
};

export const SectionKitchen: Story = {
  render: () => (
    <Panel>
      <CourierSection
        section={KITCHEN_SECTION}
        orderNumber="1042"
        orderStatus="READY"
        now={now}
        timeZone={TZ}
        level="h3"
      />
    </Panel>
  ),
};

export const SectionDemo: Story = {
  render: () => (
    <Panel>
      <CourierSection
        section={DEMO_SECTION}
        orderNumber="1042"
        orderStatus="READY"
        now={now}
        timeZone={TZ}
        level="h3"
      />
    </Panel>
  ),
};

export const SectionPickedUp: Story = {
  render: () => (
    <Panel>
      <CourierSection
        section={PICKED_UP_SECTION}
        orderNumber="1042"
        orderStatus="PICKED_UP"
        now={now}
        timeZone={TZ}
        level="h3"
      />
    </Panel>
  ),
};

export const OffersEveryOutcome: Story = {
  render: () => (
    <Panel>
      <OffersList
        orderNumber="1042"
        offers={OFFERS}
        openExpiresAt={new Date(Date.parse(NOW) + 24_000).toISOString()}
        now={now}
        timeZone={TZ}
        level="h4"
      />
    </Panel>
  ),
};

const readyCard = fullCard(seed('S1105'), { status: 'READY', courier: COURIER_LINES.escalated });
const heldCard = fullCard(seed('S1105'), { status: 'READY', courier: COURIER_LINES.assigned });
const common = {
  timeZone: TZ,
  offline: false,
  onClose: noop,
  onCloseFocus: () => false,
  onSignedOut: noop,
};

export const AssignDialog: Story = {
  render: () => (
    <WithAssignable data={ASSIGNABLE}>
      <AssignCourierDialog card={readyCard} {...common} onFinished={noop} />
    </WithAssignable>
  ),
};

export const AssignDialogEmpty: Story = {
  render: () => (
    <WithAssignable data={{ deliveryVersion: 3, offlineCount: 3, rows: [] }}>
      <AssignCourierDialog card={readyCard} {...common} onFinished={noop} />
    </WithAssignable>
  ),
};

export const AssignDialogLoading: Story = {
  render: () => (
    <WithAssignable loading>
      <AssignCourierDialog card={readyCard} {...common} onFinished={noop} />
    </WithAssignable>
  ),
};

export const TakeOffDialog: Story = {
  render: () => (
    <WithAssignable>
      <TakeOffCourierDialog
        card={heldCard}
        shortName="Luis M."
        expectedVersion={5}
        {...common}
        onFinished={noop}
      />
    </WithAssignable>
  ),
};

export const ChooseAnotherDialog: Story = {
  render: () => (
    <WithAssignable>
      <TakeOffCourierDialog
        card={heldCard}
        shortName="Luis M."
        expectedVersion={5}
        chooseAnother
        {...common}
        onFinished={noop}
      />
    </WithAssignable>
  ),
};

/** Mark picked up with a courier on the order: "by the assigned courier" first, chosen (D30). */
export const PickUpWithCourier: Story = {
  render: () => (
    <WithAssignable>
      <HandoverDialog step="pickUp" card={heldCard} {...common} onFinished={noop} />
    </WithAssignable>
  ),
};

export const MoveBackWithCourier: Story = {
  render: () => (
    <WithAssignable>
      <MoveBackDialog card={heldCard} {...common} onFinished={noop} />
    </WithAssignable>
  ),
};

export const NoCourierBanners: Story = {
  render: () => (
    <div className="w-[900px] max-w-full space-y-2 bg-white p-4">
      <NoCourierBanner
        orders={[{ id: 'a', number: '1042' }]}
        viewer="full"
        readOnly={false}
        onAssign={noop}
        onShowOldest={noop}
      />
      <NoCourierBanner
        orders={[{ id: 'a', number: '1042' }]}
        viewer="kitchen"
        readOnly={false}
        onAssign={noop}
        onShowOldest={noop}
      />
      <NoCourierBanner
        orders={[{ id: 'a', number: '1042' }]}
        viewer="full"
        readOnly
        onAssign={noop}
        onShowOldest={noop}
      />
      <NoCourierBanner
        orders={[
          { id: 'a', number: '1042' },
          { id: 'b', number: '1043' },
        ]}
        viewer="full"
        readOnly={false}
        onAssign={noop}
        onShowOldest={noop}
      />
      <NobodyOnlineBanner />
    </div>
  ),
};
