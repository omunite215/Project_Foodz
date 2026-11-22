import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, within } from 'storybook/test';
import { DeliveryResult } from './delivery-result';

const meta = {
  title: 'Account/DeliveryResult',
  component: DeliveryResult,
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div className="max-w-[640px]">
        <Story />
      </div>
    ),
  ],
  args: { state: { kind: 'idle' }, onTryAnother: fn(), onRetry: fn() },
} satisfies Meta<typeof DeliveryResult>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Reserved from the start, so it never pops in. */
export const Idle: Story = {};

export const Inside: Story = {
  args: { state: { kind: 'inside', text: 'We deliver here · about 4.3 km from our kitchen' } },
};

/** Outside: the sentence names the place, and offers another try (never "invalid"). */
export const Outside: Story = {
  args: {
    state: {
      kind: 'outside',
      text: "Sorry, we don't deliver to 1 Quincy Center Plaza yet. It's about 11.5 km from our kitchen at 88 Harbor Street, and we deliver within 8 km.",
    },
  },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('button', { name: 'Try another address' }),
    ).toBeVisible();
  },
};

export const CheckFailed: Story = {
  args: { state: { kind: 'failed' } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: 'Try again' })).toBeVisible();
  },
};
