import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { AnnouncementBar } from './announcement-bar';

const meta = {
  title: 'Storefront/AnnouncementBar',
  component: AnnouncementBar,
  parameters: { layout: 'fullscreen' },
  args: {
    campaignId: '0196a1b2-0000-7000-8000-000000000103',
    title: 'Free delivery on orders over $30',
    subtitle: 'Use code FREEDELIVERY at checkout',
    code: 'FREEDELIVERY',
  },
} satisfies Meta<typeof AnnouncementBar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Phones show the title and the code (two lines at most); wider screens add the subtitle. */
export const Default: Story = {};

/** Closing it keeps it closed for the rest of the visit. */
export const Close: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Close announcement' }));
    await waitFor(() => expect(canvas.queryByRole('region', { name: 'Announcement' })).toBeNull());
  },
};

/** A bar without a code. */
export const WithoutCode: Story = {
  args: { subtitle: null, code: null, title: 'We are open late on Fridays' },
};
