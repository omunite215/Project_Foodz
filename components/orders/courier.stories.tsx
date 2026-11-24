import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import type { CustomerDispatchView } from '@/server/modules/delivery/schema';
import type { OrderView } from '@/server/modules/orders/schema';
import { CourierBlock } from './courier-block';
import { OrderHero } from './order-parts';
import { ProgressCard, TimelineCard } from './order-progress';
import { orderViewFixture, stepsAt } from './orders.fixtures';

/*
 * The courier on the customer's order page (F7 design 3): the line under the h1 for each
 * search state, the courier block inside the status card (photo, initial, rating, none), the
 * courier-changed notice and the timeline entry.
 */

const meta = {
  title: 'Orders/Courier',
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div className="w-[375px] max-w-full bg-neutral-8 p-4 md:w-[600px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const NOW = new Date('2026-11-21T00:45:00.000Z');
const live = { state: 'live' as const, returnPath: '/orders/1' };

const LUIS: NonNullable<CustomerDispatchView['courier']> = {
  firstName: 'Luis',
  photoUrl: null,
  photoExpiresAt: null,
  vehicle: 'SCOOTER',
  vehicleWords: 'Scooter · 7KT 342',
  plate: '7KT 342',
  rating: { average: 4.6, count: 31 },
};

const GRACE: NonNullable<CustomerDispatchView['courier']> = {
  firstName: 'Grace',
  photoUrl: '/partner/icons/apple-touch-icon.png',
  photoExpiresAt: null,
  vehicle: 'BICYCLE',
  vehicleWords: 'Bicycle',
  plate: null,
  rating: null,
};

const ready = (dispatch: CustomerDispatchView, progress: Partial<OrderView['progress']> = {}) =>
  orderViewFixture({
    status: 'READY',
    progress: {
      ...orderViewFixture().progress,
      steps: stepsAt('ready'),
      arrival: {
        kind: 'moved',
        from: '2026-11-21T01:00:00.000Z',
        to: '2026-11-21T01:10:00.000Z',
        lateMinutes: null,
        behind: false,
      },
      ...progress,
      dispatch,
    },
    timeline: [
      { kind: 'placed', at: '2026-11-21T00:20:00.000Z', amountCents: null },
      { kind: 'ready', at: '2026-11-21T00:40:00.000Z', amountCents: null },
    ],
  });

function Hero({ view }: { view: OrderView }) {
  return <OrderHero view={view} state="placed" play={false} slow={false} now={NOW.getTime()} />;
}

export const Finding: Story = {
  render: () => <Hero view={ready({ state: 'searching', courier: null, changed: false })} />,
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText("It's packed. We're finding a courier to bring it to you."),
    ).toBeInTheDocument();
  },
};

export const TakingLonger: Story = {
  render: () => <Hero view={ready({ state: 'slow', courier: null, changed: false })} />,
};

export const CourierAssigned: Story = {
  render: () => {
    const view = ready({ state: 'assigned', courier: LUIS, changed: false });
    return (
      <>
        <Hero view={view} />
        <ProgressCard view={view} now={NOW} live={live} />
        <TimelineCard view={view} now={NOW} />
      </>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Rated 4.6 from 31 ratings')).toBeInTheDocument();
    await expect(canvas.getByText('Luis is on the way to the kitchen')).toBeInTheDocument();
  },
};

export const CourierChanged: Story = {
  render: () => {
    const view = ready({ state: 'assigned', courier: GRACE, changed: true });
    return <ProgressCard view={view} now={NOW} live={live} />;
  },
};

export const OnItsWay: Story = {
  render: () => {
    const view = orderViewFixture({
      status: 'PICKED_UP',
      progress: {
        ...orderViewFixture().progress,
        steps: stepsAt('pickedUp'),
        dispatch: { state: 'pickedUp', courier: LUIS, changed: false },
      },
    });
    return <Hero view={view} />;
  },
};

export const Blocks: Story = {
  render: () => (
    <div className="space-y-4 rounded-2xl bg-white p-5">
      <CourierBlock courier={LUIS} changed={false} />
      <CourierBlock courier={GRACE} changed={false} />
      <CourierBlock courier={{ ...LUIS, photoUrl: '/missing-photo.png' }} changed={false} />
    </div>
  ),
};
