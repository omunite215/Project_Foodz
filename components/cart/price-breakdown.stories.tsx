import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import { CheckoutBar } from './checkout-bar';
import {
  quoteClosed,
  quoteClosedOutside,
  quoteGuestOutside,
  quoteOutside,
  quoteQ1,
  quoteQ2,
  quoteQ5,
  quoteSoldOut,
} from './cart.fixtures';
import { PriceBreakdown } from './price-breakdown';

/** The cart's price details (F3 design 2.16): every figure is the server's. */
const meta = {
  title: 'Cart/PriceBreakdown',
  component: PriceBreakdown,
  parameters: { layout: 'padded' },
  args: { quote: quoteQ2, status: 'ready', dim: false },
  decorators: [
    (Story) => (
      <div className="w-[392px] bg-neutral-8 p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PriceBreakdown>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Q2: Dana, 4.3 km away. */
export const Ready: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Delivery to Home · 4.3 km')).toBeVisible();
    await expect(canvas.getByText('Tax (7%)')).toBeVisible();
    await expect(canvas.getByText('$3.36')).toBeVisible();
  },
};

/** Before the first answer: placeholders of the same size, one label for screen readers. */
export const Loading: Story = { args: { quote: null, status: 'loading' } };

/** A guest with no address: the fee range, never "$1.99" alone (S2.7). */
export const GuestRange: Story = {
  args: { quote: quoteQ1 },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('$1.99 to $5.99')).toBeVisible();
  },
};

/** FREEDELIVERY: "Free", with the real fee struck through and read as "free, was $4.14". */
export const FreeDelivery: Story = { args: { quote: quoteQ5 } };

/** The address is outside the area: no fee. */
export const Outside: Story = { args: { quote: quoteOutside } };

/** A guest checked an address outside the area: no fee from an earlier address (S2.8). */
export const GuestOutside: Story = {
  args: { quote: quoteGuestOutside },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('not available')).toBeInTheDocument();
  },
};

/** A new answer is on its way: the figures stay, dimmed to 75 %. */
export const Updating: Story = { args: { status: 'updating', dim: true } };

/** The quote failed: figures hidden, never shown as current. */
export const Failed: Story = { args: { status: 'failed' } };

const bar = (props: Partial<React.ComponentProps<typeof CheckoutBar>>) => (
  <div className="w-[392px]">
    <CheckoutBar
      quote={quoteQ2}
      status="ready"
      dim={false}
      slow={false}
      onCheckout={() => {}}
      onRetry={() => {}}
      {...props}
    />
  </div>
);

/** Every state of the footer (design 2.17). */
export const CheckoutBarStates: Story = {
  render: () => (
    <div className="space-y-6">
      {bar({})}
      {bar({ quote: quoteQ1 })}
      {bar({ status: 'updating', dim: true, slow: true })}
      {bar({ quote: null, status: 'loading', slow: true })}
      {bar({ status: 'failed' })}
      {bar({ status: 'rateLimited', dim: true })}
      {bar({ quote: quoteSoldOut })}
      {bar({ quote: quoteClosed })}
      {bar({ quote: quoteOutside })}
      {bar({ quote: quoteClosedOutside })}
      {bar({ quote: quoteClosed, status: 'updating', dim: true, slow: true })}
      {bar({ status: 'offline' })}
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: 'Go to checkout · $55.47' })).toBeVisible();
    await expect(canvas.getByText('Remove sold-out dishes to check out.')).toBeVisible();
    // Closed while updating keeps its label; closed and outside still says why on the line.
    const closed = canvas.getAllByRole('button', { name: /^Ordering opens at/ });
    await expect(closed).toHaveLength(3);
    await expect(closed.map((button) => button.getAttribute('aria-disabled'))).toEqual([
      'true',
      'true',
      'true',
    ]);
    await expect(canvas.getAllByText('Choose an address we deliver to.')).toHaveLength(2);
  },
};
