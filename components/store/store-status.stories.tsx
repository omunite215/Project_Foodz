import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import {
  closedUntilSaturday,
  closedUntilTomorrow,
  openStatus,
} from '@/components/storefront.fixtures';
import { StoreStatus } from './store-status';

const meta = {
  title: 'Storefront/StoreStatus',
  component: StoreStatus,
  parameters: { layout: 'padded' },
  args: { status: openStatus },
} satisfies Meta<typeof StoreStatus>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Home and menu, while the store is open. Boston time, whatever the device's zone. */
export const Open: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Open now · until 10 pm')).toBeVisible();
  },
};

/** Closed: the pill becomes a notice that says when ordering opens. Browsing still works. */
export const ClosedOpensTomorrow: Story = {
  args: { status: closedUntilTomorrow },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("We're closed right now")).toBeVisible();
    await expect(
      canvas.getByText('You can fill your cart now and order from 11 am tomorrow.'),
    ).toBeVisible();
  },
};

export const ClosedOpensLaterInWeek: Story = {
  args: { status: closedUntilSaturday },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText('You can fill your cart now and order from 12 pm Saturday.'),
    ).toBeVisible();
  },
};

/** The dish page shows nothing while the store is open… */
export const HiddenWhenOpen: Story = {
  args: { hideWhenOpen: true },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByText(/Open now/)).toBeNull();
  },
};

/** …and the closed notice when it is not. */
export const DishPageClosed: Story = {
  args: { status: closedUntilTomorrow, hideWhenOpen: true },
};
