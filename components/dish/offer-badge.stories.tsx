import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import { OFFER_ENDS_AT } from '@/components/storefront.fixtures';
import { OfferBadge } from './offer-badge';

/** The dish page's offer names its code and deal (F3 S4.12, design 3.3). */
const meta = {
  title: 'Storefront/OfferBadge',
  component: OfferBadge,
  parameters: { layout: 'padded' },
  args: { code: 'KBBQ5', description: '$5 off Korean dishes over $25', endsAt: OFFER_ENDS_AT },
  decorators: [
    (Story) => (
      <div className="w-[343px] bg-neutral-8 p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof OfferBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Wraps to two lines at 375; never truncates. Read once, never live. */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByText(/^Offer: KBBQ5, \$5 off Korean dishes over \$25, ends in \d+ days?$/),
    ).toBeInTheDocument();
  },
};

/** A code without a description. */
export const CodeOnly: Story = { args: { description: null } };
