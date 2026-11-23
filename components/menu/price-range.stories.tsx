import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';
import type { PriceRange as Range } from '@/lib/menu-query';
import { PricePresets, PriceRange } from './price-range';

const bounds = { min: 6, max: 25 };

function ControlledRange({ initial, presets = false }: { initial: Range; presets?: boolean }) {
  const [value, setValue] = useState(initial);
  return (
    <div className="w-[340px]">
      <PriceRange bounds={bounds} value={value} onChange={setValue} />
      {presets ? <PricePresets bounds={bounds} value={value} onChange={setValue} /> : null}
    </div>
  );
}

/** The price filter (F3 design 5.5): two handles, $1 steps, keys and presets. */
const meta = {
  title: 'Menu/PriceRange',
  component: ControlledRange,
  parameters: { layout: 'padded' },
  args: { initial: bounds },
} satisfies Meta<typeof ControlledRange>;

export default meta;
type Story = StoryObj<typeof meta>;

/** At the bounds: "$6 – $25". */
export const Bounds: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('slider', { name: 'Lowest price' })).toHaveAttribute(
      'aria-valuetext',
      '$6',
    );
    await expect(canvas.getByRole('slider', { name: 'Highest price' })).toHaveAttribute(
      'aria-valuetext',
      '$25',
    );
  },
};

/** Arrows move $1, Page Up and Down $5, Home and End to the ends; handles never cross (S7.8). */
export const Keys: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const high = canvas.getByRole('slider', { name: 'Highest price' });
    high.focus();
    await userEvent.keyboard('{PageDown}{PageDown}{ArrowLeft}');
    await expect(high).toHaveAttribute('aria-valuetext', '$14');
    const low = canvas.getByRole('slider', { name: 'Lowest price' });
    low.focus();
    await userEvent.keyboard('{End}');
    await expect(low).toHaveAttribute('aria-valuetext', '$14');
  },
};

/** The phone sheet's presets: exact values without fine dragging (B12). */
export const Presets: Story = {
  args: { initial: bounds, presets: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Under $15' }));
    await expect(canvas.getByRole('button', { name: 'Under $15' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(canvas.getByRole('slider', { name: 'Highest price' })).toHaveAttribute(
      'aria-valuetext',
      '$15',
    );
  },
};
