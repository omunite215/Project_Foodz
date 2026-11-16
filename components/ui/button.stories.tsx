import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { ArrowRight, ShoppingBag } from 'lucide-react';
import { expect, fn, within } from 'storybook/test';
import { Button } from './button';

const meta = {
  title: 'UI/Button',
  component: Button,
  tags: ['autodocs'],
  args: { children: 'Order now', onClick: fn() },
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'outline', 'secondary', 'ghost', 'destructive', 'link'],
    },
    size: {
      control: 'select',
      options: [
        'xs',
        'sm',
        'default',
        'lg',
        'touch',
        'icon-xs',
        'icon-sm',
        'icon',
        'icon-lg',
        'icon-touch',
      ],
    },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Variants: Story = {
  render: (args) => (
    <div className="flex flex-wrap items-center gap-3">
      <Button {...args} variant="default">
        Default
      </Button>
      <Button {...args} variant="outline">
        Outline
      </Button>
      <Button {...args} variant="secondary">
        Secondary
      </Button>
      <Button {...args} variant="ghost">
        Ghost
      </Button>
      <Button {...args} variant="destructive">
        Destructive
      </Button>
      <Button {...args} variant="link">
        Link
      </Button>
    </div>
  ),
};

export const Sizes: Story = {
  render: (args) => (
    <div className="flex flex-wrap items-center gap-3">
      <Button {...args} size="xs">
        Extra small
      </Button>
      <Button {...args} size="sm">
        Small
      </Button>
      <Button {...args} size="default">
        Default
      </Button>
      <Button {...args} size="lg">
        Large
      </Button>
      <Button {...args} size="touch">
        Touch
      </Button>
    </div>
  ),
};

/** For phones and the partner app: at least 44 × 44 px, whatever the label. */
export const Touch: Story = {
  render: (args) => (
    <div className="flex items-center gap-3">
      <Button {...args} size="touch">
        Add to cart
        <ArrowRight data-icon="inline-end" />
      </Button>
      <Button {...args} size="touch" variant="outline">
        OK
      </Button>
      <Button {...args} size="icon-touch" variant="secondary" aria-label="Open cart">
        <ShoppingBag />
      </Button>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const sides = within(canvasElement)
      .getAllByRole('button')
      .flatMap((button) => {
        const { width, height } = button.getBoundingClientRect();
        return [width, height];
      });
    await expect(Math.min(...sides)).toBeGreaterThanOrEqual(44);
  },
};

export const WithIcon: Story = {
  args: {
    children: (
      <>
        <ShoppingBag data-icon="inline-start" />
        Checkout
      </>
    ),
  },
};

export const Disabled: Story = {
  args: { disabled: true },
};

export const AsLink: Story = {
  args: { asChild: true, variant: 'outline', children: <a href="#menu">See the menu</a> },
};
