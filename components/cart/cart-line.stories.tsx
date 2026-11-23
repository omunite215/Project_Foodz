import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import { basilPork, gimbap, kimchi } from '@/components/storefront.fixtures';
import { CartLineItem, type CartLineView, UndoRow } from './cart-line';

/*
 * One line of the cart (F3 design 2.5 to 2.8): the Figma "added item", adapted to 44 px
 * controls that fit a 320 px screen.
 */

const view = (dish: typeof gimbap, fields: Partial<CartLineView> = {}): CartLineView => ({
  id: dish.id,
  title: dish.title,
  href: `/menu/${dish.slug}`,
  image: dish.image,
  quantity: 2,
  flavors: [],
  unitCents: dish.priceCents,
  soldOut: false,
  priceChange: null,
  droppedFlavors: [],
  flavorsOffered: ['Gochujang', 'Sesame oil'],
  ...fields,
});

const noop = () => {};

const meta = {
  title: 'Cart/CartLine',
  component: CartLineItem,
  parameters: { layout: 'padded', nextjs: { appDirectory: true } },
  args: {
    line: view(gimbap),
    suffix: '',
    cartFull: null,
    editing: false,
    editorId: 'editor',
    onQuantity: noop,
    onRemove: noop,
    onEdit: noop,
    onNavigate: noop,
  },
  decorators: [
    (Story) => (
      <ul className="w-[343px] bg-neutral-8 p-4">
        <li className="rounded-lg border border-neutral-6 bg-white p-3">
          <Story />
        </li>
      </ul>
    ),
  ],
} satisfies Meta<typeof CartLineItem>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Name, line total, unit price and the named controls (S7.2). */
export const Normal: Story = {
  args: { line: view(gimbap, { flavors: ['Gochujang'], note: 'No cucumber please' }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('link', { name: 'Gimbap' })).toHaveAttribute(
      'href',
      '/menu/gimbap',
    );
    await expect(canvas.getByText('$25.98')).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Decrease Gimbap' })).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Edit Gimbap' })).toBeVisible();
  },
};

/**
 * At 1 the minus is a bin, "Decrease to 0 and remove Gimbap": a name of its own, so it isn't
 * mistaken for the line's "Remove Gimbap" right after it.
 */
export const One: Story = {
  args: { line: view(gimbap, { quantity: 1 }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole('button', { name: 'Decrease to 0 and remove Gimbap' }),
    ).toBeVisible();
    await expect(canvas.getAllByRole('button', { name: 'Remove Gimbap' })).toHaveLength(1);
  },
};

/** Sold out today: not in the total, only "Remove" left (S3.1). */
export const SoldOut: Story = { args: { line: view(kimchi, { soldOut: true }) } };

/** The price went up since she added it (S3.3). */
export const PriceUp: Story = {
  args: {
    line: view(gimbap, { unitCents: 1399, priceChange: { nowCents: 1399, wasCents: 1299 } }),
  },
};

/** The price went down. */
export const PriceDown: Story = {
  args: {
    line: view(gimbap, { unitCents: 1199, priceChange: { nowCents: 1199, wasCents: 1299 } }),
  },
};

/** An extra the dish no longer offers was taken off (S3.4). */
export const ExtraDropped: Story = {
  args: { line: view(kimchi, { droppedFlavors: ['Sesame oil'], droppedWereOffered: true }) },
};

/** An extra the dish never offered (an edited saved cart) was taken off: no "any more" (S1.16). */
export const ExtraNeverOffered: Story = {
  args: { line: view(gimbap, { droppedFlavors: ['Strawberry jam'] }) },
};

/** At 20, "+" is blocked and says why (S1.6). */
export const AtTwenty: Story = { args: { line: view(gimbap, { quantity: 20 }) } };

/** Two lines of one dish: the names say which is which (S7.2). */
export const TwoLinesOfOneDish: Story = {
  args: { line: view(gimbap, { flavors: ['Gochujang'] }), suffix: ' with Gochujang' },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('button', { name: 'Increase Gimbap with Gochujang' }),
    ).toBeVisible();
  },
};

/** Long names wrap; notes clamp to two lines (the whole note stays readable). */
export const LongNote: Story = {
  args: {
    line: view(basilPork, {
      note: 'Please make it extra spicy, no peanuts at all because of an allergy, and pack the sauce separately if you can.',
    }),
  },
};

/** Before any answer and without a cached name: placeholders of the same size. */
export const Unknown: Story = {
  args: { line: view(gimbap, { title: null, href: null, unitCents: null, flavorsOffered: null }) },
};

/** In place of a removed line, until her next action (S1.8). */
export const Undo: Story = {
  render: () => <UndoRow title="Gimbap" onUndo={noop} />,
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('button', { name: 'Undo removing Gimbap' }),
    ).toBeVisible();
  },
};
