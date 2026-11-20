import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import { CartNotices } from './cart-notices';

/** What changed, at the top of the cart, in their fixed order (F3 design 2.4). */
const meta = {
  title: 'Cart/CartNotices',
  component: CartNotices,
  parameters: { layout: 'padded' },
  args: {
    notices: [
      {
        kind: 'closed',
        text: "We're closed right now. You can fill your cart and order from 11 am tomorrow.",
      },
      { kind: 'soldOut', count: 1 },
      { kind: 'removed', count: 2 },
      { kind: 'priceChanged', count: 1 },
      {
        kind: 'codeEnded',
        text: "KBBQ5 ended at 9:00 pm, so it's no longer applied. Your total is now $55.47.",
      },
      { kind: 'full', limit: 'items', phone: '(617) 555-0142', tel: '+16175550142' },
      { kind: 'offline' },
    ],
    onDismiss: () => {},
    onRemoveSoldOut: () => {},
  },
  decorators: [
    (Story) => (
      <div className="w-[392px] bg-neutral-8 p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof CartNotices>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Every notice at once. "Sold out" can't be dismissed; it blocks checkout. */
export const All: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: 'Remove sold-out dishes' })).toBeVisible();
    await expect(canvas.getByRole('link', { name: '(617) 555-0142' })).toHaveAttribute(
      'href',
      'tel:+16175550142',
    );
    await expect(canvas.getAllByRole('button', { name: 'Dismiss' })).toHaveLength(3);
  },
};

/** The cart is full by its 25 different dishes. */
export const FullByLines: Story = {
  args: {
    notices: [{ kind: 'full', limit: 'lines', phone: '(617) 555-0142', tel: '+16175550142' }],
  },
};
