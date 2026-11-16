import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import {
  basilPork,
  bulgogi,
  gimbap,
  kimchi,
  koreanBbq,
  naengmyeon,
  unreviewed,
} from '@/components/storefront.fixtures';
import { DishCard } from './dish-card';

const meta = {
  title: 'Storefront/DishCard',
  component: DishCard,
  tags: ['autodocs'],
  parameters: { layout: 'padded', nextjs: { appDirectory: true } },
  args: { dish: bulgogi, layout: 'responsive' },
  argTypes: {
    layout: { control: 'inline-radio', options: ['responsive', 'featured', 'compact'] },
  },
  decorators: [
    (Story, { parameters }) => (
      <div
        className={parameters.wide ? 'w-[1100px] bg-neutral-8 p-4' : 'w-[340px] bg-neutral-8 p-4'}
      >
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof DishCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Menu grid card ("small" up to `lg`, "large" from `xl`). One link, read once. */
export const Responsive: Story = {
  play: async ({ canvasElement }) => {
    const links = within(canvasElement).getAllByRole('link');
    await expect(links).toHaveLength(1);
    await expect(links[0]).toHaveAccessibleName('Bulgogi, $22.99, rated 4.6 out of 5, 120 reviews');
    await expect(links[0]).toHaveAttribute('href', '/menu/bulgogi');
  },
};

/** The highlighted offer: countdown badge and the dish's own flavors. */
export const Featured: Story = {
  args: {
    dish: koreanBbq,
    layout: 'featured',
    showOffer: true,
    flavors: ['Gochujang', 'Sesame oil', 'Garlic', 'Spring onion'],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByRole('link')).toHaveLength(1);
    await expect(canvas.getByText(/Ends in \d+ days?/)).toBeVisible();
    await expect(canvas.getByText('Flavors: Sugar, Gochujang, Soy sauce, Garlic')).toBeVisible();
  },
};

/** One row: Today's specials on the menu and sold-out suggestions. */
export const Compact: Story = {
  args: { dish: gimbap, layout: 'compact' },
};

/** Dishes without a photo get the placeholder plate at the same size. */
export const NoPhoto: Story = {
  args: { dish: bulgogi },
};

/** Listed last, labelled in words, no order button; still opens the dish page. */
export const SoldOut: Story = {
  args: { dish: naengmyeon },
  play: async ({ canvasElement }) => {
    const link = within(canvasElement).getByRole('link');
    await expect(link).toHaveAccessibleName(
      'Naengmyeon, $15.99, Sold out today, rated 4.6 out of 5, 288 reviews',
    );
  },
};

/** The "Special" badge, shown in the menu grid only. */
export const Special: Story = {
  args: { dish: gimbap, showSpecial: true },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('link')).toHaveAccessibleName(
      'Gimbap, Special, $12.99, rated 4.9 out of 5, 215 reviews',
    );
  },
};

/** Long names wrap to two lines; the price row stays at the bottom. */
export const LongName: Story = {
  args: { dish: basilPork },
};

/** No stars, just "No reviews yet". */
export const NoReviews: Story = {
  args: { dish: unreviewed },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('No reviews yet')).toBeVisible();
  },
};

/** Cards in a row stretch to the same height, so prices and buttons line up. */
export const Row: Story = {
  parameters: { wide: true },
  render: () => (
    <ul className="grid grid-cols-3 gap-8">
      {[basilPork, kimchi, naengmyeon].map((dish) => (
        <li key={dish.id} className="h-full">
          <DishCard dish={dish} layout="responsive" showSpecial />
        </li>
      ))}
    </ul>
  ),
  play: async ({ canvasElement }) => {
    const prices = ['$21.99', '$6.99', '$15.99'].map(
      (price) => within(canvasElement).getByText(price).getBoundingClientRect().top,
    );
    await expect(new Set(prices).size).toBe(1);
  },
};
