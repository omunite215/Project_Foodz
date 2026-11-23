import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import type { OrderView } from '@/server/modules/orders/schema';
import { orderViewFixture, paidCardOrder, stepsAt } from './orders.fixtures';
import { CancellationCard, ProgressCard, TimelineCard } from './order-progress';

/*
 * The customer's live order (F5 design 6): the status card at each step, the late lines, the
 * cancellation card and the timeline card.
 */

const meta = {
  title: 'Orders/Live order',
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

const NOW = new Date('2026-11-20T00:30:00.000Z');
const WINDOW = { from: '2026-11-20T01:09:00.000Z', to: '2026-11-20T01:19:00.000Z' };
const live = { state: 'live' as const, returnPath: '/orders/1' };

const at = (
  status: OrderView['status'],
  step: Parameters<typeof stepsAt>[0],
  progress: Partial<OrderView['progress']> = {},
) =>
  orderViewFixture({
    status,
    progress: {
      ...orderViewFixture().progress,
      steps: stepsAt(step),
      arrival: { kind: 'promised', ...WINDOW, lateMinutes: null, behind: false },
      ...progress,
    },
  });

export const Accepted: Story = {
  render: () => <ProgressCard view={at('ACCEPTED', 'accepted')} now={NOW} live={live} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Accepted, now, 7:03 pm')).toBeInTheDocument();
    await expect(canvas.getByText('Cooking, not yet')).toBeInTheDocument();
  },
};

export const CookingBehind: Story = {
  render: () => (
    <ProgressCard
      view={at('PREPARING', 'preparing', {
        arrival: { kind: 'promised', ...WINDOW, lateMinutes: null, behind: true },
      })}
      now={NOW}
      live={{ state: 'behind', returnPath: '/orders/1' }}
    />
  ),
};

export const ReadyLate: Story = {
  render: () => (
    <ProgressCard
      view={at('READY', 'ready', {
        arrival: { kind: 'moved', ...WINDOW, lateMinutes: 12, behind: false },
      })}
      now={NOW}
      live={live}
    />
  ),
};

export const PastDue: Story = {
  render: () => (
    <ProgressCard
      view={at('PICKED_UP', 'pickedUp', {
        arrival: { kind: 'pastDue', ...WINDOW, lateMinutes: null, behind: false },
      })}
      now={NOW}
      live={{ state: 'signedOut', returnPath: '/orders/1' }}
    />
  ),
};

export const Delivered: Story = {
  render: () => (
    <ProgressCard
      view={at('DELIVERED', 'delivered', {
        arrival: null,
        deliveredAt: '2026-11-20T01:14:00.000Z',
        live: false,
      })}
      now={NOW}
      live={{ state: 'hidden', returnPath: '/orders/1' }}
    />
  ),
};

const cancelled = paidCardOrder({
  status: 'CANCELLED',
  cancelReason: 'store',
  timeline: [
    { kind: 'placed', at: '2026-11-20T00:02:00.000Z', amountCents: null },
    {
      kind: 'cancelled',
      at: '2026-11-20T00:05:00.000Z',
      amountCents: null,
      cancellation: { by: 'store', reasonLine: 'ranOut', dishes: ['Pad Thai'] },
    },
  ],
  progress: {
    ...orderViewFixture().progress,
    live: true,
    cancellation: {
      by: 'store',
      opener: 'sorry',
      reasonLine: 'ranOut',
      dishes: ['Pad Thai'],
      moneyLine: 'refunding',
      amountCents: 5397,
      cardLabel: 'Visa •••• 4242',
      refundedAt: null,
      tipIncluded: false,
      codeReleased: 'LASTONE',
      refundSlow: true,
      at: '2026-11-20T00:05:00.000Z',
    },
  },
});

export const CancelledByTheKitchen: Story = {
  render: () => (
    <>
      <CancellationCard view={cancelled} />
      <TimelineCard view={cancelled} now={NOW} />
    </>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole('heading', { name: 'Sorry, we had to cancel order 1042.' }),
    ).toBeVisible();
    // Never a staff name or the word "refused" (S5.6).
    await expect(canvas.queryByText(/refused|Alex/i)).toBeNull();
  },
};
