import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { BriefcaseBusiness } from 'lucide-react';
import { expect, within } from 'storybook/test';
import { RadioCard } from './radio-card';

/** One choice in a group of cards: addresses, payment methods, saved cards (F4 design 2.7, D8). */
const meta = {
  title: 'Checkout/RadioCard',
  component: RadioCard,
  parameters: { layout: 'padded' },
  args: {
    name: 'story',
    value: 'work',
    checked: false,
    onChange: () => {},
    icon: BriefcaseBusiness,
    label: 'Work, default, 1 Faneuil Hall Square, 1.3 km, delivery $2.64',
    aside: (
      <span aria-hidden>
        <span className="block text-body-4 font-medium text-neutral-1 tabular-nums">$2.64</span>
        <span className="block text-body-5 text-neutral-3 tabular-nums">1.3 km</span>
      </span>
    ),
    children: (
      <span aria-hidden>
        <span className="block text-body-4 font-medium text-neutral-1">Work</span>
        <span className="mt-0.5 block text-body-5 text-neutral-3">
          1 Faneuil Hall Square, Apt 4
        </span>
      </span>
    ),
  },
  decorators: [
    (Story) => (
      <div className="w-[375px] max-w-full bg-neutral-8 p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof RadioCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Chosen: Story = {
  args: {
    checked: true,
    extra: (
      <div className="border-t border-neutral-6 px-4 py-3 text-body-5 text-neutral-1">
        Courier instructions: Buzzer 3, leave at the door
      </div>
    ),
  },
  play: async ({ canvasElement }) => {
    const radio = within(canvasElement).getByRole('radio');
    await expect(radio).toBeChecked();
  },
};

export const Disabled: Story = {
  args: {
    disabled: true,
    aside: null,
    label: 'Work, 1 Faneuil Hall Square, outside our delivery area now',
  },
};

export const Focused: Story = {
  play: async ({ canvasElement }) => {
    within(canvasElement).getByRole('radio').focus();
  },
};
