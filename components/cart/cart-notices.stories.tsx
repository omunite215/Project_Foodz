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

/** F4: a card order waits for its payment (shown first), with its link to the order page. */
export const UnpaidOrder: Story = {
  args: {
    notices: [{ kind: 'unpaid', orderId: '01a201a9-7986-74dd-9f5a-15ae7a8fe737', number: '1042' }],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/^You have an unpaid order 1042\./)).toBeVisible();
    await expect(canvas.getByRole('link', { name: 'Finish paying' })).toHaveAttribute(
      'href',
      '/orders/01a201a9-7986-74dd-9f5a-15ae7a8fe737',
    );
    await expect(canvas.queryByRole('button', { name: 'Dismiss' })).toBeNull();
  },
};

/** F4 B16: an order emptied the cart; she can open it, or dismiss the notice. */
export const OrderPlaced: Story = {
  args: {
    notices: [{ kind: 'placed', orderId: '01a201a9-7986-74dd-9f5a-15ae7a8fe737', number: '1042' }],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByText(/^Order 1042 is placed\. Your cart has been emptied\./),
    ).toBeVisible();
    await expect(canvas.getByRole('link', { name: 'View your order' })).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Dismiss' })).toBeVisible();
  },
};

/** F5 design 8: what "Order again" left out, first, one sentence per item. */
export const OrderAgainLeftOut: Story = {
  args: {
    notices: [
      {
        kind: 'leftOut',
        lines: [
          'Naengmyeon is sold out, so we left it out.',
          'Gochujang is no longer offered on Gimbap, so we left it off.',
          'The kitchen ran out of Pad Thai today, so we left it out.',
        ],
      },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByRole('listitem')).toHaveLength(3);
    await expect(canvas.getByRole('button', { name: 'Dismiss' })).toBeVisible();
  },
};
